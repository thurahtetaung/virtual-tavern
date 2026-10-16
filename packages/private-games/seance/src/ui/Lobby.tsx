import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Hint, Panel, PlayerTag, RefusalSlot, StickyBar, cn, LobbySettings } from '@vt/ui';
import type { ReactNode } from 'react';
import { CARD_SETS, SET_IDS, type SetId } from '../logic/cards.ts';
import { RAVENS, startProblem, tableCards } from '../logic/setup.ts';
import {
  COLORS,
  DIFFICULTIES,
  type Difficulty,
  type GhostMode,
  MAX_PLAYERS,
  type SeanceAction,
  type SeanceView,
  TIMER_OPTIONS,
} from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Avatar } from './Card.tsx';
import type { Status } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

const GHOST_MODES: { id: GhostMode; label: string; hint: string }[] = [
  { id: 'random', label: 'Random', hint: 'Anyone at the table, at random.' },
  { id: 'host', label: 'Host picks', hint: 'The host chooses the ghost.' },
  { id: 'volunteers', label: 'Random volunteer', hint: 'At random among those who volunteered.' },
];

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

function Choice({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'min-h-10 rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 transition-colors disabled:cursor-not-allowed',
        on
          ? 'bg-accent dark:bg-amber-500 text-accent-fg dark:text-stone-950 ring-accent dark:ring-amber-600'
          : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50 disabled:opacity-60 dark:bg-stone-800 dark:text-stone-200 dark:ring-stone-600 dark:hover:bg-stone-700',
      )}
    >
      {children}
    </button>
  );
}

const ravenText = (d: Difficulty) =>
  RAVENS[d].perHour
    ? '1 raven every hour'
    : `${RAVENS[d].count} raven${RAVENS[d].count === 1 ? '' : 's'} a game`;

