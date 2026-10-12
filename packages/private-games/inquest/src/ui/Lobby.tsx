import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Hint, Panel, PlayerTag, RefusalSlot, StickyBar, cn } from '@vt/ui';
import type { ReactNode } from 'react';
import { rolesFor, startProblem } from '../logic/setup.ts';
import {
  DISCUSS_SECONDS_OPTIONS,
  type FsMode,
  HAND_SIZES,
  discussSecondsOf,
  type InquestAction,
  type InquestView,
  MAX_PLAYERS,
  PRESENT_SECONDS_OPTIONS,
  type RoleId,
} from '../logic/types.ts';
import type { Content } from './assets.ts';
import type { Status } from './status.ts';

type Act = (a: InquestAction, o?: { anchor?: string }) => Promise<boolean>;

const FS_MODES: { id: FsMode; label: string; hint: string }[] = [
  { id: 'random', label: 'Random', hint: 'Anyone at the table, at random.' },
  { id: 'host', label: 'Host picks', hint: 'The host chooses a player.' },
  { id: 'volunteers', label: 'Random volunteer', hint: 'At random among those who volunteered.' },
  {
    id: 'host-volunteers',
    label: 'Host picks a volunteer',
    hint: 'The host chooses among the volunteers.',
  },
];

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
          ? 'bg-amber-500 text-stone-950 ring-amber-600'
          : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50 disabled:opacity-60 dark:bg-stone-800 dark:text-stone-200 dark:ring-stone-600 dark:hover:bg-stone-700',
      )}
    >
      {children}
    </button>
  );
}

/** "6 players: Forensic Scientist, Murderer, Accomplice, Witness and 2 Investigators." */
export function rolesSummary(count: number, view: InquestView, content: Content): string {
  if (count < 4) return '';
  const roles = rolesFor(count, view.settings);
  const inv = roles.filter((r) => r === 'investigator').length;
  const named = (['forensic', 'murderer', 'accomplice', 'witness'] as RoleId[])
    .filter((r) => roles.includes(r))
    .map((r) => content.roleName(r));
  const invText = inv
    ? ` and ${inv} ${content.roleName('investigator')}${inv === 1 ? '' : 's'}`
    : '';
  return `${count} players: ${named.join(', ')}${invText}.`;
}

