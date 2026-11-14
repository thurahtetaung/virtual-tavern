import type { GameRoomInfo } from '@vt/game-sdk';
import type { Ack, AckWith, LinkCode, LinkStatus, RoomSnapshot } from '@vt/protocol';
import {
  BotNames,
  Button,
  Drawer,
  Icon,
  Modal,
  PlayerColors,
  clock,
  cn,
  useSecondsLeft,
} from '@vt/ui';
import { setPageMuted } from '@vt/ui/sound';
import { Poster, PosterInfoProvider, useShowProfile } from '@vt/ui/show';
import qrcode from 'qrcode-generator';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientGame } from '../games/registry.ts';
import { linkUrl } from '../lib/links.ts';
import { useUnchanged } from '../lib/unchanged.ts';
import { useRoom } from '../lib/useRoom.ts';
import { GenericStage } from '../stage/GenericStage.tsx';
import { showStarted, startShow } from '../stage/start.ts';

/** How long the PC waits for a dropped phone before it takes the controls itself. */
export const PHONE_DROP_MS = 10_000;
/** How long the "Your phone is linked" moment shows before the PC turns into the table screen. */
const LINKED_MOMENT_MS = 2_500;

type Call = (event: 'room:link-code' | 'room:link-cancel' | 'room:unlink') => Promise<Ack>;

/** The address the phone opens, shown short (the QR carries the code in the fragment). */
const linkHost = () => `${window.location.host}/link`;

/** A QR code drawn by the library as one path, on a white tile so every camera reads it. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { d, size: n + 4 };
  }, [text]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${path.size} ${path.size}`}
      className="size-full rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <path d={path.d} fill="#000" />
    </svg>
  );
}

/** The desktop nudge under the room's header (games with a table screen only). */
export function LinkNudge({ onLink, onHide }: { onLink: () => void; onHide: () => void }) {
  return (
    <div
      data-testid="link-nudge"
      className="mb-3 flex items-center gap-3 rounded-xl bg-accent-soft px-4 py-2.5 ring-1 ring-accent-line"
    >
      <Icon name="smartphone" size={22} className="shrink-0 text-accent-text" />
      <p className="min-w-0 flex-1 text-sm">
        <strong>Play on your phone, watch here.</strong> Link your phone and this screen becomes the
        table screen, with the music and the voices. Your phone keeps your secrets.
      </p>
      <Button size="sm" className="min-h-11 shrink-0" onClick={onLink}>
        Link my phone
      </Button>
      <button
        type="button"
        aria-label="Hide this tip"
        onClick={onHide}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-sunk focus-visible:outline-3 focus-visible:outline-focus"
      >
        <Icon name="x" size={20} />
      </button>
    </div>
  );
}

/**
 * The PC's pairing card: a QR code and four letters for the phone, renewed by itself while the
 * card is open; withdrawn when it closes. Once the phone links it says so for a moment, then the
 * PC turns into the table screen (or stays on the controls).
 */
