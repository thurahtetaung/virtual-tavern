import { type GameUiProps, storageKey } from '@vt/game-sdk';
import {
  Button,
  Hint,
  LobbySettings,
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
import { useEffect, useMemo, useState } from 'react';
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
import { BombScreen } from './Bomb.tsx';
import { ClaimsSummary, Manual } from './Manual.tsx';
import { ModuleFace } from './Modules.tsx';
import { player, useBombSound, useMute } from './sound.ts';
import { clockText, serverNow, useServerNow } from './time.ts';

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
  profile,
}: DefuseUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = useMemo(() => new Map(room.players.map((p) => [p.id, p.name])), [room.players]);
  const you = room.you;
  const nameOf = (id: string | null) =>
    id ? (names.get(id) ?? v.seats.find((p) => p.id === id)?.name ?? 'Someone') : 'Nobody';
  const [muted, setMuted] = useMute();
  const quiet = profile === 'phone-quiet' && v.role !== 'defuser';
  useBombSound(v.role === 'defuser' && !quiet ? v.bomb : null, art, room.clockOffset);
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
  const mute = (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-label={muted ? 'Sound off' : 'Sound on'}
      className="rounded-full px-2 text-lg"
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );

  if (v.stage === 'bomb' && v.role === 'defuser' && v.bomb)
    return (
      <Defuser
        b={v.bomb}
        art={art}
        offset={room.clockOffset}
        mute={mute}
        act={(module, op) => send({ type: 'act', module, ...op, at: serverNow(room.clockOffset) })}
        showGuide={showGuide}
      />
    );
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
  return (
    <Lobby
      v={v}
      you={you}
      isHost={room.isHost}
      nameOf={nameOf}
      send={send}
      showGuide={showGuide}
      art={art}
    />
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
}: {
  b: BombView;
  art: Art;
  offset: number;
  act: (module: string, op: ModuleOp) => void;
  mute: React.ReactNode;
  showGuide: (t?: unknown) => void;
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
      <Panel className="flex flex-wrap items-center gap-2 py-2">
        <span className="min-w-0 flex-1 text-sm font-semibold" data-testid="status">
          📖 {defuser} is defusing bomb {v.bombNo}: read them the manual.
        </span>
        <ExpertClock v={v} offset={offset} />
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
      {isHost && defuserHere && (
        <div className="text-right">
          <button
            type="button"
            className="text-xs text-ink-muted underline"
            onClick={() => setHand(true)}
          >
            Hand the bomb to another player
          </button>
        </div>
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
      <details>
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

function TalkIntro({ onDone }: { onDone: () => void }) {
  return (
    <Panel className="space-y-2" data-testid="talk-intro">
      <h3 className="font-semibold">How to talk a bomb down</h3>
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
      <Button size="sm" onClick={onDone}>
        Got it
      </Button>
    </Panel>
  );
}

function Lobby({
  v,
  you,
  isHost,
  nameOf,
  send,
  showGuide,
  art,
}: {
  v: DefuseView;
  you: string;
  isHost: boolean;
  nameOf: (id: string | null) => string;
  send: (a: Action, anchor?: string) => void;
  showGuide: (t?: unknown) => void;
  art: Art;
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
      </Panel>
      <LobbySettings
        editable={isHost}
        summary={[
          `${s.modules} modules`,
          clockText(s.time * 1000),
          s.needy ? 'needy' : '',
          s.hardcore ? 'Hardcore' : '',
          MODE_LABEL[s.defuserMode],
        ]}
        className="space-y-4"
      >
        <SettingsForm s={s} editable={isHost} send={send} art={art} />
      </LobbySettings>
      <StickyBar>
        <div className="flex flex-wrap items-center gap-2">
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
  return (
    <div className="mx-auto max-w-3xl space-y-3" data-testid="result">
      <Panel
        className={cn('space-y-2 text-center', defused ? 'bg-success-soft' : 'bg-danger-soft')}
      >
        {stamp ? (
          <ProtectedImage
            src={stamp}
            alt={defused ? 'Defused' : 'Exploded'}
            className="mx-auto h-24 w-auto"
          />
        ) : (
          <p
            className={cn(
              'text-3xl font-black uppercase tracking-widest',
              defused ? 'text-success-ink' : 'text-danger-ink',
            )}
            data-testid="outcome"
          >
            {defused ? 'Defused' : 'Exploded'}
          </p>
        )}
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
      {superlatives?.length ? <Superlatives lines={superlatives} /> : null}
      <Panel className="space-y-2">
        <h3 className="font-semibold">The bomb</h3>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {b.modules.map((m) => {
            const strikes = struck.filter((e) => e.module === m.id).length;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-panel dark:hover:bg-stone-800"
                  onClick={() => setPeek(m.id)}
                >
                  <span aria-hidden>{isNeedy(m.kind) ? '⚠️' : m.solved ? '✅' : '⬜'}</span>
                  <span className="flex-1">{art.names[m.kind]}</span>
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
      <Panel className="space-y-3">
        <DefuserPicker v={v} you={you} isHost={isHost} nameOf={nameOf} send={send} />
        <LobbySettings
          editable={isHost}
          summary={[`${v.settings.modules} modules`, clockText(v.settings.time * 1000)]}
          className="space-y-4"
        >
          <SettingsForm s={v.settings} editable={isHost} send={send} art={art} />
        </LobbySettings>
      </Panel>
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
      {v.history.length > 1 && (
        <Panel>
          <h3 className="mb-1 font-semibold">Tonight’s bombs</h3>
          <ul className="space-y-0.5 text-sm">
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