export function Lobby({
  view,
  room,
  act,
  status,
  content,
  showGuide,
}: {
  view: InquestView;
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
  const set = (change: Omit<Extract<InquestAction, { type: 'update-settings' }>, 'type'>) =>
    void act({ type: 'update-settings', ...change }, { anchor: 'inquest-settings' });
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected !== false;
  const pickable = s.fsMode === 'host-volunteers' ? seated.filter((x) => x.volunteer) : seated;
  const extras = seated.length >= 6;

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Panel className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold">
            At the table{' '}
            <span className="text-sm font-normal text-stone-500">
              ({seated.length}/{MAX_PLAYERS})
            </span>
          </h3>
          <Button variant="ghost" size="sm" onClick={showGuide}>
            📖 How to play
          </Button>
        </div>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {rolesSummary(seated.length, view, content) || 'Inquest needs 4 to 12 players.'}
        </p>
        <ul className="flex flex-wrap gap-2">
          {view.seats.map((p) => (
            <li
              key={p.id}
              className={cn(
                'flex items-center gap-1 rounded-full px-3 py-1 text-sm ring-1',
                p.playing
                  ? 'bg-white ring-stone-300 dark:bg-stone-800 dark:ring-stone-600'
                  : 'opacity-60 ring-dashed ring-stone-300',
              )}
            >
              <PlayerTag
                name={p.name}
                host={p.id === room.hostId}
                you={p.id === me?.id}
                offline={!online(p.id)}
              />
              {p.volunteer && (
                <span title="Volunteered to be the Forensic Scientist" aria-label="volunteer">
                  🔬
                </span>
              )}
              {s.fsPick === p.id && (s.fsMode === 'host' || s.fsMode === 'host-volunteers') && (
                <span className="rounded bg-amber-500/20 px-1 text-xs font-bold">FS</span>
              )}
              {!p.playing && <span className="text-xs">watching</span>}
            </li>
          ))}
        </ul>
        {me && (
          <div className="flex flex-wrap gap-2">
            <Button
              id="inquest-sit"
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
                🔬 {me.volunteer ? 'You volunteered' : 'I’ll be the Forensic Scientist'}
              </Button>
            )}
          </div>
        )}
      </Panel>

      <Panel className="space-y-3" aria-label="Settings">
        <h3 className="font-bold">
          Settings{' '}
          {!host && <span className="text-sm font-normal text-stone-500">(the host chooses)</span>}
        </h3>
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">Who is the Forensic Scientist?</h4>
          <div className="flex flex-wrap gap-2">
            {FS_MODES.map((m) => (
              <Choice
                key={m.id}
                on={s.fsMode === m.id}
                disabled={!host}
                onClick={() => set({ fsMode: m.id })}
              >
                {m.label}
              </Choice>
            ))}
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {FS_MODES.find((m) => m.id === s.fsMode)!.hint}{' '}
            {seated.some((x) => x.volunteer)
              ? `Volunteers: ${seated
                  .filter((x) => x.volunteer)
                  .map((x) => x.name)
                  .join(', ')}.`
              : 'Nobody has volunteered yet.'}
          </p>
          {(s.fsMode === 'host' || s.fsMode === 'host-volunteers') && host && (
            <div className="flex flex-wrap gap-2" aria-label="Pick the Forensic Scientist">
              {pickable.map((p) => (
                <Choice key={p.id} on={s.fsPick === p.id} onClick={() => set({ fsPick: p.id })}>
                  {p.name}
                </Choice>
              ))}
              {!pickable.length && (
                <span className="text-sm text-stone-500">Nobody to pick yet.</span>
              )}
            </div>
          )}
        </section>
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">
            Extra roles <span className="font-normal text-stone-500">(6+ players)</span>
          </h4>
          <div className="flex flex-wrap gap-2">
            <Choice
              on={s.accomplice}
              disabled={!host}
              onClick={() => set({ accomplice: !s.accomplice })}
            >
              {s.accomplice ? '✓ ' : ''}
              {content.roleName('accomplice')}
            </Choice>
            <Choice
              on={s.witness}
              disabled={!host || !s.accomplice}
              onClick={() => set({ witness: !s.witness })}
            >
              {s.witness ? '✓ ' : ''}
              {content.roleName('witness')}
            </Choice>
            <Choice on={s.events} disabled={!host} onClick={() => set({ events: !s.events })}>
              {s.events ? '✓ ' : ''}Event tiles
            </Choice>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {extras ? '' : 'With fewer than 6 players there is no Accomplice or Witness. '}
            The Witness needs the Accomplice. Events are shuffled in after round 1.
          </p>
        </section>
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">Cards each (difficulty)</h4>
          <div className="flex flex-wrap gap-2">
            {HAND_SIZES.map((n) => (
              <Choice key={n} on={s.hand === n} disabled={!host} onClick={() => set({ hand: n })}>
                {n} + {n}
                {n === 3 ? ' (easier)' : n === 5 ? ' (harder)' : ''}
              </Choice>
            ))}
          </div>
        </section>
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">Discussion time before presentations</h4>
          <div className="flex flex-wrap gap-2" aria-label="Discussion time before presentations">
            {DISCUSS_SECONDS_OPTIONS.map((n) => (
              <Choice
                key={n}
                on={discussSecondsOf(s) === n}
                disabled={!host}
                onClick={() => set({ discussSeconds: n })}
              >
                {n ? `${n / 60} min` : 'Off'}
              </Choice>
            ))}
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Every round, after the last bullet. A reminder: the Forensic Scientist starts the
            presentations whenever the table is ready{discussSecondsOf(s) ? '' : ' (no clock)'}.
          </p>
        </section>
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">Presentation time</h4>
          <div className="flex flex-wrap gap-2">
            {PRESENT_SECONDS_OPTIONS.map((n) => (
              <Choice
                key={n}
                on={s.presentSeconds === n}
                disabled={!host}
                onClick={() => set({ presentSeconds: n })}
              >
                {n} s
              </Choice>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Choice
              on={s.presentMode === 'soft'}
              disabled={!host}
              onClick={() => set({ presentMode: 'soft' })}
            >
              Reminder
            </Choice>
            <Choice
              on={s.presentMode === 'hard'}
              disabled={!host}
              onClick={() => set({ presentMode: 'hard' })}
            >
              Strict
            </Choice>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {s.presentMode === 'soft'
              ? 'Reminder: the clock turns red at 0:00; the speaker taps Done or the host skips.'
              : 'Strict: the turn passes by itself at 0:00.'}
          </p>
        </section>
        <RefusalSlot anchor="inquest-settings" />
      </Panel>

      {host && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={problem !== null}
            onClick={() => void act({ type: 'start' }, { anchor: 'inquest-start' })}
          >
            Start the investigation
          </Button>
          {problem && <p className="mt-1 text-center text-xs text-stone-500">{problem}</p>}
          <RefusalSlot anchor="inquest-start" />
        </StickyBar>
      )}
    </div>
  );
}