export function PairingCard({
  open,
  onClose,
  call,
  clockOffset,
  name,
  linked,
  onTableScreen,
}: {
  open: boolean;
  onClose: () => void;
  call: Call;
  clockOffset: number;
  /** The player's name (the phone joins as them). */
  name: string;
  /** A phone is linked now. */
  linked: boolean;
  /** The linked moment ended: the PC becomes the table screen (`false`: stay on the controls). */
  onTableScreen: (on: boolean) => void;
}) {
  const [code, setCode] = useState<LinkCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The phone linked while this card was open. */
  const [done, setDone] = useState(false);
  const left = useSecondsLeft(code?.expiresAt ?? null, clockOffset);
  const [wasLinked, setWasLinked] = useState(linked);
  if (linked !== wasLinked) {
    setWasLinked(linked);
    if (linked && open) setDone(true);
  }
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDone(false);
      setCode(null);
      setError(null);
    }
  }

  // A code while the card is open, and a fresh one by itself when it runs out.
  const expired = code !== null && left !== null && left <= 0;
  useEffect(() => {
    if (!open || done || (code && !expired)) return;
    let stale = false;
    void (call('room:link-code') as unknown as Promise<AckWith<LinkCode>>).then((res) => {
      if (stale) return;
      if (res.ok) {
        setCode(res.data);
        setError(null);
      } else setError(res.error.message);
    });
    return () => {
      stale = true;
    };
  }, [open, done, code, expired, call]);

  // The moment passes, then the PC turns into the table screen.
  const onTable = useRef(onTableScreen);
  useEffect(() => {
    onTable.current = onTableScreen;
  });
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => onTable.current(true), LINKED_MOMENT_MS);
    return () => clearTimeout(t);
  }, [done]);

  const close = () => {
    if (!done) void call('room:link-cancel');
    onClose();
  };

  if (done)
    return (
      <Modal open={open} onClose={() => onTableScreen(true)} title="Your phone is linked" size="sm">
        <div data-testid="link-done" className="space-y-4">
          <p className="flex items-start gap-2">
            <Icon name="check" size={22} className="mt-0.5 shrink-0 text-success-ink" />
            <span>
              Your phone now plays as <strong>{name}</strong>. Starting the table screen on this
              screen…
            </span>
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" className="min-h-11" onClick={() => onTableScreen(false)}>
              Stay on the controls
            </Button>
          </div>
        </div>
      </Modal>
    );

  return (
    <Modal
      open={open}
      onClose={close}
      title="Link your phone"
      footer={
        <Button variant="secondary" className="min-h-11" onClick={close}>
          Cancel
        </Button>
      }
    >
      <div className="flex gap-5 max-sm:flex-col" data-testid="link-card">
        <div className="size-44 shrink-0 self-center">
          {code ? (
            <QrCode
              text={linkUrl(window.location.origin, code.code)}
              label="QR code that opens the link page"
            />
          ) : (
            <div className="size-full animate-pulse rounded-lg bg-sunk" />
          )}
        </div>
        <ol className="min-w-0 flex-1 space-y-3 text-sm">
          <li className="flex gap-2">
            <Step n={1} />
            <span>Point your phone’s camera at the code.</span>
          </li>
          <li className="flex gap-2">
            <Step n={2} />
            <span>
              Or open <strong className="font-mono break-all">{linkHost()}</strong> on your phone
              and type:
            </span>
          </li>
          <li>
            <p
              className="flex gap-2"
              data-testid="link-code"
              aria-label={code ? `Code ${code.code.split('').join(' ')}` : 'Getting a code'}
            >
              {(code?.code ?? '    ').split('').map((ch, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="inline-flex h-14 w-12 items-center justify-center rounded-lg bg-card font-mono text-3xl font-bold ring-1 ring-line-strong"
                >
                  {ch}
                </span>
              ))}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <Icon name="clock" size={14} />
              {code && left !== null ? `${clock(Math.max(0, left))} left` : 'Getting a code…'} ·
              works once · a new one comes by itself
            </p>
          </li>
        </ol>
      </div>
      <p className="mt-4 flex items-start gap-2 rounded-lg bg-sunk p-3 text-sm">
        <Icon name="armchair" size={18} className="mt-0.5 shrink-0 text-ink-muted" />
        <span>
          Your phone joins as <strong>{name}</strong>: the same seat and score. This screen then
          becomes the table screen, and you can take the controls back any time.
        </span>
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger-ink">
          {error}
        </p>
      )}
    </Modal>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-text"
    >
      {n}
    </span>
  );
}

/** How long the phone has been away (seconds, counting up), while it is; else null. */
export function usePhoneAway(link: LinkStatus | undefined, clockOffset: number) {
  const away = !!link && !link.phone;
  const [since, setSince] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/purity -- the moment the phone was first seen away
  if (away && since === null) setSince(Date.now() + clockOffset);
  if (!away && since !== null) setSince(null);
  const due = since === null ? null : since + PHONE_DROP_MS;
  const left = useSecondsLeft(due, clockOffset);
  return {
    /** Seconds away so far (0–10), while the phone is away and the PC hasn't taken over yet. */
    seconds: due === null || left === null ? null : Math.max(0, PHONE_DROP_MS / 1000 - left),
    /** The phone has been away `PHONE_DROP_MS`: the PC has the controls. */
    dropped: due !== null && left !== null && left <= 0,
  };
}

/**
 * The PC as its player's table screen: the game's own table-screen view on the spectator view,
 * letterboxed under a slim bar (linked status, sound, Controls here, Unlink). Its sound needs a
 * start tap; with the room's own TV paired it is silent until switched on.
 */
