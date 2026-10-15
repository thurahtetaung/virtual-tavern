import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Hint, Panel, PlayerTag, StickyBar, cn, LobbySettings } from '@vt/ui';
import {
  MAX_ROUNDS,
  MAX_SEATS,
  type MasqueradeAction,
  type MasqueradeView,
  ROUND_SECONDS_OPTIONS,
  TWO_SPIES_MIN,
} from '../logic/types.ts';
import type { LocationDisplay } from './display.ts';
import type { Status } from './status.ts';
import { startBlocker } from './status.ts';

type Act = (a: MasqueradeAction) => Promise<boolean>;

const choice = (on: boolean, editable: boolean) =>
  cn(
    'rounded-lg px-3 py-2 text-left ring-1 transition disabled:cursor-default',
    on
      ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
      : 'ring-stone-200 enabled:hover:bg-stone-100 dark:ring-stone-700 dark:enabled:hover:bg-stone-800',
    !editable && !on && 'opacity-60',
  );

export function Players({
  view,
  online,
  hostId,
}: {
  view: MasqueradeView;
  online: (id: string) => boolean;
  hostId: string;
}) {
  const playing = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  return (
    <section aria-label="Players" className="space-y-2">
      <h3 className="font-bold">
        Players ({playing.length}/{MAX_SEATS})
      </h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {playing.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden>🎭</span>
            <PlayerTag
              name={s.name}
              host={s.id === hostId}
              you={s.id === view.me?.id}
              offline={!online(s.id)}
            />
          </li>
        ))}
      </ul>
      {watching.length > 0 && (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Watching:{' '}
          {watching.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <PlayerTag
                name={s.name}
                host={s.id === hostId}
                you={s.id === view.me?.id}
                offline={!online(s.id)}
              />
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

/** A short list of round counts for the phone-sized dropdown, plus the current pick. */
const ROUND_PRESETS = [1, 3, 5, 8, 10, 15, 20];
function roundPresets(current: number | null): number[] {
  const list = ROUND_PRESETS.filter((n) => n <= MAX_ROUNDS);
  if (current !== null && !list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

export function Lobby({
  view,
  room,
  act,
  status,
  online,
  showGuide,
  display,
}: {
  view: MasqueradeView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  online: (id: string) => boolean;
  showGuide: () => void;
  display: LocationDisplay;
}) {
  const editable = room.isHost;
  const s = view.settings;
  const blocker = startBlocker(view);
  const seated = view.seats.filter((x) => x.playing).length;
  const toggleEdition = (id: string) => {
    const next = s.editions.includes(id) ? s.editions.filter((e) => e !== id) : [...s.editions, id];
    if (next.length > 0) void act({ type: 'update-settings', editions: next });
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Panel>
        <Players view={view} online={online} hostId={room.hostId} />
      </Panel>
      <LobbySettings
        editable={editable}
        title="Game settings"
        summary={[
          `${s.roundSeconds / 60} min rounds`,
          s.rounds === null ? 'a round each' : `${s.rounds} ${s.rounds === 1 ? 'round' : 'rounds'}`,
          `${view.locations.length} locations`,
          s.twoSpies && 'two spies',
        ]
          .filter(Boolean)
          .join(' · ')}
        className="space-y-4"
      >
        {editable && <h3 className="text-lg font-bold">Game settings</h3>}
        <fieldset>
          <legend className="text-sm font-semibold">
            {view.editions.length > 1 ? 'Editions' : 'Locations'}
          </legend>
          <div
            className={cn(
              'mt-1 grid gap-2',
              view.editions.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
            )}
          >
            {view.editions.map((e) => {
              const on = s.editions.includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!editable || view.editions.length === 1}
                  onClick={() => toggleEdition(e.id)}
                  className={choice(on, editable)}
                >
                  <span className="block font-semibold">{display.editionLabel(e.id, e.label)}</span>
                  <span className="block text-xs text-stone-600 dark:text-stone-400">
                    {e.count} locations
                  </span>
                </button>
              );
            })}
          </div>
          {view.editions.length > 1 && (
            <p className="mt-1 text-xs text-ink-muted">
              Pick one edition or both: {view.locations.length} locations in play.
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend className="text-sm font-semibold">Round length</legend>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {ROUND_SECONDS_OPTIONS.map((sec) => (
              <button
                key={sec}
                type="button"
                aria-pressed={s.roundSeconds === sec}
                disabled={!editable}
                onClick={() => void act({ type: 'update-settings', roundSeconds: sec })}
                className={cn(
                  choice(s.roundSeconds === sec, editable),
                  'h-11 text-center font-semibold',
                )}
              >
                {sec / 60} min
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-semibold">Rounds</span>
            <select
              className="mt-1 block h-11 w-full rounded-lg bg-white px-2 ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700"
              value={s.rounds === null ? 'auto' : String(s.rounds)}
              disabled={!editable}
              onChange={(e) =>
                void act({
                  type: 'update-settings',
                  rounds: e.target.value === 'auto' ? null : Number(e.target.value),
                })
              }
            >
              <option value="auto">As many as players ({Math.max(seated, 1)})</option>
              {roundPresets(s.rounds).map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'round' : 'rounds'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-5 accent-amber-600"
              checked={s.twoSpies}
              disabled={!editable}
              onChange={(e) => void act({ type: 'update-settings', twoSpies: e.target.checked })}
            />
            <span>
              <span className="block font-semibold">Two spies</span>
              <span className="block text-xs text-ink-muted">
                From {TWO_SPIES_MIN} players. The spies don’t know each other.
                {s.twoSpies && seated < TWO_SPIES_MIN && ` (One spy until ${TWO_SPIES_MIN} play.)`}
              </span>
            </span>
          </label>
        </div>
        {editable && (
          <StickyBar>
            <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
              <Button
                size="lg"
                disabled={blocker !== null}
                onClick={() => void act({ type: 'start' })}
              >
                Start game
              </Button>
              {blocker && <span className="text-sm text-ink-muted">{blocker}</span>}
            </div>
          </StickyBar>
        )}
      </LobbySettings>
      <p className="text-center text-sm text-ink-muted">
        New to Masquerade?{' '}
        <button
          type="button"
          className="font-semibold text-amber-700 underline dark:text-amber-400"
          onClick={showGuide}
        >
          Read the guide
        </button>
      </p>
    </div>
  );
}
