import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Panel, Superlatives, cn } from '@vt/ui';
import { PILLARS } from '../logic/cards.ts';
import type { SeanceAction, SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Avatar, Card } from './Card.tsx';
import { Lineup, SharedRow } from './Final.tsx';
import { type LookCard, useLook } from './Look.tsx';
import { psychicByColor, resultLine, roman } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

/** "What the ghost meant": each psychic's three cards with the visions that pointed to them. */
function GhostMeant({ view, content }: { view: SeanceView; content: Content }) {
  const g = view.game!;
  const { look, viewer } = useLook(content);
  return (
    <section aria-label="What the ghost meant" className="space-y-3">
      {viewer}
      <h3 className="font-bold">👻 What the ghost meant</h3>
      {g.psychics.map((p) => (
        <div key={p.color} className="space-y-1.5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Avatar color={p.color} content={content} name={p.name} size="sm" />
            {p.name}
            {p.retired && <span className="font-normal text-ink-muted">· seat retired</span>}
            {p.finishedHour !== null && (
              <span className="font-normal text-ink-muted">
                · all three by hour {roman(p.finishedHour)}
              </span>
            )}
          </p>
          <ul className="space-y-1.5">
            {PILLARS.map((pillar, step) => {
              const target = p.targets?.[step];
              if (target === undefined) return null;
              const visions = g.sends
                .filter((s) => s.to === p.color && s.step === step)
                .flatMap((s) => s.cards);
              const found = p.found[step] !== undefined;
              const row: LookCard[] = [
                {
                  kind: pillar,
                  n: target,
                  caption: `${p.name}’s ${content.pillarName(pillar).toLowerCase()} (${found ? 'found' : 'not found'})`,
                },
                ...visions.map((v, i): LookCard => ({
                  kind: 'vision',
                  n: v,
                  caption: `Vision ${i + 1} of ${visions.length} for it`,
                })),
              ];
              const open = (i: number) =>
                look(row, i, `${p.name}’s ${content.pillarName(pillar).toLowerCase()}`);
              return (
                <li key={pillar} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
                  <Card
                    kind={pillar}
                    n={target}
                    content={content}
                    dimmed={!found}
                    note={found ? 'found' : 'not found'}
                    onTap={() => open(0)}
                  />
                  <div
                    tabIndex={0}
                    role="group"
                    aria-label={`Visions for ${p.name}’s ${content.pillarName(pillar).toLowerCase()}`}
                    className="flex gap-1 overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500"
                  >
                    {visions.length ? (
                      visions.map((v, i) => (
                        <div key={`${v}-${i}`} className="w-12 shrink-0 sm:w-16">
                          <Card kind="vision" n={v} content={content} onTap={() => open(i + 1)} />
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-ink-muted">no vision</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function EndScreen({
  view,
  room,
  act,
  content,
}: {
  view: SeanceView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
}) {
  const g = view.game!;
  const r = g.result!;
  const breaker = r.tieBreaker ? psychicByColor(g, r.tieBreaker) : null;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Panel
        className={cn(
          'space-y-2 text-center',
          r.win
            ? 'bg-special-soft ring-special-line dark:ring-violet-300 dark:bg-violet-500/10'
            : 'bg-stone-100 dark:bg-stone-900',
        )}
      >
        <p className="text-4xl" aria-hidden>
          {r.win ? '🕊️' : '🌫️'}
        </p>
        <h2 className="text-xl font-bold">
          {r.win ? 'The ghost is at peace' : 'The ghost wanders on'}
        </h2>
        <p role="status">{resultLine(g)}</p>
        {breaker && (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            The vote was tied: {breaker.name}, furthest along the track, decided it.
          </p>
        )}
        <Superlatives lines={room.superlatives} />
        {room.isHost && (
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Button size="lg" onClick={() => void act({ type: 'play-again' })}>
              Play again
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => void act({ type: 'back-to-lobby' })}
            >
              Change setup
            </Button>
          </div>
        )}
      </Panel>
      {g.final && g.final.sharedCount > 0 && (
        <Panel className="space-y-3 p-3">
          <SharedRow g={g} content={content} tags />
          <Lineup view={view} act={act} content={content} />
        </Panel>
      )}
      <Panel className="p-3">
        <GhostMeant view={view} content={content} />
      </Panel>
    </div>
  );
}