export function PcTableScreen({
  roomId,
  game,
  link,
  awaySeconds,
  tvPresent,
  onControls,
  onUnlink,
}: {
  roomId: string;
  game: ClientGame;
  link: LinkStatus;
  /** The phone has been away this long (null while it's here). */
  awaySeconds: number | null;
  /** The room's own table screen is paired. */
  tvPresent: boolean;
  onControls: () => void;
  onUnlink: () => void;
}) {
  const conn = useRoom(roomId, '', undefined, true, 'show');
  const { snapshot, clockOffset, status } = conn;
  const [started, setStarted] = useState(showStarted);
  /** The player's sound switch for this screen (by default off while a TV has the sound). */
  const [soundChoice, setSoundChoice] = useState<boolean | null>(null);
  const soundOn = soundChoice ?? !tvPresent;
  useEffect(() => {
    setPageMuted(!soundOn);
  }, [soundOn]);
  useEffect(() => {
    return () => {
      setPageMuted(false);
    };
  }, []);
  // The game's table-screen code loads while the start tap waits.
  useEffect(() => {
    void game.stage?.preload().catch(() => {});
  }, [game.stage]);

  const players = useUnchanged(snapshot?.players);
  const view = useUnchanged(snapshot?.game);
  const present = snapshot?.stage?.present === true;
  const stage = useMemo(() => ({ present }), [present]);
  const { profile } = useShowProfile(stage, true);
  const hostId = snapshot?.hostId;
  const room = useMemo(
    (): GameRoomInfo | null =>
      players && hostId !== undefined
        ? {
            you: '',
            hostId,
            isHost: false,
            players,
            clockOffset,
            wordLists: [],
            gameName: game.name,
            stage,
          }
        : null,
    [players, hostId, clockOffset, game.name, stage],
  );
  const colors = useMemo(
    () => new Map((players ?? []).map((p) => [p.name, p.color] as const)),
    [players],
  );
  const bots = useMemo(
    () => new Set((players ?? []).filter((p) => p.bot).map((p) => p.name)),
    [players],
  );
  const info = { emblem: game.icon, name: game.name, code: roomId };
  const Stage = game.stage;

  let body;
  if (!started)
    body = (
      <Poster
        eyebrow="Table screen"
        headline={game.name}
        line="One tap lets this screen play the table’s sound."
      >
        <Button
          size="lg"
          className="mt-6 h-28 px-16 text-[40px]"
          autoFocus
          onClick={() => {
            startShow();
            setStarted(true);
          }}
        >
          ▶ Start the table screen
        </Button>
      </Poster>
    );
  else if (!room || view === undefined || status === 'locked' || status === 'error')
    body = <Poster headline="Opening the door…" line="This screen is joining the room." />;
  else if (Stage)
    body = (
      <Suspense fallback={<Poster headline="Setting up the table…" />}>
        <Stage
          view={view}
          room={room}
          act={() => Promise.resolve(false)}
          showGuide={() => {}}
          profile={profile}
        />
      </Suspense>
    );
  else body = <GenericStage room={room} />;

  return (
    <div
      className="fixed inset-0 z-20 flex flex-col bg-page text-ink"
      data-testid="pc-table-screen"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <span aria-hidden className="text-xl leading-none">
          {game.icon}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">{game.name}</span>
        <StatusChip link={link} awaySeconds={awaySeconds} />
        <Button
          size="sm"
          variant="secondary"
          className="min-h-9"
          aria-pressed={soundOn}
          onClick={() => setSoundChoice(!soundOn)}
        >
          <Icon name={soundOn ? 'volume-2' : 'volume-x'} size={16} />
          {soundOn ? 'Sound on' : tvPresent ? 'Table screen has the sound' : 'Sound off'}
        </Button>
        <Button size="sm" variant="secondary" className="min-h-9" onClick={onControls}>
          <Icon name="gamepad-2" size={16} />
          Controls here
        </Button>
        <Button size="sm" variant="secondary" className="min-h-9" onClick={onUnlink}>
          Unlink
        </Button>
      </div>
      {status === 'reconnecting' && (
        <p
          role="status"
          className="bg-warn-soft py-1 text-center text-sm font-semibold text-warn-ink"
        >
          Connection lost. Reconnecting…
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        <PosterInfoProvider value={info}>
          <BotNames.Provider value={bots}>
            <PlayerColors.Provider value={colors}>{body}</PlayerColors.Provider>
          </BotNames.Provider>
        </PosterInfoProvider>
      </div>
    </div>
  );
}

function StatusChip({ link, awaySeconds }: { link: LinkStatus; awaySeconds: number | null }) {
  const here = link.phone;
  return (
    <span
      data-testid="phone-status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        here ? 'bg-success-soft text-success-ink' : 'bg-warn-soft text-warn-ink',
      )}
    >
      <span aria-hidden className={cn('size-2 rounded-full', here ? 'bg-success' : 'bg-warn')} />
      <Icon name="smartphone" size={14} />
      {here
        ? 'Phone linked'
        : `Phone offline${awaySeconds !== null ? ` · ${clock(Math.floor(awaySeconds))}` : ''}`}
    </span>
  );
}

