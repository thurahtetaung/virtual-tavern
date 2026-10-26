import { type GameRoomInfo, type GameUiProps, storageKey, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Hint,
  LobbySettings,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  StickyBar,
  Superlatives,
  Switch,
  TimerSettings,
  cn,
  timersLine,
  useAbandonGame,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { type MultiMode, RATING_LINE, maxScore, ratingOf } from '../logic/cards.ts';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type MemoryMode,
  type SkyfireAction,
  type SkyfireView,
} from '../logic/types.ts';
import { type Art, artFor, useManifest } from './assets.ts';
import { CardFace } from './Card.tsx';
import { Replay } from './Replay.tsx';
import { type Act, TIPS_KEY, Table, tipsSeen } from './Table.tsx';
import { type NameOf, endHowText, statusFor } from './text.ts';

export type SkyfireUiProps = GameUiProps<SkyfireView, SkyfireAction>;

export function SkyfireGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: SkyfireUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = (view.game?.players ?? view.seats).map((p) => `${p.id}=${p.name}`).join('|');
  const name = useMemo<NameOf>(() => {
    const map = new Map(names.split('|').map((kv) => kv.split('=') as [string, string]));
    return (id) => (id === room.you ? 'You' : id ? (map.get(id) ?? 'Someone') : 'Someone');
  }, [names, room.you]);
  const status = statusFor(view, room.you, name);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  const inGame = !!view.game?.hands[room.you];
  const watching = !!view.me && (view.phase === 'lobby' ? !view.me.playing : !inGame);
  useSpectatorPrompt(
    setSpectator,
    watching
      ? view.phase === 'lobby'
        ? { text: 'Take a seat to play.', action: () => void act({ type: 'sit', playing: true }) }
        : { text: 'You can join from the next game.' }
      : null,
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-1.5 sm:gap-2">
      <SkyfireStyles />
      {view.phase === 'lobby' || !view.game ? (
        <Lobby view={view} room={room} act={act} art={art} showGuide={showGuide} />
      ) : (
        <>
          <Hint tone={status.yourMove ? 'action' : 'neutral'} dense>
            {status.text}
          </Hint>
          {view.phase === 'playing' && inGame && <Tips />}
          {view.phase === 'over' && <End view={view} room={room} act={act} art={art} name={name} />}
          <Table view={view} room={room} act={act} art={art} name={name} showGuide={showGuide} />
        </>
      )}
    </div>
  );
}

/** The glow on cards a clue just touched; still with reduced motion. */
function SkyfireStyles() {
  return (
    <style>{`
      @keyframes sf-glow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      .sf-lit { animation: sf-glow 1.2s ease-in-out 3; }
      @media (prefers-reduced-motion: reduce) { .sf-lit { animation: none; } }
    `}</style>
  );
}

/** First-time tips, until dismissed (per seat in a playtest). */
function Tips() {
  const [seen, setSeen] = useState(tipsSeen);
  if (seen) return null;
  return (
    <aside className="flex flex-col gap-1.5 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
      <p className="font-semibold">New here? Three things to know</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          You see everyone’s cards but your own. Yours show as backs with what clues told you.
        </li>
        <li>
          On your turn, tap a teammate’s hand to give a clue (a colour or a number: you see which
          cards it touches before sending), or tap one of your cards to play or discard it.
        </li>
        <li>
          Drag your cards to reorder them. New cards arrive on the left, so your oldest is on the
          right.
        </li>
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="self-end"
        onClick={() => {
          try {
            localStorage.setItem(storageKey(TIPS_KEY), '1');
          } catch {
            // Storage blocked: the tips just close for now.
          }
          setSeen(true);
        }}
      >
        Got it
      </Button>
    </aside>
  );
}

const MULTI_LABEL: Record<MultiMode, string> = {
  off: 'Off',
  '6th': 'Own colour',
  'one-each': 'One of each',
  wild: 'Wild',
};

const MULTI_HELP: Record<MultiMode, string> = {
  off: 'Five colours, 50 cards, top score 25.',
  '6th': 'A sixth firework of 10 multicolour cards, clued as their own colour. Top score 30.',
  'one-each': 'A sixth firework of 5 multicolour cards, one of each number. Top score 30.',
  wild: 'A sixth firework of 10 cards that every colour clue touches and no clue can name. Top score 30.',
};

const MEMORY_LABEL: Record<MemoryMode, string> = {
  marks: 'Marks',
  full: 'Full help',
  memory: 'Memory',
};

