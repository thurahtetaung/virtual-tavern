import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  Chip,
  Chips,
  Field,
  GuideLink,
  Hint,
  Panel,
  PlayerTag,
  Select,
  StickyBar,
  Switch,
  cn,
  LobbySettings,
} from '@vt/ui';
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
      ? 'bg-accent-soft text-accent-text ring-2 ring-accent'
      : 'bg-card ring-line-strong enabled:hover:bg-panel',
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
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small">
        {playing.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1.5">
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
        <p className="text-small text-ink-muted">
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
      {status.text && <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>}
      <Panel>
        <Players view={view} online={online} hostId={room.hostId} />
      </Panel>
      <GuideLink title={room.gameName ?? 'Masquerade'} onClick={showGuide} />
      <LobbySettings
        editable={editable}
        summary={[
          `${s.roundSeconds / 60} min rounds`,
          s.rounds === null ? 'a round each' : `${s.rounds} ${s.rounds === 1 ? 'round' : 'rounds'}`,
          `${view.locations.length} locations`,
          s.twoSpies && 'two spies',
        ]}
        className="space-y-4"
      >
        <fieldset>
          <legend className="text-small font-semibold">
            {view.editions.length > 1 ? 'Editions' : 'Locations'}
          </legend>
          <Chips
            label={view.editions.length > 1 ? 'Editions' : 'Locations'}
            className="mt-1 flex-wrap"
          >
            {view.editions.map((e) => (
              <Chip
                key={e.id}
                pressed={s.editions.includes(e.id)}
                disabled={!editable || view.editions.length === 1}
                onClick={() => toggleEdition(e.id)}
              >
                {display.editionLabel(e.id, e.label)}
                <span className="font-normal opacity-80">· {e.count} locations</span>
              </Chip>
            ))}
          </Chips>
          {view.editions.length > 1 && (
            <p className="mt-1 text-caption text-ink-muted">
              Pick one edition or both: {view.locations.length} locations in play.
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend className="text-small font-semibold">Round length</legend>
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
          <Field label="Rounds">
            <Select
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
            </Select>
          </Field>
          <Switch
            on={s.twoSpies}
            editable={editable}
            title="Two spies"
            help={`From ${TWO_SPIES_MIN} players. The spies don’t know each other.${
              s.twoSpies && seated < TWO_SPIES_MIN ? ` (One spy until ${TWO_SPIES_MIN} play.)` : ''
            }`}
            onChange={(on) => void act({ type: 'update-settings', twoSpies: on })}
          />
        </div>
      </LobbySettings>
      {editable && (
        <StickyBar>
          <div className="space-y-1.5">
            <Button
              size="lg"
              disabled={blocker !== null}
              onClick={() => void act({ type: 'start' })}
            >
              Start game
            </Button>
            {blocker && <p className="text-caption text-ink-muted">{blocker}</p>}
          </div>
        </StickyBar>
      )}
    </div>
  );
}
