import type { GameRoomInfo } from '@vt/game-sdk';
import { Badge, Button, Hint, Panel, cn } from '@vt/ui';
import { buildNightPlan, stepDurations } from '../logic/plan.ts';
import { cardsNeeded, recommended, SCENARIOS, scenarioRoles } from '../logic/presets.ts';
import {
  ARTIFACTS,
  ARTIFACT_IDS,
  ENABLED_SETS,
  ROLES,
  type RoleId,
  defaultArtifacts,
  rolesBySet,
} from '../logic/roles.ts';
import {
  MAX_DAY_SECONDS,
  MAX_PLAYERS,
  MIN_DAY_SECONDS,
  type NarrationMode,
  type NightfallAction,
  type NightfallView,
} from '../logic/types.ts';
import type { Deck } from './assets.ts';
import { CardFace, useRoleDetails } from './Cards.tsx';
import { type Status, startBlocker } from './status.ts';

type Act = (a: NightfallAction) => Promise<boolean>;

const STEP_CHOICES = [5, 8, 10, 12, 15, 20, 30];
const DAY_CHOICES = [120, 180, 240, 300, 420, 600].filter(
  (s) => s >= MIN_DAY_SECONDS && s <= MAX_DAY_SECONDS,
);
const NARRATION: { id: NarrationMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'host', label: 'Host’s device' },
  { id: 'all', label: 'Every device' },
];

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="space-y-1">
      <p className="text-sm font-semibold">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={String(o.id)}
            type="button"
            aria-pressed={o.id === value}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={cn(
              'h-9 rounded-lg px-3 text-sm font-semibold ring-1 ring-stone-300 transition dark:ring-stone-700',
              o.id === value
                ? 'bg-indigo-700 text-white ring-indigo-700 dark:bg-indigo-500 dark:ring-indigo-500'
                : 'bg-white hover:bg-stone-50 dark:bg-stone-900 dark:hover:bg-stone-800',
              disabled && o.id !== value && 'opacity-50',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One role in the picker: tap the picture to read it, +/- to change how many are in. */
function RoleTile({
  role,
  count,
  deck,
  editable,
  onChange,
}: {
  role: RoleId;
  count: number;
  deck: Deck;
  editable: boolean;
  onChange: (n: number) => void;
}) {
  const open = useRoleDetails();
  const max = ROLES[role].count;
  return (
    <li
      data-testid={`role-${role}`}
      className={cn(
        'flex w-[6.5rem] flex-col items-center gap-1 rounded-xl p-1.5 ring-1',
        count > 0
          ? 'bg-indigo-50 ring-indigo-400 dark:bg-indigo-500/10 dark:ring-indigo-400/60'
          : 'ring-stone-200 dark:ring-stone-800',
      )}
    >
      <button
        type="button"
        onClick={() => open(role)}
        aria-label={`Read the ${deck.name(role)} card`}
        className="rounded-lg"
      >
        <CardFace role={role} deck={deck} size="sm" className={cn(count === 0 && 'opacity-60')} />
      </button>
      <span className="w-full truncate text-center text-xs font-semibold">{deck.name(role)}</span>
      {editable ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`One less ${deck.name(role)}`}
            disabled={count === 0}
            onClick={() => onChange(count - 1)}
            className="size-8 rounded-full bg-stone-200 font-bold disabled:opacity-30 dark:bg-stone-800"
          >
            −
          </button>
          <span className="w-4 text-center text-sm tabular-nums">{count}</span>
          <button
            type="button"
            aria-label={`One more ${deck.name(role)}`}
            disabled={count >= max}
            onClick={() => onChange(count + 1)}
            className="size-8 rounded-full bg-stone-200 font-bold disabled:opacity-30 dark:bg-stone-800"
          >
            +
          </button>
        </div>
      ) : (
        <span className="text-sm tabular-nums">{count > 0 ? `×${count}` : ''}</span>
      )}
    </li>
  );
}

