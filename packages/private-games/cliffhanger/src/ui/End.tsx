import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import { Button, EndHero, EndTabs, StickyBar, Superlatives, cn, useWideScreen } from '@vt/ui';
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
        // Two across the phone's full width, three in a desktop column: the titles on the labels
        // stay readable at the end, when players look back at what they filled.
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {cards.map((c) => (
            <li key={c.id} title={`${c.title} · ${genreName(names, c.genre, view.settings.deck)}`}>
              <Tape card={c} deck={view.settings.deck} className="w-full" />
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
  const wide = useWideScreen();
  const w = view.winner;
  const goal = view.target;
  const actions = room.isHost ? (
    <StickyBar refusal="cl-end">
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
          Change setup
        </Button>
      </div>
    </StickyBar>
  ) : (
    <p className="text-center text-sm text-ink-muted">
      {waitingForHost(room, 'start another game')}
    </p>
  );
  const ordered = w ? [w, ...TEAMS.filter((t) => t !== w)] : [...TEAMS];
  const won = w ? view.collections[w].slice(-4) : [];
  return (
    <div className="space-y-4">
      <EndHero
        title={
          w
            ? w === view.myTeam
              ? 'Your team wins!'
              : `${teamName(w)} win!`
            : 'No winner this time.'
        }
        titleTestId="winner"
        emblem={won.length ? null : w ? `🏆${TEAM_EMOJI[w]}` : '🎬'}
        // The winners' last tapes: what they filled their shelf with.
        art={
          won.length > 0 && (
            <ul
              aria-label="The winning tapes"
              className="flex flex-wrap justify-center gap-2 lg:gap-3"
            >
              {won.map((c) => (
                <li key={c.id}>
                  <Tape card={c} deck={view.settings.deck} className="h-16 shadow-vt-2 lg:h-24" />
                </li>
              ))}
            </ul>
          )
        }
        // The viewer's team lights the card: ember for a win, danger for a loss, quiet otherwise.
        tone={!w || !view.myTeam ? 'neutral' : w === view.myTeam ? 'win' : 'loss'}
        superlatives={wide ? room.superlatives : undefined}
        actions={actions}
      >
        {w &&
          (view.endReason === 'sudden-death'
            ? 'Decided in sudden death.'
            : `${
                progress(
                  view.collections[w].map((c) => c.genre),
                  goal,
                ).have
              } of ${goal.genres.length * goal.each} filled first.`)}
      </EndHero>
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
          !wide &&
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
    </div>
  );
}
