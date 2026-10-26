import { Button, Modal, ProtectedImage } from '@vt/ui';
import {
  type Card,
  type Rank,
  SUIT_NAME,
  type Suit,
  cardName,
  copiesOf,
  nextRank,
  played,
} from '../logic/cards.ts';
import { critical, dead, optionsOfView } from '../logic/knowledge.ts';
import { CLUE_TOKENS, FUSES, type SkyfireView } from '../logic/types.ts';
import type { Art } from './assets.ts';
import { CardFace, marksText } from './Card.tsx';
import type { NameOf } from './text.ts';

/** What a details sheet is about. */
export type Detail =
  | {
      kind: 'card';
      card: Card;
      holder?: string;
      id?: string;
      where?: 'discards' | 'firework' | 'replay';
    }
  | { kind: 'firework'; suit: Suit }
  | { kind: 'clues' }
  | { kind: 'fuses' }
  | { kind: 'deck' };

const lower = (s: Suit) => SUIT_NAME[s].toLowerCase();

/** Where a card can go: now, later, never, or already done. */
export function whereLine(card: Card, view: SkyfireView): string {
  const g = view.game!;
  const o = optionsOfView(view);
  const h = g.fireworks[card.suit] ?? 0;
  const firework = `the ${lower(card.suit)} firework`;
  if (played(card.suit, card.rank, h))
    return `Already on ${firework}: this copy can only be discarded.`;
  if (dead(card, g, o))
    return `It can never be played: a card ${firework} needs before it is gone for good.`;
  const next = nextRank(card.suit, h);
  if (next === card.rank) return `Playable now: it is the next card of ${firework}.`;
  const order = card.suit === 'black' ? '5 down to 1' : '1 up to 5';
  return `Not yet: ${firework} (built ${order}) needs the ${next} next; it is at ${h} of 5.`;
}

