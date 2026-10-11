import type { ActOptions, GameRoomInfo } from '@vt/game-sdk';
import { Button, Hint, Panel, PlayerTag, RefusalSlot, StickyBar, cn } from '@vt/ui';
import { buildNightPlan, epicPossible, stepDurations, usesMarks } from '../logic/plan.ts';
import {
  LEVEL_LABEL,
  type Preset,
  RECOMMENDED,
  SCENARIOS,
  cardsNeeded,
  recommended,
  scenarioRoles,
} from '../logic/presets.ts';
import {
  ARTIFACTS,
  ARTIFACT_IDS,
  ENABLED_SETS,
  ROLES,
  type RoleId,
  type Team,
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
import { CardFace, MarkChip, useRoleDetails } from './Cards.tsx';
import { type Status, startBlocker } from './status.ts';
import { TEAM_LABEL } from './text.ts';

type Act = (a: NightfallAction, options?: ActOptions) => Promise<boolean>;

const STEP_CHOICES = [5, 8, 10, 12, 15, 20, 30];
const DAY_CHOICES = [120, 180, 240, 300, 420, 600].filter(
  (s) => s >= MIN_DAY_SECONDS && s <= MAX_DAY_SECONDS,
);
const NARRATION: { id: NarrationMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'host', label: 'Host’s device' },
  { id: 'all', label: 'Every device' },
];

/** Who hears what, for each narration choice. */
const NARRATION_HELP: Record<NarrationMode, string> = {
  off: 'No phone speaks. Every screen still shows the narration as text, so someone can read it out.',
  host: 'Only the host’s phone speaks the narration out loud: put it in the middle of the table. Every screen also shows it as text.',
  all: 'Every phone speaks. Best when you play apart (on a call); in one room the voices echo, so pick Host’s device.',
};

/** A team colour (with its name, not colour alone) on each role tile. */
const TEAM_PILL: Record<Team, string> = {
  village: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200',
  werewolf: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-200',
  tanner: 'bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-200',
  vampire: 'bg-purple-100 text-purple-900 dark:bg-purple-500/15 dark:text-purple-200',
  assassin: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-500/20 dark:text-zinc-100',
  'apprentice-assassin': 'bg-zinc-200 text-zinc-900 dark:bg-zinc-500/20 dark:text-zinc-100',
};

