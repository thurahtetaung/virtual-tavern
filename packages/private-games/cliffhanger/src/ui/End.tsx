import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, EndTabs, RefusalSlot, Superlatives, cn } from '@vt/ui';
import { progress } from '../logic/genres.ts';
import { genreName } from '../logic/manifest.ts';
import {
  type CliffhangerAction,
  type CliffhangerView,
  TEAMS,
  type TeamId,
} from '../logic/types.ts';
import { useArt } from './assets.ts';
import { GenreRace, TEAM_EMOJI, Tape, nameOf, teamName } from './parts.tsx';

type Act = (a: CliffhangerAction, o?: { anchor?: string }) => Promise<boolean>;

/** A team's collection: the tapes it won, by genre. */
function Collection({ view, team }: { view: CliffhangerView; team: TeamId }) {
  const { names } = useArt();
  const cards = view.collections[team];
  const members = view.seats.filter((s) => s.team === team);
  return (
    <section className="space-y-2" data-testid={`collection-${team}`}>
      <GenreRace view={view} team={team} />
      <p className="text-xs text-ink-muted">{members.map((m) => nameOf(view, m.id)).join(', ')}</p>
      {cards.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {cards.map((c) => (
            <li key={c.id} title={`${c.title} · ${genreName(names, c.genre, view.settings.deck)}`}>
              <Tape card={c} deck={view.settings.deck} className="h-28 sm:h-32" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">No tapes this time.</p>
      )}
    </section>
  );
}

/** The game's end: who won and how, both collections, the awards, the log, and play again. */
export function End({ view, room, act }: { view: CliffhangerView; room: GameRoomInfo; act: Act }) {
  const w = view.winner;
  const goal = view.target;
  const headline = w ? (
    <div className="cl-pop space-y-1 text-center" data-testid="winner">
      <p className="text-5xl" aria-hidden>
        🏆{TEAM_EMOJI[w]}
      </p>
      <p className="text-2xl font-black">
        {w === view.myTeam ? 'Your team wins!' : `${teamName(w)} win!`}
      </p>
      <p className="text-sm text-ink-muted">
        {view.endReason === 'sudden-death'
          ? 'Decided in sudden death.'
          : `${
              progress(
                view.collections[w].map((c) => c.genre),
                goal,
              ).have
            } of ${goal.genres.length * goal.each} filled first.`}
      </p>
    </div>
  ) : (
    <p className="text-center text-lg font-semibold" data-testid="winner">
      No winner this time.
    </p>
  );
  const ordered = w ? [w, ...TEAMS.filter((t) => t !== w)] : [...TEAMS];
  return (
    <div className="space-y-4">
      {headline}
      <EndTabs
        tabs={[
          {
            id: 'tapes',
            label: '📼 Tapes',
            content: (
              <div className="grid gap-4 lg:grid-cols-2">
                {ordered.map((t) => (
                  <Collection key={t} view={view} team={t} />
                ))}
              </div>
            ),
          },
          !!room.superlatives?.length && {
            id: 'awards',
            label: '🏅 Awards',
            content: <Superlatives lines={room.superlatives} />,
          },
          !!view.log.length && {
            id: 'log',
            label: '📜 Story',
            content: (
              <ol className="space-y-1 text-sm" data-testid="end-log">
                {view.log.map((e, i) => (
                  <li key={i} className={cn(i > 0 && view.log[i - 1]!.round !== e.round && 'pt-2')}>
                    <span className="mr-2 text-xs text-ink-muted tabular-nums">R{e.round}</span>
                    {e.text}
                  </li>
                ))}
              </ol>
            ),
          },
        ]}
      />
      {room.isHost ? (
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            size="lg"
            data-testid="play-again"
            onClick={() => void act({ type: 'start' }, { anchor: 'cl-end' })}
          >
            Play again
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'cl-end' })}
          >
            Change teams or settings
          </Button>
          <RefusalSlot anchor="cl-end" />
        </div>
      ) : (
        <p className="text-center text-sm text-ink-muted">The host can start another game.</p>
      )}
    </div>
  );
}
