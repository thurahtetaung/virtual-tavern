import type { ReactNode } from 'react';
import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  EndHero,
  EndLayout,
  EndTabs,
  Panel,
  StickyBar,
  Superlatives,
  cn,
  useWideScreen,
} from '@vt/ui';
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
        // Two across the phone's full width, three in a desktop column, each title also in plain
        // type under its tape, so it reads at the site's size when players look back.
        <ul className="grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-3">
          {cards.map((c) => (
            <li key={c.id} title={`${c.title} · ${genreName(names, c.genre, view.settings.deck)}`}>
              <Tape card={c} deck={view.settings.deck} className="w-full" />
              <p aria-hidden className="mt-1 truncate text-center text-caption text-ink-2">
                {c.title}
              </p>
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
export function End({
  view,
  room,
  act,
  board,
}: {
  view: CliffhangerView;
  room: GameRoomInfo;
  act: Act;
  board?: ReactNode;
}) {
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
      <EndLayout
        hero={
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
                // One row on phones (so the end's tabs keep the height), each title in plain type
                // under its tape.
                <ul
                  aria-label="The winning tapes"
                  className="flex flex-wrap justify-center gap-1.5 lg:gap-3"
                >
                  {won.map((c) => (
                    <li key={c.id} className="w-[4.5rem] lg:w-[8.25rem]">
                      <Tape card={c} deck={view.settings.deck} className="w-full shadow-vt-2" />
                      <p
                        aria-hidden
                        className="mt-1 line-clamp-2 text-caption leading-tight text-ink-2"
                      >
                        {c.title}
                      </p>
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
        }
      >
        <Panel>
          <EndTabs
            tabs={[
              // Wide screens show both shelves side by side; phones give each team its own tab
              // (the winners first), so a shelf is a short scroll, not both at once.
              ...(wide
                ? [
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
                  ]
                : ordered.map((t) => ({
                    id: `tapes-${t}`,
                    label: `${TEAM_EMOJI[t]} ${teamName(t)}`,
                    content: <Collection view={view} team={t} />,
                  }))),
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
                      <li
                        key={i}
                        className={cn(i > 0 && view.log[i - 1]!.round !== e.round && 'pt-2')}
                      >
                        <span className="mr-2 text-xs text-ink-muted tabular-nums">R{e.round}</span>
                        {e.text}
                      </li>
                    ))}
                  </ol>
                ),
              },
              !!board && { id: 'board', label: '🎞️ Board', content: board },
            ]}
          />
        </Panel>
      </EndLayout>
    </div>
  );
}
