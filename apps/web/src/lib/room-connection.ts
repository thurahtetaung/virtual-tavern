import type {
  Ack,
  ClientToServerEvents,
  LockReason,
  NextTable,
  RecapLine,
  RoomSnapshot,
  ServerToClientEvents,
} from '@vt/protocol';
import { type Socket, io } from 'socket.io-client';
import { JoinWatch } from './retry.ts';

export type RoomStatus =
  | 'connecting'
  | 'joined'
  | 'reconnecting'
  | 'kicked'
  | 'left'
  | 'error'
  /** A back-room room, and this browser's unlock is missing or no longer valid. */
  | 'locked'
  /** The admin ended this playtest: the room is gone. */
  | 'closed';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Hidden this long, a page says it is reconnecting when it comes back, until it has the room again. */
export const CATCH_UP_AFTER_MS = 30_000;
/** How long a page whose connection is fine waits for buffered updates before it drops the hint. */
const CATCH_UP_GRACE_MS = 2_000;
/** How long a tap made while the page rejoins waits for the rejoin before it is given up. */
export const HOLD_MS = 5_000;
/** How long the server has to answer a tap. */
const ACK_MS = 8_000;

const offline: Ack = {
  ok: false,
  error: { code: 'offline', message: 'Reconnecting… try again in a moment.' },
};

/** What the page hears from its room. */
export interface RoomListener {
  state(snapshot: RoomSnapshot): void;
  status(status: RoomStatus): void;
  /** Why the join was refused (null once a join is accepted). */
  error(message: string | null): void;
  lockReason(reason: LockReason): void;
  /** Back after a while away: the room on screen may be stale until the next update (the page
   * shows its reconnecting banner meanwhile). */
  catchingUp(on: boolean): void;
  wrapped(): void;
  next(table: NextTable): void;
  playtestAwards(lines: RecapLine[]): void;
  /** The night recap, pushed with the state it belongs to. */
  recap(push: RecapPush): void;
}

export type RecapPush = Parameters<ServerToClientEvents['room:recap']>[0];

/** Who joins: a player (their token and name), or the room's table screen (on its pass). */
export type Joiner = { token: string; name: string } | { role: 'stage' };

/**
 * Whether the heartbeat ran out while the page was asleep. A frozen phone never ran the timer
 * that would have closed the socket, so it still looks connected; asking closes it, and
 * socket.io reconnects.
 */
function heartbeatExpired(socket: ClientSocket): boolean {
  const engine = socket.io.engine as { _hasPingExpired?: () => boolean } | undefined;
  return engine?._hasPingExpired?.() ?? false;
}