const MEMORY_HELP: Record<MemoryMode, string> = {
  marks: 'Each card shows the clues that touched it and what it is known not to be.',
  full: 'Also lists what each of your cards can still be, counting every card you can see.',
  memory: 'No marks, as at the table: you remember your clues.',
};

/** A row of choices for one setting (read-only for guests). */
function Choice<T extends string>({
  title,
  value,
  options,
  labels,
  help,
  editable,
  onChange,
  testId,
}: {
  title: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  help: Record<T, string>;
  editable: boolean;
  onChange: (v: T) => void;
  testId: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={title}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            aria-disabled={!editable || undefined}
            onClick={() => {
              if (editable) onChange(o);
            }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-semibold ring-1',
              value === o
                ? 'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/15 dark:ring-amber-500'
                : 'bg-card ring-line dark:bg-stone-900 dark:ring-stone-700',
              !editable && 'cursor-default',
            )}
            data-testid={`${testId}-${o}`}
          >
            {labels[o]}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-muted dark:text-stone-400">{help[value]}</p>
    </fieldset>
  );
}

function Lobby({
  view,
  room,
  act,
  art,
  showGuide,
}: {
  view: SkyfireView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  showGuide: () => void;
}) {
  const seated = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const st = view.settings;
  const n = seated.length;
  const set = (patch: Omit<Extract<SkyfireAction, { type: 'update-settings' }>, 'type'>) =>
    void act({ type: 'update-settings', ...patch }, { anchor: 'sf-lobby' });
  const timers = { clueSeconds: st.seconds, guessSeconds: null, timerMode: st.timerMode };
  const blocker =
    n < MIN_PLAYERS
      ? `${MIN_PLAYERS} players are needed (${n} seated).`
      : n > MAX_PLAYERS
        ? `At most ${MAX_PLAYERS} can play.`
        : null;
  const top = maxScore({ multi: st.multi, black: st.black });
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <Hint tone={room.isHost && !blocker ? 'action' : 'neutral'}>
        {!me
          ? 'Watching the table.'
          : !me.playing
            ? 'You’re watching. Take a seat to play.'
            : blocker
              ? blocker
              : room.isHost
                ? 'Everyone’s here? Start the show.'
                : waitingForHost(room)}
      </Hint>
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            Players ({n}/{MAX_PLAYERS})
          </h2>
          <Button variant="ghost" size="sm" onClick={() => showGuide()}>
            📖 Rules
          </Button>
        </div>
        {art.lobby && (
          <ProtectedImage
            src={art.lobby}
            alt=""
            className="max-h-28 w-full rounded-xl object-cover"
          />
        )}
        <ul className="flex flex-col gap-1.5" aria-label="Seats">
          {seated.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <PlayerTag
                name={s.name}
                host={s.id === room.hostId}
                you={s.id === room.you}
                offline={offline(s.id)}
                className="flex-1"
              />
              {s.id === room.you && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void act({ type: 'sit', playing: false })}
                >
                  Stand up
                </Button>
              )}
            </li>
          ))}
        </ul>
        {watching.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted dark:text-stone-400">
            <span>Watching:</span>
            {watching.map((s) => (
              <PlayerTag key={s.id} name={s.name} />
            ))}
          </p>
        )}
        {me && !me.playing && n < MAX_PLAYERS && (
          <Button variant="soft" onClick={() => void act({ type: 'sit', playing: true })}>
            Take a seat
          </Button>
        )}
        <div className="flex items-center gap-3 text-sm text-ink-muted dark:text-stone-400">
          <span className="grid w-28 shrink-0 grid-cols-3 gap-1" aria-hidden>
            <CardFace card={{ suit: 'red', rank: 1 }} art={art} size="row" />
            <CardFace card={{ suit: 'blue', rank: 2 }} art={art} size="row" />
            <CardFace card={{ suit: 'yellow', rank: 3 }} art={art} size="row" />
          </span>
          <p>
            A cooperative show for 2 to 5, best at 3 or 4: you see everyone’s cards but your own,
            and build five fireworks from 1 to 5 with careful clues.
          </p>
        </div>
      </Panel>
      <LobbySettings
        editable={room.isHost}
        summary={[
          `top score ${top}`,
          ...(st.multi !== 'off' ? [`multicolour: ${MULTI_LABEL[st.multi].toLowerCase()}`] : []),
          ...(st.black ? ['black powder'] : []),
          ...(st.expert ? ['expert ending'] : []),
          MEMORY_LABEL[st.memory].toLowerCase(),
          ...(st.zeroClues ? [] : ['no empty clues']),
          timersLine(timers, { clue: 'turns', guess: null }),
        ]}
        className="space-y-4"
      >
        <Choice
          title="Clue memory"
          value={st.memory}
          options={['marks', 'full', 'memory'] as const}
          labels={MEMORY_LABEL}
          help={MEMORY_HELP}
          editable={room.isHost}
          onChange={(memory) => set({ memory })}
          testId="sf-memory"
        />
        <Choice
          title="Multicolour"
          value={st.multi}
          options={['off', '6th', 'one-each', 'wild'] as const}
          labels={MULTI_LABEL}
          help={MULTI_HELP}
          editable={room.isHost}
          onChange={(multi) => set({ multi })}
          testId="sf-multi"
        />
        <Switch
          on={st.black}
          editable={room.isHost}
          title="Black powder"
          help="A black firework built 5 down to 1. No colour clue touches it; each black card missing costs a point."
          onChange={(black) => set({ black })}
          testId="sf-black"
        />
        <Switch
          on={st.expert}
          editable={room.isHost}
          title="Expert ending"
          help="A perfect show or nothing: no last round, and losing the last copy of a needed card loses the show."
          onChange={(expert) => set({ expert })}
          testId="sf-expert"
        />
        <Switch
          on={st.zeroClues}
          editable={room.isHost}
          title="Empty clues"
          help="A clue may touch no card (“you have no blue”). Off: every clue must touch at least one card."
          onChange={(zeroClues) => set({ zeroClues })}
          testId="sf-zero"
        />
        <TimerSettings
          values={timers}
          editable={room.isHost}
          clueLabel="Turn timer"
          clueHelp="Time for each turn."
          strictHelp="the app makes a safe move for them (a discard or a clue, never a play)"
          onChange={(patch) =>
            set({
              ...(patch.clueSeconds !== undefined && { seconds: patch.clueSeconds }),
              ...(patch.timerMode !== undefined && { timerMode: patch.timerMode }),
            })
          }
        />
        <RefusalSlot anchor="sf-lobby" />
      </LobbySettings>
      {room.isHost && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'sf-start' })}
          >
            Start the show
          </Button>
          <RefusalSlot anchor="sf-start" />
        </StickyBar>
      )}
    </div>
  );
}