/**
 * The PC's strip while a phone is linked and the PC shows the controls: by choice (Controls
 * here), because the phone dropped out, or in a game without a table screen.
 */
export function LinkedStrip({
  kind,
  onTableScreen,
  onUnlink,
}: {
  kind: 'controls' | 'dropped' | 'no-table';
  onTableScreen: () => void;
  onUnlink: () => void;
}) {
  return (
    <div
      data-testid={`linked-strip-${kind}`}
      className={cn(
        'mb-3 flex items-center gap-3 rounded-xl px-4 py-2 text-sm ring-1',
        kind === 'dropped'
          ? 'bg-warn-soft text-warn-ink ring-warn-line'
          : kind === 'no-table'
            ? 'bg-success-soft text-success-ink ring-success-line'
            : 'bg-info-soft text-info-ink ring-info-line',
      )}
    >
      <Icon name="smartphone" size={20} className="shrink-0" />
      <p className="min-w-0 flex-1">
        {kind === 'controls' && (
          <>
            <strong>Your phone is linked</strong> and can play too. This PC has the controls for
            now.
          </>
        )}
        {kind === 'dropped' && (
          <>
            <strong>Your phone dropped out,</strong> so the controls are here. When it’s back, this
            screen goes back to the table screen.
          </>
        )}
        {kind === 'no-table' && (
          <>
            <strong>Your phone is linked.</strong> This game has no table screen, so you can play on
            either one.
          </>
        )}
      </p>
      {kind === 'no-table' ? (
        <Button size="sm" variant="secondary" className="min-h-11 shrink-0" onClick={onUnlink}>
          Unlink
        </Button>
      ) : (
        <Button size="sm" variant="secondary" className="min-h-11 shrink-0" onClick={onTableScreen}>
          <Icon name="tv" size={16} />
          Back to the table screen
        </Button>
      )}
    </div>
  );
}

/** The phone's strip while its PC is away (the phone then plays the full sound and pictures). */
export function PcAwayStrip() {
  return (
    <div
      data-testid="pc-away"
      className="mb-3 flex items-center gap-3 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn-ink ring-1 ring-warn-line"
    >
      <Icon name="monitor" size={20} className="shrink-0" />
      <p>
        <strong>Your PC dropped out,</strong> so this phone plays the sound and the pictures until
        it’s back.
      </p>
    </div>
  );
}

/** The phone's sheet behind its PC header button: the PC's status, and unlinking. */
export function PcSheet({
  open,
  onClose,
  name,
  link,
  onUnlink,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  link: LinkStatus | undefined;
  onUnlink: () => void;
}) {
  const pc = link?.pc === true;
  return (
    <Drawer open={open} onClose={onClose} title="Linked to your PC">
      <div className="space-y-4" data-testid="pc-sheet">
        <p>
          This phone and your PC both play as <strong>{name}</strong>. The PC shows the table
          screen; this phone has your controls and private notes.
        </p>
        <p
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1',
            pc
              ? 'bg-success-soft text-success-ink ring-success-line'
              : 'bg-warn-soft text-warn-ink ring-warn-line',
          )}
        >
          <span aria-hidden className={cn('size-2 rounded-full', pc ? 'bg-success' : 'bg-warn')} />
          {!pc
            ? 'PC away: this phone plays the sound until it’s back'
            : link?.show
              ? 'PC connected · on the table screen'
              : 'PC connected · on the controls'}
        </p>
        <Button variant="danger" className="min-h-11 w-full" onClick={onUnlink}>
          Unlink this phone
        </Button>
      </div>
    </Drawer>
  );
}

/** Whether the snapshot's player has a linked phone (the field is only in their own snapshot). */
export const linkOf = (snapshot: RoomSnapshot | null): LinkStatus | undefined => snapshot?.link;