/** Copies of a card: in the deck, gone, on its firework and in sight. */
function copies(card: Card, view: SkyfireView) {
  const g = view.game!;
  const o = optionsOfView(view);
  const same = (c: Card | null | undefined) => !!c && c.suit === card.suit && c.rank === card.rank;
  const total = copiesOf(card.suit, card.rank, o);
  const discarded = g.discards.filter((d) => same(d.card)).length;
  const lit = played(card.suit, card.rank, g.fireworks[card.suit] ?? 0) ? 1 : 0;
  const inSight = g.order.reduce(
    (n, id) => n + (g.hands[id] ?? []).filter((s) => same(s.card)).length,
    0,
  );
  return { total, discarded, lit, inSight, unseen: Math.max(0, total - discarded - lit - inSight) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The site's card sheet: the card large (the full face loads only here), what it is, where it can
 * be played, its copies, and what its holder has been told. Tokens and the deck get their own.
 */
export function DetailSheet({
  detail,
  view,
  art,
  name,
  you,
  canClue,
  onClue,
  onClose,
}: {
  detail: Detail;
  view: SkyfireView;
  art: Art;
  name: NameOf;
  you: string;
  canClue: boolean;
  onClue: (id: string) => void;
  onClose: () => void;
}) {
  const g = view.game!;
  if (detail.kind === 'clues')
    return (
      <Modal open size="sm" onClose={onClose} title={`Clue tokens: ${g.clues} of ${CLUE_TOKENS}`}>
        <div className="flex flex-col gap-2 text-sm">
          {art.clue && <ProtectedImage src={art.clue} alt="" className="mx-auto h-20 w-auto" />}
          <p>
            A clue spends one token. Discarding a card brings one back, and so does finishing a
            firework.
          </p>
          <p>
            With all {CLUE_TOKENS} back you can’t discard; with none left you can’t give a clue.
          </p>
        </div>
      </Modal>
    );
  if (detail.kind === 'fuses')
    return (
      <Modal open size="sm" onClose={onClose} title={`Fuses: ${g.fuses} of ${FUSES} burned`}>
        <div className="flex flex-col gap-2 text-sm">
          {art.fuse(0, false) && (
            <span className="mx-auto flex h-24 items-end">
              {Array.from({ length: FUSES }, (_, i) => (
                <ProtectedImage
                  key={i}
                  src={art.fuse(i, i < g.fuses) ?? ''}
                  alt=""
                  className="h-full w-auto"
                />
              ))}
            </span>
          )}
          <p>A card played where it doesn’t fit burns a fuse and goes to the discards.</p>
          <p>
            {FUSES - g.fuses > 1
              ? `${FUSES - g.fuses} more burn the show at 0.`
              : g.fuses >= FUSES
                ? 'The third fuse burned: the show went up in smoke.'
                : 'One more and the show goes up in smoke, scoring 0.'}
          </p>
        </div>
      </Modal>
    );
  if (detail.kind === 'deck')
    return (
      <Modal open size="sm" onClose={onClose} title={`Deck: ${plural(g.deck, 'card')} left`}>
        <div className="flex flex-col gap-2 text-sm">
          {art.back(false) && (
            <ProtectedImage
              src={art.back(false)!}
              alt=""
              className="mx-auto h-48 w-auto rounded-md"
            />
          )}
          <p>
            {view.settings.expert
              ? 'Expert ending: when the deck runs out play goes on, and hands shrink. Losing a needed last copy, or starting a turn with no cards, loses the show.'
              : 'When someone draws the last card, everyone (them included) has one more turn, then the show ends.'}
          </p>
        </div>
      </Modal>
    );
  if (detail.kind === 'firework') {
    const h = g.fireworks[detail.suit] ?? 0;
    const top = h ? ((detail.suit === 'black' ? 6 - h : h) as Rank) : null;
    const next = nextRank(detail.suit, h);
    return (
      <Modal
        open
        size="sm"
        onClose={onClose}
        title={`${SUIT_NAME[detail.suit]} firework: ${h} of 5`}
      >
        <div className="flex flex-col items-center gap-2 text-sm">
          {top && <Big card={{ suit: detail.suit, rank: top }} art={art} />}
          <p>
            {next === null
              ? 'Finished!'
              : `Next it needs the ${lower(detail.suit)} ${next}${detail.suit === 'black' ? ' (black powder is built 5 down to 1)' : ''}.`}
          </p>
        </div>
      </Modal>
    );
  }
  const { card, holder, id } = detail;
  const c = copies(card, view);
  const o = optionsOfView(view);
  const last = critical(card, g, o) && !dead(card, g, o);
  const slot = holder && id ? g.hands[holder]?.find((s) => s.id === id) : undefined;
  const told = slot?.know ? marksText(slot.know) : '';
  const whose =
    holder && holder !== you
      ? `${name(holder)}’s card`
      : detail.where === 'discards'
        ? 'In the discards'
        : detail.where === 'firework'
          ? 'On its firework'
          : '';
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`${cardName(card)}${whose ? ` · ${whose}` : ''}`}
      footer={
        holder && holder !== you && canClue ? (
          <Button
            size="lg"
            className="w-full"
            onClick={() => onClue(holder)}
            data-testid="sf-detail-clue"
          >
            💡 Give {name(holder)} a clue
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col items-center gap-2 text-sm" data-testid="sf-detail">
        <Big card={card} art={art} />
        <p className="self-stretch">{whereLine(card, view)}</p>
        <p className="self-stretch">
          {plural(c.total, 'copy', 'copies')} in all: {c.discarded} discarded
          {c.lit ? ', 1 on the firework' : ''}, {c.inSight} in the hands you can see, {c.unseen}{' '}
          unseen (in the deck or your own hand).
        </p>
        {last && (
          <p className="self-stretch rounded-lg bg-warn-soft px-2 py-1 font-semibold text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
            ! The last copy still needed: don’t let it go.
          </p>
        )}
        {slot && view.settings.memory !== 'memory' && (
          <p className="self-stretch">
            {told ? `${name(holder)} has been told: ${told}.` : `No clue has touched it yet.`}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** The card as large as the sheet allows: the full face, or the drawn card. */
function Big({ card, art }: { card: Card; art: Art }) {
  const src = art.big(card.suit, card.rank);
  return src ? (
    <ProtectedImage
      src={src}
      alt={cardName(card)}
      className="h-[min(50dvh,22rem)] w-auto rounded-lg shadow"
    />
  ) : (
    <CardFace card={card} art={art} size="hand" className="w-36" />
  );
}
