import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import { Button, Panel, Superlatives, cn } from '@vt/ui';
import { useState } from 'react';
import { PILLARS } from '../logic/cards.ts';
import type { SeanceAction, SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Avatar, Card } from './Card.tsx';
import { Lineup, SharedRow } from './Final.tsx';
import { type LookCard, useLook } from './Look.tsx';
import { psychicByColor, resultLine, roman } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

/**
 * "What the ghost meant": each psychic's three cards with the visions that pointed to them (each
 * with its hour) and the wrong guesses greyed out. One psychic at a time on phones.
 */
function GhostMeant({ view, content }: { view: SeanceView; content: Content }) {
  const g = view.game!;
  const { look, viewer } = useLook(content);
  const [open, setOpen] = useState<string[]>([]);
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
              className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left text-sm font-semibold hover:bg-line/40 focus-visible:outline-2 focus-visible:outline-accent lg:pointer-events-none lg:min-h-0 dark:hover:bg-stone-800 dark:focus-visible:outline-amber-500"
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
              <span aria-hidden className="text-ink-muted lg:hidden">
                {expanded ? '▴' : '▾'}
              </span>
            </button>
            <ul className={cn('space-y-1.5', !expanded && 'hidden lg:block')}>
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
                    className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2"
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
                      className="flex items-end gap-1 overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500"
                    >
                      {visions.length ? (
                        visions.map((v, i) => (
                          <div key={`${v.card}-${i}`} className="w-12 shrink-0 space-y-0.5 sm:w-16">
                            <Card
                              kind="vision"
                              n={v.card}
                              content={content}
                              note={`hour ${roman(v.hour)}`}
                              onTap={() => open(i + 1)}
                            />
                            <p className="text-center text-[10px] leading-none text-ink-muted">
                              {roman(v.hour)}
                            </p>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-ink-muted">no vision</span>
                      )}
                      {misses.map((v, i) => (
                        <div
                          key={`miss-${v.hour}`}
                          className={cn('w-16 shrink-0 space-y-0.5 sm:w-20', i === 0 && 'ml-2')}
                        >
                          <Card
                            kind={content.kindOf(pillar)}
                            n={v.guess!}
                            content={content}
                            dimmed
                            note={`wrong guess, hour ${roman(v.hour)}`}
                            onTap={() => open(1 + visions.length + i)}
                          />
                          <p className="text-center text-[10px] leading-none text-ink-muted">
                            ✗ {roman(v.hour)}
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
        {!room.isHost && (
          <p className="text-sm text-ink-muted">{waitingForHost(room, 'start another game')}</p>
        )}
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
