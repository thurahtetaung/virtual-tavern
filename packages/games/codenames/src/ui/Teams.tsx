import { Button, PlayerTag, cn } from '@vt/ui';
import type { CodenamesAction, CodenamesView, Team } from '../logic/types.ts';
import { canTakeSpymaster as canTakeSeat } from './status.ts';
import { TEAM_LABEL, TEAM_PANEL, TEAM_TEXT } from './theme.ts';

interface Props {
  view: CodenamesView;
  online: (id: string) => boolean;
  act: (a: CodenamesAction) => Promise<boolean>;
  /** The room host, crowned in the lists. */
  hostId?: string;
  /** Compact layout for use beside the board mid-game. */
  compact?: boolean;
}

function Name({
  id,
  name,
  me,
  online,
  hostId,
}: {
  id: string;
  name: string;
  me: string | undefined;
  online: boolean;
  hostId?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full',
          online ? 'bg-success dark:bg-emerald-500' : 'bg-stone-400',
        )}
      />
      <PlayerTag name={name} host={id === hostId} you={id === me} offline={!online} />
    </span>
  );
}

function TeamColumn({ team, view, online, act, compact, hostId }: Props & { team: Team }) {
  const members = view.seats.filter((s) => s.team === team);
  const spymaster = members.find((s) => s.role === 'spymaster');
  const operatives = members.filter((s) => s.role === 'operative');
  const me = view.me;
  const playing = view.phase === 'playing';
  const keyHeld = me ? view.keyHolders[me.id] : undefined;
  const canTakeSpymaster = canTakeSeat(view, team);
  const canJoinOps =
    me !== null &&
    !(me.team === team && me.role === 'operative') &&
    (!playing || (me.team === null && keyHeld === undefined));
  const remaining = view.phase === 'lobby' ? null : view.remaining[team];

  return (
    <section
      className={cn('rounded-2xl p-3 ring-1', TEAM_PANEL[team])}
      aria-label={`${TEAM_LABEL[team]} team`}
    >
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className={cn('text-lg font-bold', TEAM_TEXT[team])}>{TEAM_LABEL[team]} team</h3>
        {remaining !== null && (
          <span className={cn('text-sm font-semibold', TEAM_TEXT[team])}>
            {remaining} agents left
          </span>
        )}
      </header>
      <div className="space-y-2 text-sm">
        <div>
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Spymaster</p>
          {!compact && (
            <p className="mb-1 text-xs text-stone-600 dark:text-stone-400">
              Sees the secret key and gives one-word clues.
            </p>
          )}
          {spymaster ? (
            <Name
              id={spymaster.id}
              name={spymaster.name}
              me={me?.id}
              online={online(spymaster.id)}
              hostId={hostId}
            />
          ) : canTakeSpymaster ? (
            <Button
              size="sm"
              variant={team}
              className="mt-1 min-h-11"
              onClick={() => void act({ type: 'join-team', team, role: 'spymaster' })}
            >
              Be the Spymaster
            </Button>
          ) : (
            <span className="text-stone-500 italic">Empty</span>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Operatives</p>
          {!compact && (
            <p className="mb-1 text-xs text-stone-600 dark:text-stone-400">
              Guess the words from the clues. Best for a first game.
            </p>
          )}
          <ul className={cn('flex flex-wrap gap-x-3 gap-y-1', compact && 'text-sm')}>
            {operatives.map((s) => (
              <li key={s.id}>
                <Name id={s.id} name={s.name} me={me?.id} online={online(s.id)} hostId={hostId} />
              </li>
            ))}
            {operatives.length === 0 && <li className="text-stone-500 italic">Nobody yet</li>}
          </ul>
          {canJoinOps && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2 min-h-11"
              onClick={() => void act({ type: 'join-team', team, role: 'operative' })}
            >
              Join {TEAM_LABEL[team]} as Operative
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export function Teams(props: Props) {
  const spectators = props.view.seats.filter((s) => s.team === null);
  const me = props.view.me;
  const canSpectate = me?.team != null && props.view.phase !== 'playing';
  return (
    <div className="space-y-3">
      <div className={cn('grid gap-3', props.compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
        <TeamColumn {...props} team="red" />
        <TeamColumn {...props} team="blue" />
      </div>
      {(spectators.length > 0 || canSpectate) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
          <span className="font-semibold">Watching:</span>
          {spectators.map((s) => (
            <Name
              key={s.id}
              id={s.id}
              name={s.name}
              me={me?.id}
              online={props.online(s.id)}
              hostId={props.hostId}
            />
          ))}
          {spectators.length === 0 && <span className="italic">nobody</span>}
          {canSpectate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void props.act({ type: 'join-team', team: null, role: 'operative' })}
            >
              Sit out (watch)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