export function Lobby({
  view,
  room,
  act,
  status,
  content,
  showGuide,
}: {
  view: SeanceView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  content: Content;
  showGuide: () => void;
}) {
  const s = view.settings;
  const host = room.isHost;
  const seated = view.seats.filter((x) => x.playing);
  const me = view.me;
  const problem = startProblem(s, view.seats);
  const set = (change: Omit<Extract<SeanceAction, { type: 'update-settings' }>, 'type'>) =>
    void act({ type: 'update-settings', ...change }, { anchor: 'seance-settings' });
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected !== false;
  const takenBy = (c: string) => seated.find((x) => x.color === c && x.id !== me?.id);
  const n = Math.max(3, Math.min(seated.length, MAX_PLAYERS));
  const toggleSet = (id: SetId) => {
    const next = s.sets.includes(id) ? s.sets.filter((x) => x !== id) : [...s.sets, id];
    if (next.length) set({ sets: next });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Panel className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold">
            At the table{' '}
            <span className="text-sm font-normal text-ink-muted">
              ({seated.length}/{MAX_PLAYERS})
            </span>
          </h3>
          <Button variant="ghost" size="sm" onClick={showGuide}>
            📖 How to play
          </Button>
        </div>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {seated.length >= 3
            ? `${seated.length} players: one ghost and ${seated.length - 1} psychics.`
            : 'Séance needs 3 to 7 players: one ghost and 2 to 6 psychics.'}
        </p>
        <ul className="flex flex-wrap gap-2">
          {view.seats.map((p) => (
            <li
              key={p.id}
              className={cn(
                'flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-sm ring-1',
                p.playing
                  ? 'bg-white ring-stone-300 dark:bg-stone-800 dark:ring-stone-600'
                  : 'pl-3 opacity-60 ring-stone-300',
              )}
            >
              {p.playing && p.color && (
                <Avatar color={p.color} content={content} name={p.name} size="sm" />
              )}
              <PlayerTag
                name={p.name}
                dot={!(p.playing && p.color)}
                host={p.id === room.hostId}
                you={p.id === me?.id}
                offline={!online(p.id)}
              />
              {p.volunteer && (
                <span title="Volunteered to be the ghost" aria-label="volunteer">
                  👻
                </span>
              )}
              {s.ghostMode === 'host' && s.ghostPick === p.id && (
                <span className="rounded bg-special/20 dark:bg-violet-500/20 px-1 text-xs font-bold">
                  ghost
                </span>
              )}
              {!p.playing && <span className="text-xs">watching</span>}
            </li>
          ))}
        </ul>
        {me && (
          <div className="flex flex-wrap gap-2">
            <Button
              id="seance-sit"
              variant="secondary"
              size="sm"
              className="min-h-10"
              onClick={() => void act({ type: 'sit', playing: !me.playing })}
            >
              {me.playing ? 'Stand up (watch)' : 'Take a seat'}
            </Button>
            {me.playing && (
              <Button
                variant={me.volunteer ? 'primary' : 'secondary'}
                size="sm"
                className="min-h-10"
                aria-pressed={me.volunteer}
                onClick={() => void act({ type: 'volunteer', on: !me.volunteer })}
              >
                👻 {me.volunteer ? 'You volunteered' : 'I’ll be the ghost'}
              </Button>
            )}
          </div>
        )}
        {me?.playing && (
          <section className="space-y-1" aria-label="Your psychic">
            <h4 className="text-sm font-semibold">Your psychic (if you aren’t the ghost)</h4>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => {
                const taken = takenBy(c);
                const mine = me.color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={mine}
                    disabled={!!taken}
                    title={taken ? `${taken.name} picked this one` : content.psychicName(c)}
                    aria-label={`${content.psychicName(c)}${taken ? ` (taken by ${taken.name})` : ''}`}
                    onClick={() =>
                      void act({ type: 'pick-color', color: c }, { anchor: 'seance-color' })
                    }
                    className={cn(
                      'rounded-full p-0.5 transition disabled:opacity-35',
                      mine
                        ? 'ring-4 ring-accent dark:ring-amber-500'
                        : 'ring-1 ring-transparent hover:ring-stone-400',
                    )}
                  >
                    <Avatar color={c} content={content} size="lg" />
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-ink-muted">
              {me.color
                ? `You’ll play ${content.psychicName(me.color)}.`
                : 'Pick one, or you get a free one at the start.'}
            </p>
            <RefusalSlot anchor="seance-color" />
          </section>
        )}
      </Panel>

      <LobbySettings
        editable={host}
        summary={[
          DIFFICULTY_LABEL[s.difficulty],
          `ghost: ${GHOST_MODES.find((m) => m.id === s.ghostMode)!.label.toLowerCase()}`,
          s.timerSeconds === null
            ? 'no timer'
            : `${s.timerSeconds % 60 === 0 ? `${s.timerSeconds / 60} min` : `${s.timerSeconds} s`}${s.timerMode === 'strict' ? ', locks' : ''}`,
        ]}
        className="space-y-3"
      >
        {host && <h3 className="font-bold">Settings</h3>}
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">Who is the ghost?</h4>
          <div className="flex flex-wrap gap-2">
            {GHOST_MODES.map((m) => (
              <Choice
                key={m.id}
                on={s.ghostMode === m.id}
                disabled={!host}
                onClick={() => set({ ghostMode: m.id })}
              >
                {m.label}
              </Choice>
            ))}
          </div>
          <p className="text-xs text-ink-muted">
            {GHOST_MODES.find((m) => m.id === s.ghostMode)!.hint} The ghost is easiest on a tablet
            or a computer.
          </p>
          {s.ghostMode === 'host' && host && (
            <div className="flex flex-wrap gap-2" aria-label="Pick the ghost">
              {seated.map((p) => (
                <Choice
                  key={p.id}
                  on={s.ghostPick === p.id}
                  onClick={() => set({ ghostPick: p.id })}
                >
                  {p.name}
                </Choice>
              ))}
            </div>
          )}
        </section>
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">Difficulty</h4>
          <div className="flex flex-wrap gap-2">
            {DIFFICULTIES.map((d) => (
              <Choice
                key={d}
                on={s.difficulty === d}
                disabled={!host}
                onClick={() => set({ difficulty: d })}
              >
                {DIFFICULTY_LABEL[d]}
              </Choice>
            ))}
          </div>
          <p className="text-xs text-ink-muted">
            {DIFFICULTY_LABEL[s.difficulty]}: {tableCards(s.difficulty, n)} suspects, places and
            objects on the table with {n} players, and {ravenText(s.difficulty)}.
          </p>
        </section>
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">Card sets</h4>
          <div className="flex flex-wrap gap-2">
            {SET_IDS.map((id) => (
              <Choice
                key={id}
                on={s.sets.includes(id)}
                disabled={!host}
                onClick={() => toggleSet(id)}
              >
                {s.sets.includes(id) ? '✓ ' : ''}
                {content.setName(id)}{' '}
                <span className="font-normal opacity-70">({CARD_SETS[id].vision.length})</span>
              </Choice>
            ))}
          </div>
          <p className="text-xs text-ink-muted">
            Each set adds its visions and its suspects, places and objects.{' '}
            {SET_IDS.filter((id) => s.sets.includes(id)).reduce(
              (t, id) => t + CARD_SETS[id].vision.length,
              0,
            )}{' '}
            visions in play.
          </p>
        </section>
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">Timer once every vision is out</h4>
          <div className="flex flex-wrap gap-2">
            {TIMER_OPTIONS.map((t) => (
              <Choice
                key={t}
                on={s.timerSeconds === t}
                disabled={!host}
                onClick={() => set({ timerSeconds: t })}
              >
                {t / 60} min
              </Choice>
            ))}
            <Choice
              on={s.timerSeconds === null}
              disabled={!host}
              onClick={() => set({ timerSeconds: null })}
            >
              Off
            </Choice>
          </div>
          {s.timerSeconds !== null && (
            <div className="flex flex-wrap gap-2">
              <Choice
                on={s.timerMode === 'soft'}
                disabled={!host}
                onClick={() => set({ timerMode: 'soft' })}
              >
                Reminder
              </Choice>
              <Choice
                on={s.timerMode === 'strict'}
                disabled={!host}
                onClick={() => set({ timerMode: 'strict' })}
              >
                Lock at 0:00
              </Choice>
            </div>
          )}
          <p className="text-xs text-ink-muted">
            {s.timerSeconds === null
              ? 'No timer: the hour ends when everyone taps Ready (or the host locks it).'
              : s.timerMode === 'soft'
                ? 'Reminder: at 0:00 nothing happens by itself; the host can lock the guesses in. The hour ends early once everyone is Ready.'
                : 'Lock at 0:00: guesses lock by themselves (no guess counts as wrong). The hour ends early once everyone is Ready.'}
          </p>
        </section>
        <RefusalSlot anchor="seance-settings" />
      </LobbySettings>

      {host && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={problem !== null}
            onClick={() => void act({ type: 'start' }, { anchor: 'seance-start' })}
          >
            Begin the séance
          </Button>
          {problem && <p className="mt-1 text-center text-xs text-ink-muted">{problem}</p>}
          <RefusalSlot anchor="seance-start" />
        </StickyBar>
      )}
    </div>
  );
}
