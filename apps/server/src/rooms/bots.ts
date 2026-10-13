import { type BotCtx, createRng } from '@vt/game-sdk';
import type { PlaytestSpeed } from '@vt/protocol';
import type { RoomManager } from './manager.ts';

/** How a bot's thinking time scales with the playtest's speed. */
export const SPEED: Record<PlaytestSpeed, number> = { fast: 0.25, normal: 1, slow: 2 };
/** Most bot moves a room may see in one second; more wait a little. */
export const MAX_PER_SECOND = 3;
/** Most bot moves in an hour of one playtest; more means they are stuck, so they pause. */
export const MAX_PER_HOUR = 600;

/** A move that is just a button press ("Ready", "done presenting"…): quicker than a choice. */
const TRIVIAL = new Set([
  'ready',
  'ready-to-vote',
  'done-presenting',
  'sit',
  'lie-for-me',
  'reversal-confirm',
]);

export interface BotRunnerLogger {
  debug?(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface BotRunnerDeps {
  rooms: RoomManager;
  /** Word lists for `BotCtx.words` (never questions, answers or decoys). */
  words: (gameId: string, listIds: readonly string[]) => string[];
  logger: BotRunnerLogger;
  /** Server time, for the bots' view of deadlines. */
  now?: () => number;
  /** Real time between moves, for the rate caps. Default `Date.now`. */
  clock?: () => number;
  /** How long a bot thinks before a move (ms), before the speed factor. Tests pass their own. */
  delay?: (trivial: boolean) => number;
  /** A fresh seed for each move's rng. */
  seed?: () => number;
}

interface RoomRun {
  /** Each bot's pending move. */
  timers: Map<string, NodeJS.Timeout>;
  /** The version a bot's move was refused at: it waits for the next change before trying again. */
  refusedAt: Map<string, number>;
  /** The version a bot's hook threw at (logged once per version). */
  threwAt: Map<string, number>;
  /** When recent bot moves were made (the last hour). */
  moves: number[];
}

/**
 * Plays a playtest's bot seats on the server. Every room change pokes it; each bot that has
 * something to do moves after a human-like pause, from fresh state at that moment: its own seat's
 * `view()` only, its game's `bot` hook, then the room's normal `act`, exactly like a player.
 * Nothing runs unless a human seat is connected, and nothing runs while paused.
 */
export class BotRunner {
  private readonly runs = new Map<string, RoomRun>();
  private readonly deps: Required<BotRunnerDeps>;

  constructor(deps: BotRunnerDeps) {
    this.deps = {
      now: Date.now,
      clock: Date.now,
      // Normal pace: 1.5–4 s to choose, 0.6–1.2 s to press a button.
      delay: (trivial) => (trivial ? 600 + Math.random() * 600 : 1500 + Math.random() * 2500),
      seed: () => Math.floor(Math.random() * 2 ** 32),
      ...deps,
    };
  }

  /** The room changed: (re)schedule any bot that now has a move to make. */
  poke(roomId: string): void {
    const table = this.deps.rooms.botTable(roomId);
    if (!table || table.paused || table.humans === 0 || table.bots.length === 0) {
      this.stop(roomId);
      return;
    }
    let run = this.runs.get(roomId);
    if (!run) {
      run = { timers: new Map(), refusedAt: new Map(), threwAt: new Map(), moves: [] };
      this.runs.set(roomId, run);
    }
    for (const [id, timer] of run.timers) {
      if (!table.bots.includes(id)) {
        clearTimeout(timer);
        run.timers.delete(id);
      }
    }
    for (const botId of table.bots) {
      if (run.timers.has(botId) || run.refusedAt.get(botId) === table.version) continue;
      // A look now only sets the pace; the move itself is worked out again when it is made.
      const move = this.decide(roomId, botId, run);
      if (!move) continue;
      const wait = this.deps.delay(TRIVIAL.has(move.type)) * SPEED[table.speed];
      const r = run;
      r.timers.set(
        botId,
        setTimeout(() => {
          r.timers.delete(botId);
          this.fire(roomId, botId);
        }, wait),
      );
    }
  }

  /** Cancels a room's pending moves (it ended, was paused, or every human left). */
  stop(roomId: string): void {
    const run = this.runs.get(roomId);
    if (!run) return;
    for (const timer of run.timers.values()) clearTimeout(timer);
    this.runs.delete(roomId);
  }

  close(): void {
    for (const id of [...this.runs.keys()]) this.stop(id);
  }

  /** Whether a bot has a move pending (for tests). */
  pending(roomId: string): number {
    return this.runs.get(roomId)?.timers.size ?? 0;
  }

  private fire(roomId: string, botId: string) {
    const { rooms, logger } = this.deps;
    const run = this.runs.get(roomId);
    const table = rooms.botTable(roomId);
    if (!run || !table || table.paused || table.humans === 0) return;
    const now = this.deps.clock();
    run.moves = run.moves.filter((t) => t > now - 60 * 60_000);
    if (run.moves.length >= MAX_PER_HOUR) {
      logger.warn({ roomId, playtest: true }, 'playtest bots made too many moves; paused');
      rooms.setPlaytest(roomId, { paused: true, stuck: true });
      return;
    }
    if (run.moves.filter((t) => t > now - 1000).length >= MAX_PER_SECOND) {
      run.timers.set(
        botId,
        setTimeout(() => {
          run.timers.delete(botId);
          this.fire(roomId, botId);
        }, 1000),
      );
      return;
    }
    const move = this.decide(roomId, botId, run);
    if (!move) return;
    run.moves.push(now);
    const res = rooms.act(roomId, botId, move);
    if (!res.ok && table.game.botInfo?.retry?.(res.error.code)) {
      // A refusal the game says is worth another go: try again after the usual pause.
      const wait = this.deps.delay(false) * SPEED[table.speed];
      run.timers.set(
        botId,
        setTimeout(() => {
          run.timers.delete(botId);
          this.fire(roomId, botId);
        }, wait),
      );
      return;
    }
    if (!res.ok) {
      run.refusedAt.set(botId, table.version);
      logger.debug?.(
        { roomId, botId, action: move.type, code: res.error.code, playtest: true },
        'bot move refused',
      );
    }
  }

  /** The bot's move from its own seat's view, now; null when it has none (or its hook threw). */
  private decide(roomId: string, botId: string, run: RoomRun): { type: string } | null {
    const table = this.deps.rooms.botTable(roomId);
    const seen = this.deps.rooms.botView(roomId, botId);
    if (!table?.game.bot || !seen) return null;
    const ctx: BotCtx = {
      me: botId,
      now: this.deps.now(),
      rng: createRng(this.deps.seed()),
      words: (ids) => this.deps.words(table.game.id, ids),
    };
    try {
      const move: unknown = table.game.bot(seen.view, ctx);
      return move !== null &&
        typeof move === 'object' &&
        typeof (move as { type?: unknown }).type === 'string'
        ? (move as { type: string })
        : null;
    } catch (err) {
      if (run.threwAt.get(botId) !== seen.version) {
        run.threwAt.set(botId, seen.version);
        this.deps.logger.warn({ roomId, botId, err, playtest: true }, 'bot hook threw');
      }
      return null;
    }
  }
}