function End({
  view,
  room,
  act,
  art,
  name,
}: {
  view: SkyfireView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  const r = g.result;
  if (!r) return null;
  const lost = r.how === 'fuses' || r.how === 'lost-card' || r.how === 'no-cards';
  const rating = view.settings.expert
    ? r.win
      ? 'Perfect'
      : 'Lost'
    : lost
      ? 'Lost'
      : ratingOf(r.score, r.max);
  return (
    <Panel className="flex flex-col gap-3" data-testid="sf-end">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-4xl font-black tabular-nums" data-testid="sf-final-score">
          {r.score}{' '}
          <span className="text-lg font-semibold text-ink-muted dark:text-stone-400">
            / {r.max}
          </span>
        </p>
        <p className="text-lg font-bold">
          {r.win ? '🎆 ' : ''}
          {rating}
        </p>
        <p className="text-sm text-ink-muted dark:text-stone-400">
          {lost || r.how === 'ended' || view.settings.expert
            ? endHowText(r.how)
            : (RATING_LINE[rating] ?? '')}
        </p>
        {(r.score !== r.reached || lost) && (
          <p className="text-sm" data-testid="sf-reached">
            The fireworks reached {r.reached}.
          </p>
        )}
        {r.how === 'lost-card' && r.card && (
          <p className="flex items-center gap-2 text-sm">
            Lost for good: <CardFace card={r.card} art={art} size="mini" className="w-6" />
          </p>
        )}
        {r.how === 'no-cards' && r.player && (
          <p className="text-sm">{name(r.player)} had no cards left.</p>
        )}
      </div>
      <Superlatives lines={room.superlatives} />
      <details
        className="rounded-xl bg-card p-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
        open
      >
        <summary className="cursor-pointer text-sm font-semibold">
          Replay: every turn, every hand face up
        </summary>
        <div className="mt-2">
          <Replay view={view} you={room.you} art={art} name={name} />
        </div>
      </details>
      {room.isHost ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="flex-1"
            onClick={() => void act({ type: 'play-again' }, { anchor: 'sf-end' })}
          >
            Play again
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'sf-end' })}
          >
            Change setup
          </Button>
        </div>
      ) : (
        <Hint>{waitingForHost(room, 'start the next show')}</Hint>
      )}
      <RefusalSlot anchor="sf-end" />
    </Panel>
  );
}