export function Lobby({
  view,
  room,
  act,
  status,
  deck,
  online,
  showGuide,
}: {
  view: NightfallView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  deck: Deck;
  online: (id: string) => boolean;
  showGuide: () => void;
}) {
  const editable = room.isHost;
  const s = view.settings;
  const seated = view.seats.filter((x) => x.playing);
  const need = cardsNeeded(seated.length, s.roles);
  const counts = new Map<RoleId, number>();
  for (const r of s.roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  const setRoles = (roles: RoleId[]) => void act({ type: 'update-settings', roles });
  const setCount = (role: RoleId, n: number) => {
    const rest = s.roles.filter((r) => r !== role);
    setRoles([...rest, ...Array<RoleId>(n).fill(role)]);
  };
  const blocker = startBlocker(view);
  const offered = defaultArtifacts(s.roles);
  const presetName = (id: string, fallback: string) =>
    deck.manifest?.presets?.[id]?.name?.trim() || fallback;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Panel className="space-y-2">
        <h3 className="font-bold">
          Players ({seated.length}/{MAX_PLAYERS})
        </h3>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {seated.map((p) => (
            <li
              key={p.id}
              className={cn('inline-flex items-center gap-1', !online(p.id) && 'opacity-50')}
            >
              <span aria-hidden>🕯️</span>
              {p.name}
              {p.id === view.me?.id && <Badge>you</Badge>}
            </li>
          ))}
        </ul>
        {view.seats.some((x) => !x.playing) && (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Watching:{' '}
            {view.seats
              .filter((x) => !x.playing)
              .map((x) => x.name)
              .join(', ')}
          </p>
        )}
        {view.me && (
          <Button
            size="sm"
            variant={view.me.playing ? 'ghost' : 'primary'}
            onClick={() => void act({ type: 'sit', playing: !view.me!.playing })}
          >
            {view.me.playing ? 'Just watch' : 'Take a seat'}
          </Button>
        )}
      </Panel>

      <Panel className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold">The cards</h3>
          <span
            data-testid="card-count"
            className={cn(
              'text-sm font-semibold',
              s.roles.length === need
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-700 dark:text-rose-400',
            )}
          >
            {s.roles.length} of {need} cards
            {s.roles.includes('alpha-wolf') ? ' (with the centre werewolf)' : ''}
          </span>
        </div>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          One card per player, three in the centre
          {s.roles.includes('alpha-wolf') ? ', and one more for the centre werewolf' : ''}. Tap a
          card to read it.
        </p>
        {editable && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setRoles(recommended(seated.length))}
            >
              Recommended for {Math.max(3, Math.min(MAX_PLAYERS, seated.length))}
            </Button>
            {SCENARIOS.map((p) => {
              const roles = scenarioRoles(p, seated.length);
              return (
                <Button
                  key={p.id}
                  size="sm"
                  variant="secondary"
                  disabled={!roles}
                  title={roles ? undefined : `Needs at least ${p.minPlayers} players`}
                  onClick={() => roles && setRoles(roles)}
                >
                  {presetName(p.id, p.name)}
                </Button>
              );
            })}
          </div>
        )}
        {rolesBySet(ENABLED_SETS).map(({ set, roles: all }) => {
          // Guests see only what's in; the host sees every set, the busy ones open.
          const roles = editable ? all : all.filter((r) => counts.has(r));
          const inSet = all.reduce((n, r) => n + (counts.get(r) ?? 0), 0);
          if (!roles.length) return null;
          return (
            <details
              key={set}
              open={!editable || set === 'base' || inSet > 0}
              aria-label={deck.setName(set)}
              className="group space-y-1"
            >
              <summary className="flex cursor-pointer items-center gap-2 py-1 text-sm font-bold text-stone-600 dark:text-stone-400">
                <span aria-hidden className="transition group-open:rotate-90">
                  ▸
                </span>
                {deck.setName(set)}
                {inSet > 0 && <span className="font-normal">· {inSet} in</span>}
              </summary>
              <ul className="flex flex-wrap gap-1.5">
                {roles.map((role) => (
                  <RoleTile
                    key={role}
                    role={role}
                    count={counts.get(role) ?? 0}
                    deck={deck}
                    editable={editable}
                    onChange={(n) => setCount(role, n)}
                  />
                ))}
              </ul>
            </details>
          );
        })}
      </Panel>

      <Panel className="space-y-3">
        <h3 className="font-bold">Settings</h3>
        <Segmented
          label="Time for each role at night"
          value={s.stepSeconds}
          options={STEP_CHOICES.map((n) => ({ id: n, label: `${n} s` }))}
          onChange={(stepSeconds) => void act({ type: 'update-settings', stepSeconds })}
          disabled={!editable}
        />
        <Segmented
          label="Length of the day"
          value={s.daySeconds}
          options={DAY_CHOICES.map((n) => ({ id: n, label: `${n / 60} min` }))}
          onChange={(daySeconds) => void act({ type: 'update-settings', daySeconds })}
          disabled={!editable}
        />
        <Segmented
          label="Narration out loud"
          value={s.narration}
          options={NARRATION}
          onChange={(narration) => void act({ type: 'update-settings', narration })}
          disabled={!editable}
        />
        <div className="flex flex-wrap gap-4">
          <label
            className={cn('flex items-center gap-2 text-sm', s.narration === 'off' && 'opacity-50')}
          >
            <input
              type="checkbox"
              checked={s.music}
              disabled={!editable || s.narration === 'off'}
              onChange={(e) => void act({ type: 'update-settings', music: e.target.checked })}
            />
            Background music
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.loneWolf}
              disabled={!editable}
              onChange={(e) => void act({ type: 'update-settings', loneWolf: e.target.checked })}
            />
            A lone werewolf may look at a centre card
          </label>
        </div>
        {s.roles.includes('curator') && (
          <div className="space-y-1">
            <p className="text-sm font-semibold">Artifacts the Curator may draw</p>
            <div className="flex flex-wrap gap-1">
              {ARTIFACT_IDS.filter((a) => offered.includes(a)).map((a) => {
                const on = s.artifacts.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    disabled={!editable}
                    title={deck.artifactText(a)}
                    onClick={() =>
                      void act({
                        type: 'update-settings',
                        artifacts: on ? s.artifacts.filter((x) => x !== a) : [...s.artifacts, a],
                      })
                    }
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-semibold ring-1',
                      on
                        ? 'bg-violet-600 text-white ring-violet-600'
                        : 'ring-stone-300 dark:ring-stone-700',
                    )}
                  >
                    {deck.artifactName(a)}
                    {ARTIFACTS[a].becomes ? ' ✦' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <p className="text-xs text-stone-500">
          Every role in the game is called for the same time, even when its card is in the centre.
          With these cards the night lasts{' '}
          {Math.round(
            stepDurations(buildNightPlan(s.roles), s.stepSeconds).reduce((a, b) => a + b, 0) / 1000,
          )}{' '}
          s.
        </p>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <Button size="lg" disabled={blocker !== null} onClick={() => void act({ type: 'start' })}>
            Deal the cards
          </Button>
        )}
        <Button variant="ghost" onClick={showGuide}>
          How to play
        </Button>
      </div>
    </div>
  );
}
