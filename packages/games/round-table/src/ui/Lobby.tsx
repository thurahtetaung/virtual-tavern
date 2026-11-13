import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Fold,
  GuideLink,
  Hint,
  Icon,
  Notice,
  Panel,
  PlayerTag,
  Switch,
  TimerSettings,
  cn,
  LobbySettings,
  timersLine,
  LobbyLayout,
  LobbyPitch,
  LobbyStart,
} from '@vt/ui';
import { guide } from '../logic/guide.ts';
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
      ? 'bg-accent-soft text-accent-text ring-2 ring-accent'
      : 'bg-card ring-line-strong enabled:hover:bg-panel',
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
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
          <span>Watching:</span>
          {watching.map((s) => (
            <PlayerTag key={s.id} name={s.name} you={s.id === view.me?.id} />
          ))}
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
      <legend
        className={cn(
          'mb-1 text-small font-bold',
          side === 'good' ? 'text-team-b-ink' : 'text-team-a-ink',
        )}
      >
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
              'flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left transition disabled:cursor-default',
              on
                ? side === 'good'
                  ? 'bg-team-b-soft ring-2 ring-team-b'
                  : 'bg-team-a-soft ring-2 ring-team-a'
                : 'bg-card ring-1 ring-line-strong enabled:hover:bg-panel',
              !editable && !on && 'opacity-60',
              full && 'opacity-50',
            )}
          >
            <Emblem role={r} className="size-8" />
            <span className="min-w-0 flex-1">
              <span className="block text-small leading-tight font-semibold">{ROLES[r].name}</span>
              <span className="block text-caption leading-tight text-ink-muted">
                {ROLES[r].blurb}
              </span>
            </span>
            {on && (
              <Icon
                name="check"
                className={side === 'good' ? 'text-team-b-ink' : 'text-team-a-ink'}
              />
            )}
          </button>
        );
      })}
      <div className="flex items-center gap-2 px-3 py-1.5 text-small">
        <Emblem role={plain} className="size-8" />
        <span>
          <b>
            {ROLES[plain].name} ×{plainCount}
          </b>
          <span className="block text-caption text-ink-muted">fill the rest</span>
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
  // The tick only once the table really has that many players.
  const ticked = balanced && seated === size;
  // The first error is said once, under Start game (or in a guest's status line).
  const panelErrors = view.setup.errors.slice(1);
  const toggle = (r: RoleId) => {
    const next = view.deck.includes(r) ? view.deck.filter((x) => x !== r) : [...view.deck, r];
    void act({ type: 'update-settings', roles: next });
  };
  const blocker = view.setup.errors[0] ?? null;
  return (
    <LobbyLayout
      pitch={
        <LobbyPitch
          title={room.gameName ?? 'Round Table'}
          artClassName="w-auto sm:w-auto lg:w-auto"
          art={
            <span aria-hidden className="flex -space-x-3">
              <Emblem role="servant" className="size-14 lg:size-20" />
              <Emblem role="minion" className="size-14 lg:size-20" />
            </span>
          }
        >
          {guide.tagline}
        </LobbyPitch>
      }
      rail={
        <>
          <LobbySettings
            editable={editable}
            title="Roles"
            summary={[
              PRESETS.find((p) => p.id === s.preset)?.name ?? 'Own line-up',
              `${good} Good vs ${evil} Evil`,
            ]}
            className="space-y-4"
          >
            <fieldset>
              <legend className="text-small font-semibold">Ready-made line-ups</legend>
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
                    <span className="block text-small font-semibold">{p.name}</span>
                    <span className="block text-caption text-ink-muted">{p.blurb}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-caption text-ink-muted">
                {s.preset
                  ? 'Suggested line-ups follow the table size. Tap a role below to make your own.'
                  : 'Your own line-up: tap roles on or off.'}
              </p>
            </fieldset>
            <div
              className={cn(
                'rounded-lg px-3 py-1.5 text-center text-small font-semibold ring-1 ring-inset',
                ticked
                  ? 'bg-success-soft text-success-ink ring-success-line'
                  : balanced
                    ? 'bg-panel text-ink-2 ring-line'
                    : 'bg-danger-soft text-danger-ink ring-danger-line',
              )}
              data-testid="balance"
            >
              <span className={SIDE_TEXT.good}>{good} Good</span> vs{' '}
              <span className={SIDE_TEXT.evil}>{evil} Evil</span>
              {ticked
                ? ` ✓ right for ${size} players`
                : balanced
                  ? ` · right for ${size} players`
                  : ` · ${size} players need ${goodCount(size)} vs ${evilCount(size)}`}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RoleColumn
                side="good"
                view={view}
                editable={editable}
                onToggle={toggle}
                size={size}
              />
              <RoleColumn
                side="evil"
                view={view}
                editable={editable}
                onToggle={toggle}
                size={size}
              />
            </div>
            {(panelErrors.length > 0 || view.setup.notes.length > 0) && (
              <ul className="space-y-1.5" aria-label="Setup notes">
                {panelErrors.map((e) => (
                  <li key={e}>
                    <Notice tone="danger" className="font-semibold">
                      ⚠️ {e}
                    </Notice>
                  </li>
                ))}
                {view.setup.notes.map((n) => (
                  <li key={n} className="text-small text-ink-muted">
                    ℹ️ {n}
                  </li>
                ))}
              </ul>
            )}
          </LobbySettings>
          <LobbySettings
            editable={editable}
            title="Settings"
            summary={[
              s.lady && 'Lady of the Lake',
              s.targeting && 'Targeting',
              timersLine(
                { clueSeconds: s.pickSeconds, guessSeconds: s.voteSeconds, timerMode: s.timerMode },
                { clue: 'leader', guess: 'votes' },
              ),
            ]}
            className="space-y-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Switch
                on={s.lady}
                editable={editable}
                title="🌊 Lady of the Lake"
                help="After quests 2, 3 and 4, her holder secretly checks one player’s loyalty. Best from 7 players."
                onChange={(on) => void act({ type: 'update-settings', lady: on })}
              />
              <Switch
                on={s.targeting}
                editable={editable}
                title="🎯 Targeting"
                help="Leaders choose which quest to attempt; quest 5 opens after two successes."
                onChange={(on) => void act({ type: 'update-settings', targeting: on })}
              />
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
            <Fold summary={<span className="font-semibold">Advanced</span>}>
              <Switch
                on={s.oberonHidden}
                editable={editable}
                title="Oberon: the FAQ reading"
                help="Off (rulebook): Merlin sees Oberon as Evil, and the Lady shows him as Evil. On (FAQ): Merlin doesn’t see Oberon, and the Lady shows him as Good."
                onChange={(on) => void act({ type: 'update-settings', oberonHidden: on })}
              />
            </Fold>
          </LobbySettings>
        </>
      }
      start={
        editable && <LobbyStart blocker={blocker} onStart={() => void act({ type: 'start' })} />
      }
    >
      {status.text && <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>}
      <Panel>
        <Players view={view} online={online} hostId={room.hostId} />
      </Panel>
      <GuideLink title={room.gameName ?? 'Round Table'} onClick={showGuide} />
    </LobbyLayout>
  );
}
