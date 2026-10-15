import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Hint, Panel, PlayerTag, StickyBar, TimerSettings, cn } from '@vt/ui';
import { ROLES, ROLE_ORDER } from '../logic/roles.ts';
import { PRESETS, evilCount, goodCount } from '../logic/setup.ts';
import {
  MAX_SEATS,
  MIN_PLAYERS,
  type Loyalty,
  type RoleId,
  type RoundTableView,
} from '../logic/types.ts';
import type { Act } from './Actions.tsx';
import { Emblem, SIDE_TEXT } from './Emblem.tsx';
import type { Status } from './status.ts';

const choice = (on: boolean, editable: boolean) =>
  cn(
    'rounded-xl px-3 py-2 text-left ring-1 transition disabled:cursor-default',
    on
      ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
      : 'bg-white ring-stone-200 enabled:hover:bg-stone-100 dark:bg-stone-900 dark:ring-stone-700 dark:enabled:hover:bg-stone-800',
    !editable && !on && 'opacity-60',
  );

export function Players({
  view,
  online,
  hostId,
}: {
  view: RoundTableView;
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
            <span aria-hidden>⚔️</span>
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
          Watching: {watching.map((s) => s.name).join(', ')}
        </p>
      )}
    </section>
  );
}

/** The special roles of one side, each switched on or off; plain cards fill the rest. */
function RoleColumn({
  side,
  view,
  editable,
  onToggle,
  size,
}: {
  side: Loyalty;
  view: RoundTableView;
  editable: boolean;
  onToggle: (role: RoleId) => void;
  size: number;
}) {
  const deck = view.deck;
  const want = side === 'good' ? goodCount(size) : evilCount(size);
  const plain: RoleId = side === 'good' ? 'servant' : 'minion';
  const specials = ROLE_ORDER.filter((r) => ROLES[r].loyalty === side && !ROLES[r].plain);
  const used = deck.filter((r) => ROLES[r].loyalty === side && !ROLES[r].plain).length;
  const plainCount = deck.filter((r) => r === plain).length;
  return (
    <fieldset className="min-w-0 space-y-1.5">
      <legend className={cn('mb-1 text-sm font-bold', SIDE_TEXT[side])}>
        {side === 'good' ? '🛡️ Good' : '🗡️ Evil'} · {want}
      </legend>
      {specials.map((r) => {
        const on = deck.includes(r);
        const full = !on && used >= want;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            disabled={!editable || full}
            title={
              full
                ? `${side === 'good' ? 'Good' : 'Evil'} is full: take a role out first`
                : ROLES[r].detail
            }
            onClick={() => onToggle(r)}
            className={cn(
              choice(on, editable),
              'flex w-full items-center gap-2 py-1.5',
              full && 'opacity-50',
            )}
          >
            <Emblem role={r} className="size-8" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm leading-tight font-semibold">
                {on ? '✓ ' : ''}
                {ROLES[r].name}
              </span>
              <span className="block text-xs leading-tight text-ink-muted">{ROLES[r].blurb}</span>
            </span>
          </button>
        );
      })}
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
        <Emblem role={plain} className="size-8" />
        <span>
          <b>
            {ROLES[plain].name} ×{plainCount}
          </b>
          <span className="block text-xs text-ink-muted">fill the rest</span>
        </span>
      </div>
    </fieldset>
  );
}