/** A ready-made setup: its name, a tag, one line, and why it can't be picked (as text). */
function PresetCard({
  name,
  preset,
  roles,
  current,
  minPlayers,
  onPick,
}: {
  name: string;
  preset: Pick<Preset, 'description' | 'level'>;
  roles: RoleId[] | null;
  current: readonly RoleId[];
  minPlayers: number;
  onPick: (roles: RoleId[]) => void;
}) {
  const on = roles !== null && [...roles].sort().join() === [...current].sort().join();
  return (
    <li>
      <button
        type="button"
        disabled={!roles}
        aria-pressed={on}
        onClick={() => roles && onPick(roles)}
        className={cn(
          'flex h-full w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left ring-1 transition',
          on
            ? 'bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-500/10'
            : 'bg-white ring-stone-300 hover:bg-stone-50 dark:bg-stone-900 dark:ring-stone-700 dark:hover:bg-stone-800',
          !roles && 'opacity-60',
        )}
      >
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          {name}
          <span
            className={cn(
              'rounded-full px-1.5 text-xs font-semibold',
              preset.level === 'beginner'
                ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200'
                : preset.level === 'chaos'
                  ? 'bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200'
                  : 'bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100',
            )}
          >
            {LEVEL_LABEL[preset.level]}
          </span>
        </span>
        <span className="text-xs text-stone-600 dark:text-stone-400">{preset.description}</span>
        {!roles && (
          <span className="text-xs font-semibold text-rose-700 dark:text-rose-400">
            Needs {minPlayers}+ players
          </span>
        )}
      </button>
    </li>
  );
}

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
      <span
        className={cn(
          'rounded-full px-1.5 text-[0.7rem] font-semibold',
          TEAM_PILL[ROLES[role].team],
        )}
      >
        {TEAM_LABEL[ROLES[role].team]}
      </span>
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
  const tableSize = Math.max(3, Math.min(MAX_PLAYERS, seated.length));
  // The setups stay open until the host has a card list of their own.
  const customised =
    s.roles.length === need &&
    ![recommended(seated.length), ...SCENARIOS.map((p) => scenarioRoles(p, seated.length))].some(
      (r) => r && [...r].sort().join() === [...s.roles].sort().join(),
    );
  const sets = rolesBySet(ENABLED_SETS);
  const advancedIn = sets
    .filter(({ set }) => set !== 'base')
    .reduce((n, { roles: all }) => n + all.reduce((m, r) => m + (counts.get(r) ?? 0), 0), 0);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Panel className="space-y-2">
        <h3 className="font-bold">
          Players ({seated.length}/{MAX_PLAYERS})
        </h3>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {seated.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-1">
              <span aria-hidden>🕯️</span>
              <PlayerTag
                name={p.name}
                host={p.id === room.hostId}
                you={p.id === view.me?.id}
                offline={!online(p.id)}
              />
            </li>
          ))}
        </ul>
        {view.seats.some((x) => !x.playing) && (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Watching:{' '}
            {view.seats
              .filter((x) => !x.playing)
              .map((x) => (
                <PlayerTag
                  key={x.id}
                  className="mr-2"
                  name={x.name}
                  host={x.id === room.hostId}
                  you={x.id === view.me?.id}
                  offline={!online(x.id)}
                />
              ))}
          </p>
        )}
        {view.me && (
          <Button
            size="sm"
            variant={view.me.playing ? 'ghost' : 'primary'}
            onClick={() => void act({ type: 'sit', playing: !view.me!.playing })}
          >
            {view.me.playing ? 'Sit out (watch)' : 'Take a seat'}
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
            {usesMarks(s.roles) ? ` · ${seated.length} Marks` : ''}
          </span>
        </div>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          One card per player, three in the centre
          {s.roles.includes('alpha-wolf') ? ', and one more for the centre werewolf' : ''}. Tap a
          card to read it.
        </p>
        {usesMarks(s.roles) && (
          <p className="text-sm" data-testid="marks-setup">
            Marks are in play: every player starts with a face-down{' '}
            <MarkChip mark="clarity" deck={deck} />
            {buildNightPlan(s.roles).includes('dusk') ? ', and looks at their Mark at dusk.' : '.'}
          </p>
        )}
        {epicPossible(s.roles) && (
          <p className="text-sm" data-testid="epic-hint">
            ⚔️ Werewolves and vampires: if both are dealt to players, it’s an epic battle, and the
            two most voted players die.
          </p>
        )}
        {editable && s.roles.length !== need && (
          <div className="flex flex-wrap items-center gap-2" data-testid="fit-cards">
            <Button size="sm" onClick={() => setRoles(recommended(seated.length))}>
              Use the recommended cards for {tableSize}
            </Button>
            <span className="text-xs text-stone-600 dark:text-stone-400">
              or add and remove cards below.
            </span>
          </div>
        )}
        {editable && (
          <details className="group space-y-1" open={!customised}>
            <summary className="flex cursor-pointer items-center gap-2 py-1 text-sm font-bold">
              <span aria-hidden className="transition group-open:rotate-90">
                ▸
              </span>
              Ready-made setups
            </summary>
            <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Ready-made setups">
              <PresetCard
                name={`Recommended for ${tableSize}`}
                preset={RECOMMENDED}
                roles={recommended(seated.length)}
                current={s.roles}
                minPlayers={3}
                onPick={setRoles}
              />
              {SCENARIOS.map((p) => (
                <PresetCard
                  key={p.id}
                  name={presetName(p.id, p.name)}
                  preset={p}
                  roles={scenarioRoles(p, seated.length)}
                  current={s.roles}
                  minPlayers={p.minPlayers}
                  onPick={setRoles}
                />
              ))}
            </ul>
          </details>
        )}
        {(() => {
          const groups = sets.map(({ set, roles: all }) => {
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
          });
          if (!editable) return groups;
          // The host's picker: the base set first, the rest folded away until wanted.
          return (
            <>
              {groups[0]}
              <details open={advancedIn > 0} className="group/more space-y-1">
                <summary className="flex cursor-pointer items-center gap-2 py-1 text-sm font-bold">
                  <span aria-hidden className="transition group-open/more:rotate-90">
                    ▸
                  </span>
                  More roles (advanced)
                  {advancedIn > 0 && <span className="font-normal">· {advancedIn} in</span>}
                </summary>
                <div className="space-y-1 pl-2">{groups.slice(1)}</div>
              </details>
            </>
          );
        })()}
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
        <p className="text-xs text-stone-600 dark:text-stone-400" data-testid="narration-help">
          {NARRATION_HELP[s.narration]}
        </p>
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
            {s.narration === 'off' && (
              <span className="text-xs">
                (plays on the narrating phones, so it needs narration)
              </span>
            )}
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

      {/* On phones the long card list pushes Deal off screen, so it floats at the bottom. */}
      <StickyBar>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <Button
              size="lg"
              disabled={blocker !== null}
              onClick={() => void act({ type: 'start' }, { anchor: 'nightfall-deal' })}
            >
              Deal the cards
            </Button>
          )}
          <Button variant="ghost" onClick={showGuide}>
            How to play
          </Button>
        </div>
        <RefusalSlot anchor="nightfall-deal" />
      </StickyBar>
    </div>
  );
}