/** How long a room page's connection waits for the next room page before it hangs up. */
const SPARE_MS = 3_000;
/** The join each socket sends with its connection (whoever has it now), if any. */
const auths = new WeakMap<ClientSocket, () => object | null>();
/** The last room page's connection, kept open briefly so the next room reuses it. */
let spare: {
  socket: ClientSocket;
  url: string | undefined;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

/**
 * A connection for a room page: the last room's, while it is still open ("Same crew, new game"
 * and following the crew switch rooms on it without connecting again), else a new one.
 */
function borrow(url: string | undefined): { socket: ClientSocket; reused: boolean } {
  if (spare) {
    const s = spare;
    spare = null;
    clearTimeout(s.timer);
    if (s.url === url && s.socket.active) return { socket: s.socket, reused: true };
    s.socket.disconnect();
  }
  const opts = {
    transports: ['websocket', 'polling'],
    // A quick first retry: socket.io's default waits 0.5–1.5 s before even trying again.
    reconnectionDelay: 250,
    reconnectionDelayMax: 5000,
    // The join rides in the connection itself, saving a round trip before the room arrives.
    auth: (cb: (data: object) => void) => cb(auths.get(socket)?.() ?? {}),
    forceNew: true,
  };
  const socket: ClientSocket = url ? io(url, opts) : io(opts);
  return { socket, reused: false };
}

/** A room page is done with its connection: keep it open for the next room page, briefly. */
function giveBack(socket: ClientSocket, url: string | undefined) {
  auths.delete(socket);
  if (!socket.active) return;
  if (spare) spare.socket.disconnect();
  spare = {
    socket,
    url,
    timer: setTimeout(() => {
      spare = null;
      socket.disconnect();
    }, SPARE_MS),
  };
}

interface HeldTap {
  send(): void;
  fail(): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Live connection to one room. Rejoins automatically after network drops or server restarts.
 * The socket connects at once; the join goes out once `enable` gives the identity (and again
 * after every reconnect). Taps only ever go out while the page is in the room.
 */
export class RoomConnection {
  private readonly socket: ClientSocket;
  private readonly url: string | undefined;
  /** Another room's connection: its events are that room's until this page's join is answered. */
  private reused: boolean;
  /** Borrowed from another room page and not yet answered: a refusal may only mean the
   * connection predates a cookie (the back room unlocked since), so it reconnects once. */
  private borrowed: boolean;
  /** Whether the current connection carried the join. */
  private joinedWithConnect = false;
  /** The room's state, held until the join that sent it is answered. */
  private early: RoomSnapshot | null = null;
  private earlyAwards: RecapLine[] | null = null;
  private readonly off: (() => void)[] = [];
  private readonly roomId: string;
  private readonly listener: RoomListener;
  private joiner: (() => Joiner) | null = null;
  /** Whether the server has this page in the room right now. */
  private joined = false;
  private current: RoomStatus = 'connecting';
  /** Taps made while the page rejoins, sent right after the join (never before it, where the
   * server would refuse them). */
  private held: HeldTap[] = [];
  private catching = false;
  private catchUpTimer: ReturnType<typeof setTimeout> | undefined;
  private hiddenAt = 0;
  private readonly watch: JoinWatch;

  constructor(roomId: string, listener: RoomListener, url?: string) {
    this.roomId = roomId;
    this.listener = listener;
    this.url = url;
    const { socket, reused } = borrow(url);
    this.socket = socket;
    this.reused = reused;
    this.borrowed = reused;
    auths.set(socket, () => {
      this.joinedWithConnect = this.joiner !== null;
      return this.joiner ? { roomId, ...this.joiner() } : null;
    });
    this.watch = new JoinWatch(() => {
      if (socket.connected) this.join();
    });
    const on = ((event: string, fn: (...a: never[]) => void) => {
      socket.on(event as 'connect', fn);
      this.off.push(() => socket.off(event as 'connect', fn));
    }) as ClientSocket['on'];
    /** Room events that only count once this page is in the room. */
    const inRoom =
      <A extends unknown[]>(fn: (...a: A) => void) =>
      (...a: A) => {
        if (!this.reused) fn(...a);
      };

    on('connect', () => {
      this.reused = false;
      // Sent with the connection: its answer is on the way (and re-sent if it never comes).
      if (this.joinedWithConnect) this.watch.sent();
      else this.join();
    });
    on('room:joined', (res) => this.answered(res));
    on('disconnect', (reason) => {
      this.joined = false;
      this.watch.stop();
      if (this.current === 'joined') this.setStatus('reconnecting');
      // The server hung up on us (an older server did so when it restarted): socket.io never
      // retries that by itself, so try again, as after any drop.
      if (reason === 'io server disconnect') return void socket.connect();
      // Closed on purpose: no rejoin is coming for the taps still waiting.
      if (!socket.active) this.release(false);
    });
    // The server can't be reached (down, or the phone is offline). socket.io keeps retrying, so
    // say so instead of sitting on "Opening the door…"; a successful join flips it back.
    on('connect_error', () => {
      if (this.current === 'connecting' || this.current === 'joined')
        this.setStatus('reconnecting');
    });
    on('room:state', (s) => {
      // A join's room comes just before its answer: held until then, so a room this connection
      // was in before never shows here.
      if (!this.joined) {
        this.early = s;
        return;
      }
      this.watch.stop();
      this.caughtUp();
      listener.state(s);
    });
    on(
      'room:kicked',
      inRoom(() => this.end('kicked')),
    );
    on(
      'room:wrapped',
      inRoom(() => listener.wrapped()),
    );
    on(
      'room:next',
      inRoom((table: NextTable) => listener.next(table)),
    );
    on('room:playtestAwards', (lines) => {
      if (this.joined) listener.playtestAwards(lines);
      else this.earlyAwards = lines;
    });
    on(
      'room:recap',
      inRoom((push: RecapPush) => listener.recap(push)),
    );
    on(
      'room:closed',
      inRoom(() => this.end('closed')),
    );
    // The word changed, everyone was signed out or the admin session ended: the server already
    // dropped us from the room.
    on(
      'room:locked',
      inRoom((reason: LockReason) => {
        listener.lockReason(reason);
        this.end('locked');
      }),
    );
  }

  private setStatus(status: RoomStatus) {
    this.current = status;
    this.listener.status(status);
  }

  private end(status: RoomStatus) {
    this.setStatus(status);
    this.socket.disconnect();
  }

  private join() {
    if (!this.joiner) return;
    this.watch.sent();
    this.socket.emit('room:join', { roomId: this.roomId, ...this.joiner() }, (res) =>
      this.answered(res),
    );
  }

  /** The server answered this page's join (sent with the connection or after it). */
  private answered(res: Ack) {
    this.reused = false;
    if (!res.ok && this.borrowed) {
      // The server read this connection's cookies when it opened, for another room: try once
      // more on a fresh one, which carries the cookies as they are now.
      this.borrowed = false;
      this.early = null;
      this.earlyAwards = null;
      this.reconnect();
      return;
    }
    this.borrowed = false;
    const early = this.early;
    const awards = this.earlyAwards;
    this.early = null;
    this.earlyAwards = null;
    if (res.ok) {
      this.joined = true;
      this.setStatus('joined');
      this.listener.error(null);
      if (early) {
        this.watch.stop();
        this.listener.state(early);
      } else this.watch.accepted();
      if (awards) this.listener.playtestAwards(awards);
      this.caughtUp();
      this.release(true);
    } else {
      this.watch.stop();
      this.release(false);
      if (res.error.code === 'backroom-locked')
        this.listener.lockReason(res.error.reason ?? 'none');
      this.setStatus(res.error.code === 'backroom-locked' ? 'locked' : 'error');
      this.listener.error(res.error.message);
    }
  }

  private release(ok: boolean) {
    const taps = this.held;
    this.held = [];
    for (const t of taps) {
      clearTimeout(t.timer);
      if (ok) t.send();
      else t.fail();
    }
  }

  private reconnect() {
    this.socket.disconnect();
    this.socket.connect();
  }

  private caughtUp() {
    clearTimeout(this.catchUpTimer);
    if (!this.catching) return;
    this.catching = false;
    this.listener.catchingUp(false);
  }

  /** The identity is settled: join now if the socket is up (else its `connect` does), and on
   * every reconnect after. `who` is read at each join, so a rejoin never reverts a rename. */
  enable(who: () => Joiner) {
    if (this.joiner) return;
    this.joiner = who;
    if (this.socket.connected && !this.joined) this.join();
  }

  /**
   * The page was hidden or shown. A phone that slept mid-join can come back to a socket that
   * looks fine but is dead: start over on a fresh connection. One that was in the room and slept
   * past the heartbeat reconnects at once instead of waiting for a tap to find out. A socket
   * closed on purpose (kicked, locked out, closed, left) is no longer `active` and stays closed.
   */
  visibility(visible: boolean, now = Date.now()) {
    if (!visible) {
      this.hiddenAt = now;
      return;
    }
    const away = this.hiddenAt ? now - this.hiddenAt : 0;
    this.hiddenAt = 0;
    if (!this.joiner || !this.socket.active) return;
    if (!this.joined) return this.reconnect();
    if (away < CATCH_UP_AFTER_MS) return;
    this.catching = true;
    this.listener.catchingUp(true);
    clearTimeout(this.catchUpTimer);
    if (heartbeatExpired(this.socket)) this.reconnect();
    // Still connected: anything missed was queued on the connection and lands at once.
    else this.catchUpTimer = setTimeout(() => this.caughtUp(), CATCH_UP_GRACE_MS);
  }

  /** Sends one event to the room, once the page is in it; resolves with the server's answer. */
  call(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<Ack> {
    const socket = this.socket;
    return new Promise((resolve) => {
      const send = () =>
        (socket.timeout(ACK_MS).emit as (...a: unknown[]) => void)(
          event,
          ...args,
          (err: unknown, res: Ack) =>
            resolve(
              err
                ? {
                    ok: false,
                    error: { code: 'timeout', message: 'The server did not respond. Try again.' },
                  }
                : res,
            ),
        );
      const fail = () => resolve(offline);
      // Closed on purpose: nothing to wait for.
      if (!socket.active) return fail();
      if (this.joined && socket.connected && !heartbeatExpired(socket)) return send();
      // Asleep past the heartbeat: reconnect now and send the tap after the rejoin.
      if (this.joined) this.reconnect();
      const tap: HeldTap = {
        send,
        fail,
        timer: setTimeout(() => {
          this.held = this.held.filter((t) => t !== tap);
          fail();
        }, HOLD_MS),
      };
      this.held.push(tap);
    });
  }

  /** Leaves the room for good. */
  async leave() {
    await this.call('room:leave');
    this.end('left');
  }

  /** Hangs up for good, staying a member (a page that can't show the room). */
  close() {
    this.socket.disconnect();
  }

  /** The page is gone: its connection stays open briefly for the next room page. */
  dispose() {
    this.watch.stop();
    clearTimeout(this.catchUpTimer);
    this.release(false);
    for (const off of this.off) off();
    giveBack(this.socket, this.url);
  }
}
