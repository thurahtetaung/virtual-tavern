import { type GameUiProps, storageKey } from '@vt/game-sdk';
import {
  Button,
  Hint,
  LobbySettings,
  PHONE,
  Modal,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  StickyBar,
  Superlatives,
  Switch,
  cn,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { leftAt, timerText } from '../logic/bomb.ts';
import { MIN_PLAYERS } from '../logic/game.ts';
import {
  type Action,
  type DefuserMode,
  type ModuleOp,
  type PageId,
  SOLVABLE,
  type Settings,
  type SolvableKind,
  isNeedy,
} from '../logic/types.ts';
import type { BombView, DefuseView } from '../logic/view.ts';
import { type Art, artFor, useManifest } from './assets.ts';
import { Binder } from './Binder.tsx';
import { BombScreen } from './Bomb.tsx';
import { ClaimsSummary, Manual } from './Manual.tsx';
import { ModuleFace } from './Modules.tsx';
import { haptics, hapticOf } from './haptics.ts';
import { DefuseLobbySound, DefuseSoundButton } from './Sound.tsx';
import { player, useBombSound, useDefuseVolumes, usePlayerVolumes } from './sound.ts';
import { clockText, serverNow, useServerNow } from './time.ts';
import { Bomb3D, useViewMode } from './three/Bomb3D.tsx';
import type { Mirror } from './three/scene.ts';

/** A defused bomb's room stays 6 s and fades out over 3 s before the binder (`BombDefused`). */
const DEFUSED_ROOM_MS = 9000;

export type DefuseUiProps = GameUiProps<DefuseView, Action>;

const INTRO_KEY = 'vt.defuse.talk-intro';

const MODE_LABEL: Record<DefuserMode, string> = {
  rotate: 'Host picks, then rotate',
  random: 'Random each bomb',
  volunteer: 'Volunteer each bomb',
};

const seen = (key: string) => {
  try {
    return localStorage.getItem(storageKey(key)) === '1';
  } catch {
    return true;
  }
};
const remember = (key: string) => {
  try {
    localStorage.setItem(storageKey(key), '1');
  } catch {
    // private window
  }
};

export function DefuseGame({
  view: v,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
}: DefuseUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = useMemo(() => new Map(room.players.map((p) => [p.id, p.name])), [room.players]);
  const you = room.you;
  const nameOf = (id: string | null) =>
    id ? (names.get(id) ?? v.seats.find((p) => p.id === id)?.name ?? 'Someone') : 'Nobody';
  const [volumes] = useDefuseVolumes();
  usePlayerVolumes(volumes);
  const [mode, setMode] = useViewMode();
  // The defuser's device plays the bomb, and its end once the defuser has become an expert again.
  const playsBomb =
    (v.stage === 'bomb' && v.role === 'defuser') ||
    (v.stage === 'result' && v.history.at(-1)?.defuser === you);
  useBombSound(playsBomb ? v.bomb : null, art, room.clockOffset, {
    buzz: true,
    room: mode === '3d',
  });
  useEffect(() => {
    return () => {
      player.setMusic(null);
    };
  }, []);
  useEffect(() => {
    setYourMove?.(v.role === 'defuser' && v.stage === 'bomb');
  }, [setYourMove, v.role, v.stage]);
  const watching = v.role === 'watcher';
  useSpectatorPrompt(
    setSpectator,
    watching ? { text: 'The table is full: you see what the experts see.' } : null,
  );
  const send = (a: Action, anchor?: string) => {
    void act(a, anchor ? { anchor } : undefined);
  };
  const soundProps = { v, room, art, send, playsBomb, nameOf };
  const mute = <DefuseSoundButton {...soundProps} className="rounded-full px-2 text-lg" />;

  // A table screen showing the bomb follows how the defuser looks at it.
  const tableFollows = v.stage === 'bomb' && v.role === 'defuser' && v.settings.table === 'bomb';
  const sentLook = useRef('');
  const sendLook = (m: Mirror | null) => {
    if (!tableFollows) return;
    const look = m
      ? { mode: '3d' as const, ...m }
      : { mode: '2d' as const, pose: 'held' as const, yaw: 0, settle: 0, module: null };
    const key = JSON.stringify(look);
    if (key === sentLook.current) return;
    sentLook.current = key;
    void act({ type: 'look', ...look });
  };
  useEffect(() => {
    if (!tableFollows) {
      sentLook.current = '';
      return;
    }
    // The table screen starts from the bomb on the desk (or the flat view); turns follow.
    sendLook(mode === '2d' ? null : { pose: 'desk', yaw: 0, settle: 0, module: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableFollows, mode, v.bombNo]);
  // The end, as the original: the bomb gone and the room dark with the boom, then the results.
  const last = v.history.at(-1);
  const [, setTick] = useState(0);
  const defusedAt = v.stage === 'result' && v.bomb?.end?.how === 'defused' ? v.bomb.end.at : null;
  const slapUntil =
    defusedAt !== null && last?.defuser === you && mode === '3d' ? defusedAt + DEFUSED_ROOM_MS : 0;
  // The binder takes over at once (black first); a defuser's defused room fades out before it.
  const binderFrom = slapUntil;
  const [closed, setClosed] = useState(-1);
  // The next defuser sits at the desk with the briefcase (3D), unless they went back to the lobby.
  const [leftDesk, setLeftDesk] = useState(false);
  useEffect(() => {
    const wait = Math.max(slapUntil, binderFrom) - serverNow(room.clockOffset);
    if (wait <= 0) return;
    const id = setTimeout(() => setTick((n) => n + 1), wait + 50);
    return () => {
      clearTimeout(id);
    };
  }, [slapUntil, binderFrom, room.clockOffset]);
  const viewSwitch = (
    <button
      type="button"
      onClick={() => setMode(mode === '3d' ? '2d' : '3d')}
      className="rounded-full bg-stone-800 px-3 py-2 text-sm text-stone-100"
      data-testid="view-switch"
    >
      {mode === '3d' ? 'Flat 2D view' : '3D view'}
    </button>
  );
  if (v.stage === 'bomb' && v.role === 'defuser' && v.bomb) {
    const actOn = (module: string, op: ModuleOp) =>
      send({ type: 'act', module, ...op, at: serverNow(room.clockOffset) });
    if (mode === '3d')
      return (
        <Bomb3D
          key={v.bomb.no}
          b={v.bomb}
          art={art}
          offset={room.clockOffset}
          act={actOn}
          onPose={sendLook}
          snooze={() => send({ type: 'alarm' })}
          test={!!v.test}
          corner={
            <>
              <span className="rounded-full bg-stone-800 px-1">{mute}</span>
              <button
                type="button"
                className="rounded-full bg-stone-800 px-3 py-2 text-sm"
                onClick={() => showGuide()}
              >
                Rules
              </button>
              {viewSwitch}
            </>
          }
        />
      );
    return (
      <Defuser
        b={v.bomb}
        art={art}
        offset={room.clockOffset}
        mute={mute}
        act={(module, op) => {
          // The flat view buzzes as the 3D one does (a release gives none, as the original).
          haptics.buzz(hapticOf(undefined, op, op.op === 'up'));
          actOn(module, op);
        }}
        showGuide={showGuide}
        viewSwitch={viewSwitch}
      />
    );
  }
  if (slapUntil > serverNow(room.clockOffset) && v.bomb)
    return <Bomb3D key={v.bomb.no} b={v.bomb} art={art} offset={room.clockOffset} act={null} />;
  if (v.stage === 'bomb')
    return (
      <Expert
        v={v}
        art={art}
        you={you}
        names={names}
        offset={room.clockOffset}
        defuser={nameOf(v.defuser)}
        isHost={room.isHost}
        send={send}
      />
    );
  if (
    v.stage === 'result' &&
    v.bomb?.end &&
    closed !== v.bomb.no &&
    serverNow(room.clockOffset) >= binderFrom
  )
    return (
      <Binder
        b={v.bomb}
        settings={v.settings}
        art={art}
        offset={room.clockOffset}
        sound={last?.defuser === you}
        room={slapUntil > 0}
        retry={room.isHost ? () => send({ type: 'next' }) : null}
        close={() => setClosed(v.bomb!.no)}
      />
    );
  if (v.stage === 'result' && v.bomb)
    return (
      <Result
        v={v}
        b={v.bomb}
        art={art}
        you={you}
        isHost={room.isHost}
        nameOf={nameOf}
        superlatives={room.superlatives}
        send={send}
      />
    );
  const seatedHere = v.seats.some((p) => p.id === you);
  const deskable =
    v.stage === 'lobby' &&
    mode === '3d' &&
    seatedHere &&
    v.defuser === you &&
    v.settings.defuserMode !== 'random' &&
    v.seats.length >= MIN_PLAYERS;
  if (deskable && !leftDesk)
    return (
      <Bomb3D
        b={null}
        briefcase={{ settings: v.settings, start: () => send({ type: 'start' }) }}
        leave={() => setLeftDesk(true)}
        art={art}
        offset={room.clockOffset}
        act={() => {}}
        test={!!v.test}
        corner={
          <>
            <span className="rounded-full bg-stone-800 px-1">{mute}</span>
            <button
              type="button"
              className="rounded-full bg-stone-800 px-3 py-2 text-sm"
              onClick={() => showGuide()}
            >
              Rules
            </button>
            {viewSwitch}
          </>
        }
      />
    );
  return (
    <Lobby
      v={v}
      desk={deskable ? () => setLeftDesk(false) : null}
      you={you}
      isHost={room.isHost}
      nameOf={nameOf}
      send={send}
      showGuide={showGuide}
      art={art}
      viewChoice={<ViewChoice mode={mode} setMode={setMode} />}
      sound={<DefuseLobbySound {...soundProps} />}
    />
  );
}

/** Each player's own choice of how they see the bomb when they defuse (kept on this device). */
function ViewChoice({ mode, setMode }: { mode: '3d' | '2d'; setMode: (m: '3d' | '2d') => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 text-sm" data-testid="view-choice">
      <span className="font-semibold">When you defuse:</span>
      {(['3d', '2d'] as const).map((m) => (
        <Button
          key={m}
          size="sm"
          variant={mode === m ? 'primary' : 'secondary'}
          onClick={() => setMode(m)}
          aria-pressed={mode === m}
          data-testid={`view-${m}`}
        >
          {m === '3d' ? '3D bomb' : 'Flat 2D view'}
        </Button>
      ))}
    </div>
  );
}

// ---- The defuser ----

function Defuser({
  b,
  art,
  offset,
  act,
  mute,
  showGuide,
  viewSwitch,
}: {
  b: BombView;
  art: Art;
  offset: number;
  act: (module: string, op: ModuleOp) => void;
  mute: React.ReactNode;
  showGuide: (t?: unknown) => void;
  viewSwitch: React.ReactNode;
}) {
  const now = useServerNow(offset, 40);
  const [tip, setTip] = useState(() => !seen('vt.defuse.defuser-tip'));
  return (
    <div className="mx-auto max-w-6xl space-y-3" data-testid="defuser">
      <p className="text-center text-sm font-semibold" data-testid="status">
        💣 You are defusing. Describe what you see; your experts have the manual.
      </p>
      {tip && (
        <Hint>
          <span>
            Tap a module to open it. Swipe or use the tabs to turn the bomb: the edges hold the
            serial number, batteries, indicators and ports.{' '}
          </span>
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => {
              remember('vt.defuse.defuser-tip');
              setTip(false);
            }}
          >
            Got it
          </button>
        </Hint>
      )}
      <BombScreen key={b.no} b={b} art={art} now={now} act={act} />
      <div className="flex items-center justify-center gap-2 text-sm text-ink-muted">
        {mute}
        <button type="button" className="underline" onClick={() => showGuide()}>
          Rules
        </button>
        {viewSwitch}
      </div>
    </div>
  );
}

// ---- The experts ----

function ExpertClock({ v, offset }: { v: DefuseView; offset: number }) {
  const now = useServerNow(offset, 100, !!v.clock);
  if (!v.clock) return <span className="text-xs text-ink-muted">Ask the defuser for the time</span>;
  const left = leftAt({ ...v.clock, end: v.clock.end }, now);
  return (
    <span className="flex items-center gap-2 font-mono font-bold" data-testid="expert-clock">
      <span style={{ color: '#dc2626' }}>{timerText(left)}</span>
      <span className="text-xs font-normal text-ink-muted">
        {v.clock.strikes} of {v.clock.strikeLimit} strikes
      </span>
    </span>
  );
}

function Expert({
  v,
  art,
  you,
  names,
  offset,
  defuser,
  isHost,
  send,
}: {
  v: DefuseView;
  art: Art;
  you: string;
  names: Map<string, string>;
  offset: number;
  defuser: string;
  isHost: boolean;
  send: (a: Action, anchor?: string) => void;
}) {
  const [hand, setHand] = useState(false);
  const defuserHere = v.seats.some((p) => p.id === v.defuser);
  return (
    <div className="mx-auto max-w-3xl space-y-3" data-testid="expert">
      <Panel className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
        <span className="min-w-0 flex-1 text-sm font-semibold" data-testid="status">
          📖 {defuser} is defusing bomb {v.bombNo}: read them the manual.
        </span>
        <ExpertClock v={v} offset={offset} />
        {isHost && defuserHere && (
          <button
            type="button"
            className="text-xs text-ink-muted underline"
            onClick={() => setHand(true)}
          >
            Hand the bomb over
          </button>
        )}
      </Panel>
      {!defuserHere && (
        <Hint>
          {defuser} has left. The clock is still running.
          {isHost && (
            <Button size="sm" className="ml-2" onClick={() => setHand(true)}>
              Hand the bomb over
            </Button>
          )}
        </Hint>
      )}
      <Manual
        v={v}
        art={art}
        you={you}
        names={names}
        act={v.role === 'expert' ? (a) => send(a) : undefined}
      />
      <details className="rounded-xl bg-card px-3 py-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-800">
        <summary className="cursor-pointer text-sm font-semibold">Who has claimed what</summary>
        <div className="pt-2">
          <ClaimsSummary v={v} names={names} art={art} />
        </div>
      </details>
      <Modal open={hand} onClose={() => setHand(false)} title="Hand the bomb to…">
        <div className="grid gap-2">
          {v.seats
            .filter((p) => p.id !== v.defuser)
            .map((p) => (
              <Button
                key={p.id}
                variant="secondary"
                onClick={() => {
                  send({ type: 'hand-over', player: p.id });
                  setHand(false);
                }}
              >
                <PlayerTag name={p.name} />
              </Button>
            ))}
        </div>
      </Modal>
    </div>
  );
}

// ---- Lobby and settings ----

function SettingsForm({
  s,
  editable,
  send,
  art,
}: {
  s: Settings;
  editable: boolean;
  send: (a: Action, anchor?: string) => void;
  art: Art;
}) {
  const set = (settings: Partial<Settings>) =>
    send({ type: 'settings', settings }, 'defuse-settings');
  const vetoes = new Set(s.vetoes);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-sm font-semibold">Time</span>
          <select
            disabled={!editable}
            value={s.time}
            onChange={(e) => set({ time: Number(e.target.value) })}
            className="h-11 w-full rounded-lg bg-card px-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
            data-testid="set-time"
          >
            {Array.from({ length: 20 }, (_, i) => (i + 1) * 30).map((t) => (
              <option key={t} value={t}>
                {clockText(t * 1000)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-sm font-semibold">Modules</span>
          <select
            disabled={!editable}
            value={s.modules}
            onChange={(e) => set({ modules: Number(e.target.value) })}
            className="h-11 w-full rounded-lg bg-card px-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
            data-testid="set-modules"
          >
            {Array.from({ length: 9 }, (_, i) => i + 3).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Switch
        on={s.needy}
        editable={editable}
        title="Needy module"
        help="One of the modules is a needy one that keeps coming back."
        onChange={(needy) => set({ needy })}
        testId="set-needy"
      />
      <Switch
        on={s.hardcore}
        editable={editable}
        title="Hardcore"
        help="One strike and the bomb goes off."
        onChange={(hardcore) => set({ hardcore })}
        testId="set-hardcore"
      />
      <div className="space-y-1">
        <span className="text-sm font-semibold">Who defuses</span>
        <div className="grid gap-1 sm:grid-cols-3">
          {(Object.keys(MODE_LABEL) as DefuserMode[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={s.defuserMode === m ? 'primary' : 'secondary'}
              disabled={!editable}
              onClick={() => set({ defuserMode: m })}
              data-testid={`mode-${m}`}
            >
              {MODE_LABEL[m]}
            </Button>
          ))}
        </div>
      </div>
      <Switch
        on={s.surprises !== false}
        editable={editable}
        title="Room surprises"
        help="While the bomb goes well the lights may go out, or the alarm clock may ring."
        onChange={(surprises) => set({ surprises })}
        testId="set-surprises"
      />
      <Switch
        on={s.expertsSeeClock}
        editable={editable}
        title="Experts see the clock and strikes"
        help="Off, as the original: the defuser calls them out."
        onChange={(expertsSeeClock) => set({ expertsSeeClock })}
        testId="set-clock"
      />
      <div className="space-y-1">
        <span className="text-sm font-semibold">Table screen shows</span>
        <div className="grid grid-cols-2 gap-1">
          {(['manual', 'bomb'] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={s.table === t ? 'primary' : 'secondary'}
              disabled={!editable}
              onClick={() => set({ table: t })}
              data-testid={`table-${t}`}
            >
              {t === 'manual' ? 'Manual' : 'Bomb'}
            </Button>
          ))}
        </div>
      </div>
      <details data-testid="vetoes">
        <summary className="cursor-pointer text-sm font-semibold">
          Leave out up to 3 kinds {s.vetoes.length ? `(${s.vetoes.length} out)` : ''}
        </summary>
        <div className="mt-2 flex flex-wrap gap-1">
          {SOLVABLE.map((k: SolvableKind) => (
            <Button
              key={k}
              size="sm"
              variant={vetoes.has(k) ? 'danger' : 'secondary'}
              disabled={!editable || (!vetoes.has(k) && vetoes.size >= 3)}
              onClick={() =>
                set({ vetoes: vetoes.has(k) ? s.vetoes.filter((x) => x !== k) : [...s.vetoes, k] })
              }
              aria-pressed={vetoes.has(k)}
              data-testid={`veto-${k}`}
            >
              {vetoes.has(k) ? '✕ ' : ''}
              {art.names[k]}
            </Button>
          ))}
        </div>
      </details>
      <RefusalSlot anchor="defuse-settings" />
    </div>
  );
}

/**
 * The settings: folded under a one-line summary for everyone, the host included, so the lobby and
 * the result fit a phone; the host unfolds them to change something.
 */
function SettingsPanel({
  v,
  isHost,
  send,
  art,
}: {
  v: DefuseView;
  isHost: boolean;
  send: (a: Action, anchor?: string) => void;
  art: Art;
}) {
  const s = v.settings;
  const summary = [
    `${s.modules} modules`,
    clockText(s.time * 1000),
    s.needy ? 'needy' : '',
    s.hardcore ? 'Hardcore' : '',
    MODE_LABEL[s.defuserMode],
  ];
  if (!isHost)
    return (
      <LobbySettings editable={false} summary={summary} className="space-y-4">
        <SettingsForm s={s} editable={false} send={send} art={art} />
      </LobbySettings>
    );
  return (
    <details
      className="group rounded-2xl bg-card/85 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800"
      data-testid="settings"
    >
      <summary
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm [&::-webkit-details-marker]:hidden"
        data-testid="settings-toggle"
      >
        <span className="shrink-0 font-semibold">
          <span aria-hidden>⚙️ </span>Settings
        </span>
        <span className="min-w-0 flex-1 truncate text-ink-muted">
          {summary.filter(Boolean).join(' · ')}
        </span>
        <span
          aria-hidden
          className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4">
        <SettingsForm s={s} editable send={send} art={art} />
      </div>
    </details>
  );
}

function DefuserPicker({
  v,
  you,
  isHost,
  nameOf,
  send,
}: {
  v: DefuseView;
  you: string;
  isHost: boolean;
  nameOf: (id: string | null) => string;
  send: (a: Action, anchor?: string) => void;
}) {
  const mode = v.settings.defuserMode;
  const seated = v.seats.some((p) => p.id === you);
  if (mode === 'random')
    return (
      <p className="text-sm" data-testid="defuser-line">
        🎲 The defuser is drawn at random when the bomb starts.
      </p>
    );
  if (mode === 'volunteer') {
    const mine = v.volunteers.includes(you);
    return (
      <div className="space-y-2">
        <p className="text-sm" data-testid="defuser-line">
          {v.volunteers.length === 0
            ? '🙋 Who wants the bomb? Tap “I’ll defuse”.'
            : v.defuser
              ? `💣 ${nameOf(v.defuser)} defuses next.`
              : `🙋 ${v.volunteers.length} volunteers: the host picks one.`}
        </p>
        {seated && (
          <Button
            variant={mine ? 'secondary' : 'soft'}
            onClick={() => send({ type: 'volunteer', on: !mine }, 'defuse-pick')}
            data-testid="volunteer"
          >
            {mine ? 'Not me after all' : 'I’ll defuse'}
          </Button>
        )}
        {isHost && v.volunteers.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {v.volunteers.map((id) => (
              <Button
                key={id}
                size="sm"
                variant={v.defuser === id ? 'primary' : 'secondary'}
                onClick={() => send({ type: 'set-defuser', player: id }, 'defuse-pick')}
              >
                {nameOf(id)}
              </Button>
            ))}
          </div>
        )}
        <RefusalSlot anchor="defuse-pick" />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm" data-testid="defuser-line">
        💣{' '}
        {v.defuser
          ? `${nameOf(v.defuser)} defuses next.`
          : 'The host defuses first unless they pick someone.'}
      </p>
      {isHost && (
        <div className="flex flex-wrap gap-1">
          {v.seats.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={v.defuser === p.id ? 'primary' : 'secondary'}
              onClick={() => send({ type: 'set-defuser', player: p.id }, 'defuse-pick')}
              data-testid={`pick-${p.name}`}
            >
              {p.name}
            </Button>
          ))}
        </div>
      )}
      <RefusalSlot anchor="defuse-pick" />
    </div>
  );
}

/** On phones the tip is one line until opened, so the lobby fits the screen. */
const wide = () => typeof window !== 'undefined' && !window.matchMedia(PHONE).matches;

function TalkIntro({ onDone }: { onDone: () => void }) {
  const [more, setMore] = useState(wide);
  return (
    <Panel className="space-y-2 py-2" data-testid="talk-intro">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm leading-tight font-semibold">
          <span aria-hidden>🗣️ </span>How to talk a bomb down
        </h3>
        {!more && (
          <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setMore(true)}>
            Read
          </Button>
        )}
        <Button size="sm" className="shrink-0" onClick={onDone}>
          Got it
        </Button>
      </div>
      {more && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            The defuser sees the bomb and nothing else. Experts see the manual and nothing of the
            bomb.
          </li>
          <li>Never look at each other’s screens. Everything goes through talking.</li>
          <li>
            Defuser: start with the edges (serial number, batteries, indicators, ports), then name a
            module and describe it.
          </li>
          <li>
            Experts: claim pages so you don’t all read the same one, and ask short yes-or-no
            questions.
          </li>
        </ul>
      )}
    </Panel>
  );
}

function Lobby({
  v,
  desk,
  you,
  isHost,
  nameOf,
  send,
  showGuide,
  art,
  viewChoice,
  sound,
}: {
  v: DefuseView;
  you: string;
  isHost: boolean;
  nameOf: (id: string | null) => string;
  send: (a: Action, anchor?: string) => void;
  showGuide: (t?: unknown) => void;
  art: Art;
  viewChoice: React.ReactNode;
  /** Everyone's own Sound section. */
  sound: React.ReactNode;
  /** The next defuser goes to the desk and its briefcase. */
  desk: (() => void) | null;
}) {
  const [intro, setIntro] = useState(() => !seen(INTRO_KEY));
  const s = v.settings;
  const enough = v.seats.length >= MIN_PLAYERS;
  const ready = s.defuserMode !== 'volunteer' || !!v.defuser;
  return (
    <div className="mx-auto max-w-2xl space-y-3" data-testid="lobby">
      {intro && (
        <TalkIntro
          onDone={() => {
            remember(INTRO_KEY);
            setIntro(false);
          }}
        />
      )}
      <Panel className="space-y-2">
        <h3 className="font-semibold">At the table ({v.seats.length})</h3>
        <ul className="flex flex-wrap gap-2">
          {v.seats.map((p) => (
            <li key={p.id} className="rounded-full bg-panel px-3 py-1 text-sm dark:bg-stone-800">
              <PlayerTag name={p.name} you={p.id === you} />
            </li>
          ))}
        </ul>
        {v.watchers.length > 0 && (
          <p className="text-xs text-ink-muted">
            Watching: {v.watchers.map((p) => p.name).join(', ')}
          </p>
        )}
        <DefuserPicker v={v} you={you} isHost={isHost} nameOf={nameOf} send={send} />
        {viewChoice}
      </Panel>
      <SettingsPanel v={v} isHost={isHost} send={send} art={art} />
      {sound}
      <StickyBar>
        <div className="flex flex-wrap items-center gap-2">
          {desk && (
            <Button size="lg" variant="soft" onClick={desk} data-testid="to-desk">
              🧳 To the desk
            </Button>
          )}
          {isHost ? (
            <Button
              size="lg"
              className="flex-1"
              disabled={!enough || !ready}
              onClick={() => send({ type: 'start' }, 'defuse-start')}
              data-testid="start"
            >
              {enough
                ? ready
                  ? 'Start the bomb'
                  : 'Waiting for a defuser'
                : 'Waiting for an expert'}
            </Button>
          ) : (
            <p className="flex-1 text-center text-sm text-ink-muted" data-testid="waiting">
              Waiting for the host to start the bomb.
            </p>
          )}
          <Button variant="ghost" onClick={() => showGuide()}>
            How to play
          </Button>
        </div>
        <RefusalSlot anchor="defuse-start" />
      </StickyBar>
    </div>
  );
}

// ---- Results ----

function Result({
  v,
  b,
  art,
  you,
  isHost,
  nameOf,
  superlatives,
  send,
}: {
  v: DefuseView;
  b: BombView;
  art: Art;
  you: string;
  isHost: boolean;
  nameOf: (id: string | null) => string;
  superlatives?: DefuseUiProps['room']['superlatives'];
  send: (a: Action, anchor?: string) => void;
}) {
  const end = b.end!;
  const defused = end.how === 'defused';
  const last = v.history.at(-1);
  const stamp = art.stamp(defused ? 'defused' : 'exploded');
  const struck = b.log.filter((e) => e.what === 'strike');
  const [peek, setPeek] = useState<string | null>(null);
  const shown = b.modules.find((m) => m.id === peek);
  // Tonight: the awards and the night's bombs, once there is something to show.
  const tonight = v.history.length > 1 || !!superlatives?.length;
  const [tab, setTab] = useState<'bomb' | 'next' | 'tonight'>('bomb');
  // Phones see one part at a time; wide screens all of them.
  const part = (t: typeof tab) => cn(tab !== t && 'hidden', 'lg:block');
  return (
    <div className="mx-auto max-w-3xl space-y-3" data-testid="result">
      <Panel
        className={cn('space-y-1 py-3 text-center', defused ? 'bg-success-soft' : 'bg-danger-soft')}
      >
        {stamp && <ProtectedImage src={stamp} alt="" className="mx-auto h-16 w-auto sm:h-24" />}
        <p
          className={cn(
            'text-3xl font-black uppercase tracking-widest',
            stamp && 'sr-only',
            defused ? 'text-success-ink' : 'text-danger-ink',
          )}
          data-testid="outcome"
        >
          {defused ? 'Defused' : 'Exploded'}
        </p>
        <p className="text-sm" data-testid="outcome-line">
          {defused
            ? `${nameOf(last?.defuser ?? null)} defused bomb ${b.no} with ${timerText(end.left)} left.`
            : end.how === 'time'
              ? `Time ran out on ${nameOf(last?.defuser ?? null)}.`
              : `Too many strikes: the bomb went off in ${nameOf(last?.defuser ?? null)}’s hands.`}
        </p>
        <p className="text-xs text-ink-muted">
          {last?.solved ?? 0} of {last?.modules ?? 0} modules · {last?.strikes ?? 0} strike
          {last?.strikes === 1 ? '' : 's'} · {clockText(b.total - end.left)} used
        </p>
      </Panel>
      <div
        role="tablist"
        aria-label="Result"
        className={cn('grid gap-1 lg:hidden', tonight ? 'grid-cols-3' : 'grid-cols-2')}
      >
        {(
          [
            ['bomb', 'The bomb'],
            ['next', 'Next bomb'],
            ...(tonight ? [['tonight', 'Tonight']] : []),
          ] as [typeof tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'min-h-11 rounded-lg px-2 text-sm font-semibold ring-1',
              tab === t
                ? 'bg-accent text-accent-fg ring-accent dark:bg-amber-500 dark:text-stone-950'
                : 'bg-card ring-line dark:bg-stone-800 dark:ring-stone-700',
            )}
            data-testid={`result-tab-${t}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={cn('space-y-3', part('bomb'))}>
        <Panel className="space-y-2">
          <h3 className="font-semibold">The bomb</h3>
          <ul className="grid grid-cols-2 gap-1 text-sm">
            {b.modules.map((m) => {
              const strikes = struck.filter((e) => e.module === m.id).length;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex min-h-9 w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left leading-tight hover:bg-panel dark:hover:bg-stone-800"
                    onClick={() => setPeek(m.id)}
                  >
                    <span aria-hidden>{isNeedy(m.kind) ? '⚠️' : m.solved ? '✅' : '⬜'}</span>
                    <span className="min-w-0 flex-1">{art.names[m.kind]}</span>
                    {strikes > 0 && <span className="text-danger-ink">{'✕'.repeat(strikes)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {end.by && (
            <p className="text-xs text-ink-muted">
              The last strike came from{' '}
              {art.names[b.modules.find((m) => m.id === end.by)?.kind ?? 'wires']}.
            </p>
          )}
        </Panel>
      </div>
      <div className={cn('space-y-3', part('next'))}>
        <Panel>
          <DefuserPicker v={v} you={you} isHost={isHost} nameOf={nameOf} send={send} />
        </Panel>
        <SettingsPanel v={v} isHost={isHost} send={send} art={art} />
      </div>
      <div className={cn('space-y-3', part('tonight'))}>
        {superlatives?.length ? <Superlatives lines={superlatives} /> : null}
        {v.history.length > 1 && (
          <Panel>
            <h3 className="mb-1 font-semibold">Tonight’s bombs</h3>
            <ul className="space-y-0.5 text-sm" data-testid="tonight">
              {[...v.history].reverse().map((h) => (
                <li key={h.no}>
                  Bomb {h.no}: {nameOf(h.defuser)} ·{' '}
                  {h.how === 'defused'
                    ? `defused, ${timerText(h.left)} left`
                    : h.how === 'time'
                      ? 'time ran out'
                      : 'too many strikes'}{' '}
                  · {h.solved}/{h.modules}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      <StickyBar>
        {isHost ? (
          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              onClick={() => send({ type: 'next' }, 'defuse-next')}
              data-testid="next-bomb"
            >
              Next bomb
            </Button>
            <Button variant="secondary" onClick={() => send({ type: 'lobby' })}>
              Lobby
            </Button>
          </div>
        ) : (
          <p className="text-center text-sm text-ink-muted">
            Waiting for the host to start the next bomb.
          </p>
        )}
        <RefusalSlot anchor="defuse-next" />
      </StickyBar>
      <Modal
        open={!!shown}
        onClose={() => setPeek(null)}
        title={shown ? art.names[shown.kind] : ''}
      >
        {shown && (
          <div className="mx-auto max-w-80">
            <ModuleFace m={shown} b={b} art={art} now={end.at} send={null} />
          </div>
        )}
      </Modal>
    </div>
  );
}

export type { PageId };
export { ExpertClock };
