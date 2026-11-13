import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  EndHero,
  EndLayout,
  EndTabs,
  Panel,
  Superlatives,
  cn,
  useWideScreen,
} from '@vt/ui';
import { useState } from 'react';
import { PILLARS } from '../logic/cards.ts';
import type { SeanceAction, SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Avatar, Card } from './Card.tsx';
import { Lineup, SharedRow } from './Final.tsx';
import { type LookCard, useLook } from './Look.tsx';
import { myPsychic, psychicByColor, resultLine, roman } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

/**
 * "What the ghost meant": each psychic's three cards with the visions that pointed to them (each
 * with its hour) and the wrong guesses greyed out. Each psychic folds open on a tap; it starts
 * with your own psychic (or the first) open, so the ghost's cards show at once.
 */
function GhostMeant({ view, content }: { view: SeanceView; content: Content }) {
  const g = view.game!;
  const { look, viewer } = useLook(content);
  const mine = myPsychic(view)?.color ?? g.psychics[0]?.color;
  const [open, setOpen] = useState<string[]>(() => (mine ? [mine] : []));
  return (
    <section aria-label="What the ghost meant" className="space-y-3">
      {viewer}
      <h3 className="font-bold">👻 What the ghost meant</h3>
      {g.psychics.map((p) => {
        const expanded = open.includes(p.color);
        return (
          <div key={p.color} className="space-y-1.5">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() =>
                setOpen(expanded ? open.filter((c) => c !== p.color) : [...open, p.color])
              }
              className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left text-sm font-semibold hover:bg-line/40 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Avatar color={p.color} content={content} name={p.name} size="sm" />
              <span className="min-w-0 flex-1">
                {p.name}
                {p.retired && <span className="font-normal text-ink-muted"> · seat retired</span>}
                {p.finishedHour !== null && (
                  <span className="font-normal text-ink-muted">
                    {' '}
                    · all three by hour {roman(p.finishedHour)}
                  </span>
                )}
              </span>
              <span aria-hidden className="text-ink-muted">
                {expanded ? '▴' : '▾'}
              </span>
            </button>
            <ul className={cn('space-y-1.5', !expanded && 'hidden')}>
              {PILLARS.map((pillar, step) => {
                const target = p.targets?.[step];
                if (target === undefined) return null;
                const word = content.pillarName(pillar).toLowerCase();
                const visions = g.sends
                  .filter((s) => s.to === p.color && s.step === step)
                  .flatMap((s) => s.cards.map((card) => ({ card, hour: s.hour })));
                const misses = g.verdicts.filter(
                  (v) => v.color === p.color && v.step === step && !v.correct && v.guess !== null,
                );
                const found = p.found[step] !== undefined;
                const row: LookCard[] = [
                  {
                    kind: content.kindOf(pillar),
                    n: target,
                    caption: `${p.name}’s ${word} (${found ? 'found' : 'not found'})`,
                  },
                  ...visions.map((v, i): LookCard => ({
                    kind: 'vision',
                    n: v.card,
                    caption: `Vision ${i + 1} of ${visions.length} for it · hour ${roman(v.hour)}`,
                  })),
                  ...misses.map((v): LookCard => ({
                    kind: content.kindOf(pillar),
                    n: v.guess!,
                    caption: `${p.name}’s wrong guess · hour ${roman(v.hour)}`,
                  })),
                ];
                const open = (i: number) => look(row, i, `${p.name}’s ${word}`);
                return (
                  <li
                    key={pillar}
                    className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 lg:grid-cols-[8rem_minmax(0,1fr)] lg:gap-3"
                  >
                    <Card
                      kind={content.kindOf(pillar)}
                      n={target}
                      content={content}
                      dimmed={!found}
                      note={found ? 'found' : 'not found'}
                      onTap={() => open(0)}
                    />
                    <div
                      tabIndex={0}
                      role="group"
                      aria-label={`Visions for ${p.name}’s ${word}`}
                      className="flex items-end gap-1 overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    >
                      {visions.length ? (
                        visions.map((v, i) => (
                          <div
                            key={`${v.card}-${i}`}
                            className="w-14 shrink-0 space-y-0.5 sm:w-20 lg:w-24"
                          >
                            <Card
                              kind="vision"
                              n={v.card}
                              content={content}
                              note={`hour ${roman(v.hour)}`}
                              onTap={() => open(i + 1)}
                            />
                            <p className="text-center text-xs leading-none text-ink-2">
                              hour {roman(v.hour)}
                            </p>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-ink-muted">no vision</span>
                      )}
                      {misses.map((v, i) => (
                        <div
                          key={`miss-${v.hour}`}
                          className={cn(
                            'w-16 shrink-0 space-y-0.5 sm:w-20 lg:w-24',
                            i === 0 && 'ml-2',
                          )}
                        >
                          <Card
                            kind={content.kindOf(pillar)}
                            n={v.guess!}
                            content={content}
                            dimmed
                            note={`wrong guess, hour ${roman(v.hour)}`}
                            onTap={() => open(1 + visions.length + i)}
                          />
                          <p className="text-center text-xs leading-none text-ink-2">
                            miss, hour {roman(v.hour)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
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
  const wide = useWideScreen();
  const shared = g.final && g.final.sharedCount > 0 && (
    <Panel className="space-y-3 p-3">
      <SharedRow g={g} content={content} tags />
      <Lineup view={view} act={act} content={content} />
    </Panel>
  );
  const meant = (
    <Panel className="p-3">
      <GhostMeant view={view} content={content} />
    </Panel>
  );
  // The shared vision, the final's three cards, in the finale.
  const visions = g.final?.shared ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-3 lg:max-w-6xl">
      <EndLayout
        hero={
          <EndHero
            // Wide screens: the shared vision under the result (phones open the ghost's cards below).
            art={
              wide &&
              visions.map((n, i) => (
                <div key={i} className="w-16 sm:w-20 lg:w-28">
                  <Card kind="vision" n={n} content={content} note={`shared card ${i + 1}`} />
                </div>
              ))
            }
            tone={r.win ? 'success' : 'loss'}
            emblem={r.win ? '🕊️' : '🌫️'}
            title={r.win ? 'The ghost is at peace' : 'The ghost wanders on'}
            superlatives={wide ? room.superlatives : undefined}
            actions={
              room.isHost ? (
                <div className="flex flex-wrap justify-center gap-2">
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
              ) : (
                <p className="text-small text-ink-muted">
                  {waitingForHost(room, 'start another game')}
                </p>
              )
            }
          >
            <p role="status">{resultLine(g)}</p>
            {breaker && (
              <p className="mt-1 text-ink-muted">
                The vote was tied: {breaker.name}, furthest along the track, decided it.
              </p>
            )}
          </EndHero>
        }
      >
        {wide ? (
          // Desktops: the final and what the ghost meant beside the finale.
          <div className="space-y-3">
            {shared}
            {meant}
          </div>
        ) : (
          // Phones: the awards, the final line-up and what the ghost meant one at a time, so the
          // end fits the screen.
          <EndTabs
            tabs={[
              !!room.superlatives?.length && {
                id: 'awards',
                label: '✨ Awards',
                content: <Superlatives lines={room.superlatives} />,
              },
              !!shared && { id: 'final', label: '🗳️ The final', content: shared },
              { id: 'meant', label: '👻 What it meant', content: meant },
            ]}
          />
        )}
      </EndLayout>
    </div>
  );
}
