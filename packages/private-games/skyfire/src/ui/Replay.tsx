import { Button, cn } from '@vt/ui';
import { useState } from 'react';
import { SUIT_SYMBOL, type Suit, cardName } from '../logic/cards.ts';
import { CLUE_TOKENS, FUSES, type SkyfireView, type TurnRecord } from '../logic/types.ts';
import { type Detail, DetailSheet } from './Details.tsx';
import type { Art } from './assets.ts';
import { CardFace } from './Card.tsx';
import { type NameOf, clueText } from './text.ts';

/** One turn of the replay, in words. */
function turnText(
  t: TurnRecord,
  cards: NonNullable<NonNullable<SkyfireView['game']>['replay']>,
  name: NameOf,
): string {
  const auto = t.auto ? ' (made by the app)' : '';
  const to = name(t.to) === 'You' ? 'you' : name(t.to);
  if (t.kind === 'clue')
    return `${name(t.by)} told ${to}: ${clueText(t)}, ${t.touched?.length ? `${t.touched.length} ${t.touched.length === 1 ? 'card' : 'cards'}` : 'none'}${auto}.`;
  const c = t.card ? cards.cards[t.card] : undefined;
  const what = c ? cardName(c) : 'a card';
  if (t.kind === 'discard') return `${name(t.by)} discarded ${what}${auto}.`;
  return t.ok
    ? `${name(t.by)} played ${what}${auto}.`
    : `${name(t.by)} played ${what}: a fuse burned${auto}.`;
}

/**
 * The shared end replay: every turn, with every hand face up (your own at last), the fireworks and
 * the tokens as they were. Each viewer steps through it on their own screen.
 */
export function Replay({
  view,
  you,
  art,
  name,
}: {
  view: SkyfireView;
  you: string;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  const r = g.replay;
  const [step, setStep] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  if (!r) return null;
  const total = r.turns.length;
  const at = Math.min(step, total);
  const turn = at > 0 ? r.turns[at - 1]! : null;
  // The table before this turn's move, so its card is still in hand.
  const before = at > 1 ? r.turns[at - 2]!.after : r.start;
  const after = turn ? turn.after : r.start;
  const hands = turn ? before.hands : r.start.hands;
  const touched = new Set(turn?.touched ?? []);
  return (
    <section className="flex flex-col gap-2" aria-label="Replay" data-testid="sf-replay">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Replay</h3>
        <span className="text-xs text-ink-muted tabular-nums dark:text-stone-400">
          {at === 0 ? 'The deal' : `Turn ${at} of ${total}`}
        </span>
      </div>
      <p className="min-h-10 text-sm" aria-live="polite" data-testid="sf-replay-turn">
        {turn
          ? turnText(turn, r, name)
          : 'Everyone’s hand as dealt. Step through to see each turn.'}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
        <span>
          💡 {after.clues}/{CLUE_TOKENS}
        </span>
        <span>
          🧨 {after.fuses}/{FUSES}
        </span>
        <span>🂠 {after.deck}</span>
        <span className="flex flex-wrap gap-1.5">
          {(Object.entries(after.fireworks) as [Suit, number][]).map(([suit, h]) => (
            <span key={suit}>
              {SUIT_SYMBOL[suit]}
              {h}
            </span>
          ))}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {g.order.map((id) => (
          <li
            key={id}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]"
          >
            <span className={cn('truncate', turn?.by === id && 'font-semibold')}>
              {turn?.by === id && '▸ '}
              {name(id)}
            </span>
            <span
              className="grid gap-1"
              style={{ gridTemplateColumns: 'repeat(5, minmax(0, 2.5rem))' }}
            >
              {(hands[id] ?? []).map((cid) => {
                const c = r.cards[cid];
                if (!c) return null;
                const acted = turn?.card === cid;
                return (
                  <button
                    key={cid}
                    type="button"
                    onClick={() => setDetail({ kind: 'card', card: c, where: 'replay' })}
                    aria-label={`${name(id)}: ${cardName(c)}`}
                  >
                    <CardFace
                      card={c}
                      art={art}
                      size="row"
                      className={cn(
                        (acted || touched.has(cid)) && 'ring-[3px] ring-accent dark:ring-amber-400',
                        acted &&
                          !turn?.ok &&
                          turn?.kind === 'play' &&
                          'ring-danger-ink dark:ring-red-400',
                      )}
                    />
                  </button>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
      {detail && (
        <DetailSheet
          detail={detail}
          view={view}
          art={art}
          name={name}
          you={you}
          canClue={false}
          onClue={() => undefined}
          onClose={() => setDetail(null)}
        />
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={at === 0}
          onClick={() => setStep(0)}
          aria-label="Back to the deal"
        >
          ⏮
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={at === 0}
          onClick={() => setStep(at - 1)}
          data-testid="sf-replay-back"
        >
          ◀ Back
        </Button>
        <input
          type="range"
          min={0}
          max={total}
          value={at}
          onChange={(e) => setStep(Number(e.target.value))}
          className="min-w-0 flex-1 accent-accent"
          aria-label="Turn"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={at === total}
          onClick={() => setStep(at + 1)}
          data-testid="sf-replay-next"
        >
          Next ▶
        </Button>
      </div>
    </section>
  );
}
