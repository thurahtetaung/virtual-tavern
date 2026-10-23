import { Panel, cn } from '@vt/ui';
import { PILLARS, type Pillar } from '../logic/cards.ts';
import type { GameView, PsychicView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Avatar, Card } from './Card.tsx';
import { type LookCard, useLook } from './Look.tsx';
import { atTable } from './status.ts';

/** Psychics still looking for a card of this pillar (the ghost knows their targets). */
export const searchingFor = (g: GameView, pillar: Pillar) =>
  atTable(g).filter((p) => !p.gone && PILLARS[p.step] === pillar && p.targets);

/** The cards a psychic has already guessed wrong for their current pillar. */
export const missedBy = (g: GameView, p: PsychicView) =>
  g.verdicts
    .filter((v) => v.color === p.color && v.step === p.step && !v.correct && v.guess !== null)
    .map((v) => v.guess!);

/** What each candidate is to the psychics it concerns: whose target, whose guess, whose miss. */
export function candidateMarks(g: GameView, pillar: Pillar, psychics: readonly PsychicView[]) {
  return (card: number) => ({
    targetOf: psychics.filter((p) => p.targets?.[p.step] === card),
    guessedBy: psychics.filter((p) => p.intuition === card),
    missedBy: psychics.filter((p) => missedBy(g, p).includes(card)),
  });
}

/** The note on a candidate: what it is to whom ("Ana’s target", "Ben’s guess"). */
export function candidateNote(
  marks: ReturnType<ReturnType<typeof candidateMarks>>,
  one?: PsychicView,
): string | undefined {
  const names = (list: readonly PsychicView[]) => list.map((p) => p.name).join(' and ');
  const parts = one
    ? [
        marks.targetOf.includes(one) && `${one.name}’s target`,
        marks.guessedBy.includes(one) && `${one.name}’s guess`,
        marks.missedBy.includes(one) && `${one.name} guessed it wrong before`,
      ]
    : [
        marks.targetOf.length > 0 && `${names(marks.targetOf)}’s target`,
        marks.guessedBy.length > 0 && `${names(marks.guessedBy)}’s guess`,
        marks.missedBy.length > 0 && `${names(marks.missedBy)} guessed it wrong before`,
      ];
  const text = parts.filter(Boolean).join(' · ');
  return text || undefined;
}

/**
 * Every candidate card of one pillar, as the psychics see them on the table. With `one`, it is that
 * psychic's row (their target lit, their guess and past misses marked); without, it marks every
 * psychic looking for this pillar. Any card opens in the viewer, swiping along the row.
 */
export function CandidatesRow({
  g,
  pillar,
  content,
  one,
  label,
  small,
}: {
  g: GameView;
  pillar: Pillar;
  content: Content;
  one?: PsychicView;
  label: string;
  small?: boolean;
}) {
  const { look, viewer } = useLook(content);
  const kind = content.kindOf(pillar);
  const cards = g.table[pillar];
  const marksOf = candidateMarks(g, pillar, one ? [one] : searchingFor(g, pillar));
  const row = cards.map((n): LookCard => ({ kind, n, caption: candidateNote(marksOf(n), one) }));
  return (
    <>
      {viewer}
      <ul
        aria-label={label}
        className={cn(
          'grid gap-1.5',
          small ? 'grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]' : 'grid-cols-3 sm:grid-cols-4',
        )}
      >
        {cards.map((n, i) => {
          const marks = marksOf(n);
          const target = marks.targetOf.length > 0;
          return (
            <li key={n}>
              <Card
                kind={kind}
                n={n}
                content={content}
                note={candidateNote(marks, one) ?? 'candidate'}
                onTap={() => look(row, i, label)}
                className={cn(
                  target && 'ring-4 ring-accent dark:ring-amber-400',
                  !target && marks.missedBy.length > 0 && 'opacity-60',
                )}
              >
                {target &&
                  (one ? (
                    <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[10px] font-bold text-white uppercase">
                      Target
                    </span>
                  ) : (
                    <span className="absolute top-1 left-1 flex -space-x-1.5" aria-hidden>
                      {marks.targetOf.map((p) => (
                        <Avatar
                          key={p.color}
                          color={p.color}
                          content={content}
                          name={p.name}
                          size="sm"
                        />
                      ))}
                    </span>
                  ))}
                {marks.guessedBy.length > 0 && (
                  <span className="absolute right-1 bottom-1 flex items-center gap-0.5 rounded-full bg-black/70 py-0.5 pr-1.5 pl-0.5 text-[10px] font-bold text-white">
                    <span className="flex -space-x-1.5">
                      {marks.guessedBy.map((p) => (
                        <Avatar
                          key={p.color}
                          color={p.color}
                          content={content}
                          name={p.name}
                          size="sm"
                          className="size-5"
                        />
                      ))}
                    </span>
                    guess
                  </span>
                )}
                {marks.missedBy.length > 0 && (
                  <span className="absolute top-1 right-1 rounded-full bg-danger px-1.5 text-xs font-bold text-white dark:bg-rose-600">
                    ✗
                  </span>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Desktop only: one row per pillar the psychics are looking for, every candidate marked. */
export function TableOverview({ g, content }: { g: GameView; content: Content }) {
  const pillars = PILLARS.filter((pl) => searchingFor(g, pl).length > 0);
  if (!pillars.length) return null;
  return (
    <Panel
      role="region"
      aria-label="Candidates on the table"
      className="hidden space-y-2 p-3 lg:block"
    >
      {pillars.map((pl) => {
        const who = searchingFor(g, pl);
        return (
          <div key={pl} className="space-y-1">
            <h3 className="text-sm font-semibold">
              {content.pillarPlural(pl)} on the table{' '}
              <span className="font-normal text-ink-muted">
                · {who.map((p) => p.name).join(', ')} {who.length === 1 ? 'is' : 'are'} looking
              </span>
            </h3>
            <CandidatesRow
              g={g}
              pillar={pl}
              content={content}
              label={`${content.pillarPlural(pl)} on the table`}
              small
            />
          </div>
        );
      })}
    </Panel>
  );
}