export function Lobby({
  view,
  room,
  act,
  status,
  online,
  showGuide,
}: {
  view: RoundTableView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  online: (id: string) => boolean;
  showGuide: () => void;
}) {
  const editable = room.isHost;
  const s = view.settings;
  const seated = view.seats.filter((x) => x.playing).length;
  const size = Math.min(MAX_SEATS, Math.max(MIN_PLAYERS, seated));
  const good = view.deck.filter((r) => ROLES[r].loyalty === 'good').length;
  const evil = view.deck.length - good;
  const balanced = good === goodCount(size) && evil === evilCount(size);
  const toggle = (r: RoleId) => {
    const next = view.deck.includes(r) ? view.deck.filter((x) => x !== r) : [...view.deck, r];
    void act({ type: 'update-settings', roles: next });
  };
  const blocker = view.setup.errors[0] ?? null;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Panel>
        <Players view={view} online={online} hostId={room.hostId} />
      </Panel>
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold">Roles</h3>
          {!editable && (
            <span className="text-sm text-ink-muted">Only the host can change these.</span>
          )}
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">Ready-made line-ups</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={s.preset === p.id}
                disabled={!editable}
                onClick={() => void act({ type: 'update-settings', preset: p.id })}
                className={choice(s.preset === p.id, editable)}
              >
                <span className="block text-sm font-semibold">{p.name}</span>
                <span className="block text-xs text-stone-600 dark:text-stone-400">{p.blurb}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {s.preset
              ? 'Suggested line-ups follow the table size. Tap a role below to make your own.'
              : 'Your own line-up: tap roles on or off.'}
          </p>
        </fieldset>
        <div
          className={cn(
            'rounded-lg px-3 py-1.5 text-center text-sm font-semibold',
            balanced
              ? 'bg-success-soft text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200'
              : 'bg-team-a-soft text-rose-900 dark:bg-rose-500/10 dark:text-rose-200',
          )}
          data-testid="balance"
        >
          <span className={SIDE_TEXT.good}>{good} Good</span> vs{' '}
          <span className={SIDE_TEXT.evil}>{evil} Evil</span>
          {balanced
            ? ` ✓ right for ${size} players`
            : ` · ${size} players need ${goodCount(size)} vs ${evilCount(size)}`}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RoleColumn side="good" view={view} editable={editable} onToggle={toggle} size={size} />
          <RoleColumn side="evil" view={view} editable={editable} onToggle={toggle} size={size} />
        </div>
        {(view.setup.errors.length > 0 || view.setup.notes.length > 0) && (
          <ul className="space-y-1 text-sm" aria-label="Setup notes">
            {view.setup.errors.map((e) => (
              <li key={e} className="font-semibold text-rose-700 dark:text-rose-400">
                ⚠️ {e}
              </li>
            ))}
            {view.setup.notes.map((n) => (
              <li key={n} className="text-stone-600 dark:text-stone-400">
                ℹ️ {n}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="space-y-4">
        <h3 className="text-lg font-bold">Options</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-5 accent-amber-600"
              checked={s.lady}
              disabled={!editable}
              onChange={(e) => void act({ type: 'update-settings', lady: e.target.checked })}
            />
            <span>
              <span className="block font-semibold">🌊 Lady of the Lake</span>
              <span className="block text-xs text-ink-muted">
                After quests 2, 3 and 4, her holder secretly checks one player’s loyalty. Best from
                7 players.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-5 accent-amber-600"
              checked={s.targeting}
              disabled={!editable}
              onChange={(e) => void act({ type: 'update-settings', targeting: e.target.checked })}
            />
            <span>
              <span className="block font-semibold">🎯 Targeting</span>
              <span className="block text-xs text-ink-muted">
                Leaders choose which quest to attempt; quest 5 opens after two successes.
              </span>
            </span>
          </label>
        </div>
        <TimerSettings
          values={{
            clueSeconds: s.pickSeconds,
            guessSeconds: s.voteSeconds,
            timerMode: s.timerMode,
          }}
          editable={editable}
          onChange={(patch) =>
            void act({
              type: 'update-settings',
              ...(patch.clueSeconds !== undefined ? { pickSeconds: patch.clueSeconds } : {}),
              ...(patch.guessSeconds !== undefined ? { voteSeconds: patch.guessSeconds } : {}),
              ...(patch.timerMode !== undefined ? { timerMode: patch.timerMode } : {}),
            })
          }
          clueLabel="Leader timer"
          clueHelp="Choosing a team, the talk before the vote, the Lady’s check and the assassination."
          guessLabel="Vote and quest timer"
          guessHelp="Voting on a team, and playing quest cards."
          strictHelp="the vote opens on an announced team, a missing vote approves, a missing card is Success, and picks are made at random"
        />
        <details className="group rounded-xl ring-1 ring-stone-200 dark:ring-stone-800">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span>Advanced</span>
            <span aria-hidden className="text-ink-muted transition group-open:rotate-90">
              ▸
            </span>
          </summary>
          <label className="flex items-start gap-3 px-3 pb-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-5 accent-amber-600"
              checked={s.oberonHidden}
              disabled={!editable}
              onChange={(e) =>
                void act({ type: 'update-settings', oberonHidden: e.target.checked })
              }
            />
            <span>
              <span className="block font-semibold">Oberon: the FAQ reading</span>
              <span className="block text-xs text-ink-muted">
                Off (rulebook): Merlin sees Oberon as Evil, and the Lady shows him as Evil. On
                (FAQ): Merlin doesn’t see Oberon, and the Lady shows him as Good.
              </span>
            </span>
          </label>
        </details>
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
      </Panel>
      <p className="text-center text-sm text-ink-muted">
        New to Round Table?{' '}
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
