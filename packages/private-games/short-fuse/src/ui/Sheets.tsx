import { Button, Modal, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import { CARDS, type CardType, isCat } from '../logic/cards.ts';
import type { Art, CardView, Memory, Prompt, ShortFuseAction } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CardBack, CardFace } from './Card.tsx';
import { sortHand } from './Hand.tsx';
import { an } from './text.ts';
import { StackSide } from './Pile.tsx';

type Act = (a: ShortFuseAction, o?: { anchor?: string }) => Promise<boolean>;

/**
 * A decision only the viewer can make (and must): a bottom sheet on phones, a centred card on
 * wider screens. Unlike a dialog it can't be dismissed, and it never covers the Nope panel (no
 * window is open while one shows).
 */
function Sheet({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sf-sheet flex max-h-[88dvh] w-full flex-col rounded-t-2xl bg-panel text-ink shadow-2xl ring-1 ring-line sm:w-[min(40rem,calc(100vw-2rem))] sm:rounded-2xl"
      >
        <h2 className="border-b border-line px-4 py-2.5 text-lg font-bold">{title}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        <div className="border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      </section>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** Most edges the placement stack draws; a taller pile is compressed. */
const PLACE_EDGES = 48;

/**
 * Hiding a Bomb (or putting the Black Hole back): the pile from the side with a gap where the
 * card will slide in, quick picks and a stepper. Nobody else sees any of it.
 */
export function PlaceSheet({
  prompt,
  c,
  art,
  act,
}: {
  prompt: Extract<Prompt, { kind: 'place' }>;
  c: Content;
  art: Art;
  act: Act;
}) {
  const count = prompt.count;
  const [pos, setPos] = useState(0);
  const edges = Math.min(count, PLACE_EDGES);
  const gapEdge = count <= PLACE_EDGES ? pos : Math.round((pos * edges) / Math.max(1, count));
  const go = (p: number) => setPos(Math.max(0, Math.min(count, p)));
  const where =
    pos === 0 ? 'On top' : pos === count ? 'At the bottom' : `${ordinal(pos + 1)} from the top`;
  // Short piles offer each spot once (the bottom of a one-card pile is its 2nd spot).
  const quick = (
    [
      ['Top', 0],
      ['2nd', 1],
      ['3rd', 2],
      ['Bottom', count],
    ] as [string, number][]
  ).filter(([label, p]) => (label === 'Bottom' ? count > 0 : p === 0 || p < count));
  return (
    <Sheet
      title={
        prompt.bury
          ? `Bury ${c.name(prompt.card.t)}`
          : prompt.void
            ? c.t('Put {c:void} back, face up')
            : c.t('Hide {c:bomb}')
      }
      footer={
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            className="w-full"
            onClick={() => void act({ type: 'place', position: pos }, { anchor: 'place' })}
            data-testid="place-confirm"
          >
            {prompt.void || prompt.bury ? 'Put it back here' : 'Hide it here'}
          </Button>
          <RefusalSlot anchor="place" />
        </div>
      }
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
        <div className="flex w-24 flex-col items-center gap-1">
          <CardFace card={prompt.card} art={art} c={c} size="sm" className="sf-slide" />
          <span className="text-[0.65rem] text-ink-muted">top</span>
          <span className="w-20" key={pos}>
            <StackSide edges={edges} voidEdge={null} gap={gapEdge} />
          </span>
          <span className="text-[0.65rem] text-ink-muted">bottom</span>
        </div>
        <div className="space-y-3">
          <p className="text-sm text-ink">
            {prompt.bury
              ? `You drew ${an(c.name(prompt.card.t))}. Put it back anywhere: only you will know where.`
              : prompt.void
                ? c.t(
                    'Everyone will see {c:void} in the side of the pile from now on, but only you know exactly where you put it.',
                  )
                : 'Only you will know where it is. On top means the next player draws it.'}
          </p>
          <p className="text-lg font-bold text-ink" aria-live="polite" data-testid="place-where">
            {where}
            <span className="block text-sm font-normal text-ink-muted">
              position {pos + 1} of {count + 1}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {quick.map(([label, p]) => (
              <button
                key={label}
                type="button"
                aria-pressed={pos === p}
                onClick={() => go(p)}
                data-testid={`place-${label.toLowerCase()}`}
                className={cn(
                  'min-h-9 rounded-lg px-3 text-sm font-semibold ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  pos === p
                    ? 'bg-accent text-accent-fg ring-accent'
                    : 'bg-card text-ink ring-line-strong [@media(hover:hover)]:hover:bg-panel',
                )}
              >
                {label}
              </button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => go(Math.floor(Math.random() * (count + 1)))}
            >
              🎲 Random
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              aria-label="Higher up"
              onClick={() => go(pos - 1)}
            >
              ▲
            </Button>
            <input
              type="range"
              min={0}
              max={count}
              value={pos}
              onChange={(e) => go(Number(e.target.value))}
              aria-label="Position in the pile"
              className="min-w-0 flex-1 accent-[var(--color-accent)]"
            />
            <Button
              variant="secondary"
              size="icon"
              aria-label="Further down"
              onClick={() => go(pos + 1)}
            >
              ▼
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/** Rearranging the top of the pile: move cards up and down, then done. */
export function AlterSheet({
  prompt,
  c,
  art,
  act,
  shareWith,
}: {
  prompt: Extract<Prompt, { kind: 'alter' }>;
  c: Content;
  art: Art;
  act: Act;
  /** Share: the name of the player who sees the cards next. */
  shareWith?: string | null;
}) {
  const [order, setOrder] = useState(() => prompt.cards.map((_, i) => i));
  const move = (at: number, by: -1 | 1) =>
    setOrder((o) => {
      const to = at + by;
      if (to < 0 || to >= o.length) return o;
      const next = [...o];
      [next[at], next[to]] = [next[to]!, next[at]!];
      return next;
    });
  return (
    <Sheet
      title={c.t('Rearrange the top of the pile')}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            className="w-full"
            onClick={() => void act({ type: 'order', order }, { anchor: 'order' })}
            data-testid="order-confirm"
          >
            Done
          </Button>
          <RefusalSlot anchor="order" />
        </div>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        Top of the pile first.{' '}
        {shareWith ? (
          <b className="text-ink">{shareWith} will see them too, in the order you leave them.</b>
        ) : (
          'Nobody else sees these.'
        )}
      </p>
      <ol className="space-y-2">
        {order.map((i, at) => (
          <li
            key={prompt.cards[i]!.id}
            className="flex items-center gap-3 rounded-xl bg-panel p-2 ring-1 ring-line"
          >
            <span className="w-10 text-center text-xs font-bold text-ink-muted">
              {at === 0 ? 'Top' : ordinal(at + 1)}
            </span>
            <CardFace card={prompt.cards[i]!} art={art} c={c} size="sm" />
            <span className="min-w-0 flex-1 truncate font-semibold text-ink">
              {c.name(prompt.cards[i]!.t)}
            </span>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Move up"
              disabled={at === 0}
              onClick={() => move(at, -1)}
            >
              ▲
            </Button>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Move down"
              disabled={at === order.length - 1}
              onClick={() => move(at, 1)}
            >
              ▼
            </Button>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

/** A card-picking sheet: giving one away (a Favor) or taking one from the discard pile. */
export function PickSheet({
  title,
  intro,
  cards,
  c,
  art,
  confirmLabel,
  warn,
  onPick,
  anchor,
}: {
  title: string;
  intro: string;
  cards: CardView[];
  c: Content;
  art: Art;
  confirmLabel: (card: CardView) => string;
  /** A second thought before giving away something precious. */
  warn?: (card: CardView) => string | null;
  onPick: (card: CardView) => void;
  anchor: string;
}) {
  const [picked, setPicked] = useState<CardView | null>(null);
  const caution = picked && warn ? warn(picked) : null;
  return (
    <Sheet
      title={title}
      footer={
        <div className="flex flex-col gap-2">
          {caution && <p className="text-sm font-semibold text-danger-ink">{caution}</p>}
          <Button
            size="lg"
            className="w-full"
            disabled={!picked}
            onClick={() => picked && onPick(picked)}
            data-testid="pick-confirm"
          >
            {picked ? confirmLabel(picked) : 'Pick a card'}
          </Button>
          <RefusalSlot anchor={anchor} />
        </div>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">{intro}</p>
      <ul className="flex flex-wrap gap-2">
        {sortHand(cards).map((card) => (
          <li key={card.id}>
            <button
              type="button"
              aria-pressed={picked?.id === card.id}
              aria-label={c.name(card.t)}
              data-card={card.t}
              onClick={() => setPicked(card)}
              className="rounded-[0.6rem]"
            >
              <CardFace card={card} art={art} c={c} size="md" selected={picked?.id === card.id} />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** What a peek showed you, top first. */
export function PeekSheet({
  memory,
  c,
  art,
  onClose,
  from,
}: {
  memory: Extract<Memory, { kind: 'peek' | 'altered' | 'shared' }>;
  c: Content;
  art: Art;
  onClose: () => void;
  /** Share: who showed you these. */
  from?: string;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={
        memory.kind === 'shared'
          ? `${from ?? 'Someone'} shows you the top of the pile`
          : memory.kind === 'peek'
            ? 'The top of the pile'
            : 'The new top of the pile'
      }
      footer={
        <Button size="lg" className="w-full" onClick={onClose} data-testid="peek-close">
          Got it
        </Button>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        {memory.kind === 'shared'
          ? `Top first, in the order ${from ?? 'they'} left them. Only the two of you saw these; they stay under Me until the pile changes.`
          : 'Top first. Only you saw these; they stay under Me until the pile changes.'}
      </p>
      <ol className="flex flex-wrap gap-2" data-testid="peek-cards">
        {memory.cards.map((card, i) => (
          <li
            key={i}
            className="sf-flip flex flex-col items-center gap-1"
            style={{ animationDelay: `${i * 120}ms` }}
          >
            <CardFace card={card} art={art} c={c} size="md" />
            <span className="text-xs font-semibold text-ink-muted">
              {i === 0 ? 'Top' : ordinal(i + 1)}
            </span>
          </li>
        ))}
        {memory.cards.length === 0 && (
          <li className="text-sm text-ink-muted">The pile is empty.</li>
        )}
      </ol>
    </Modal>
  );
}

/** A card's details: big art, our rules text, its flavour line, and what playing it does now. */
export function Inspector({
  card,
  c,
  art,
  now,
  onClose,
}: {
  card: CardView;
  c: Content;
  art: Art;
  /** What playing it right now would do (or why it can't be played). */
  now: string | null;
  onClose: () => void;
}) {
  const flavour = c.flavour(card, art);
  return (
    <Modal open onClose={onClose} title={c.name(card.t)}>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <CardFace card={card} art={art} c={c} size="xl" />
        <div className="space-y-2 text-sm">
          <p className="text-base text-ink">{c.rules(card.t)}</p>
          {flavour && <p className="text-ink-muted italic">“{flavour}”</p>}
          {now && (
            <p className="rounded-lg bg-info-soft px-3 py-2 text-info-ink ring-1 ring-info-line">
              {now}
            </p>
          )}
          {(isCat(card.t) || card.t === 'wild') && (
            <p className="text-ink-muted">
              Combos ignore what cards say: any two with the same name steal a card.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * You drew a Bomb: the big red moment, with the ways out you have. With the fourth expansion a
 * Second Life (or a Copy of one) saves you too, bringing back a ghost you pick; with only that, you
 * may explode instead and become a ghost.
 */
export function BombStrip({
  prompt,
  c,
  art,
  act,
  drew = false,
  name,
}: {
  prompt: Extract<Prompt, { kind: 'bomb' }>;
  /** You drew it yourself (rather than receiving it). */
  drew?: boolean;
  c: Content;
  art: Art;
  act: Act;
  /** A player's name. */
  name: (id: string) => string;
}) {
  const r = prompt.revive;
  const [ghost, setGhost] = useState<string | null>(() =>
    r?.ghosts.length === 1 ? r.ghosts[0]! : null,
  );
  const [dying, setDying] = useState(false);
  const needGhost = !!r?.ghosts.length;
  const revive = (copy: boolean) =>
    void act(
      { type: 'revive', ...(ghost && needGhost ? { ghost } : {}), ...(copy ? { copy } : {}) },
      { anchor: 'defuse' },
    );
  return (
    <section
      className="sf-shake flex items-start gap-3 rounded-2xl bg-danger-soft p-3 ring-2 ring-danger-line"
      aria-live="assertive"
      data-testid="bomb-strip"
    >
      <CardFace card={prompt.card} art={art} c={c} size="md" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-bold text-danger-ink">
          {prompt.twin
            ? prompt.canDefuse
              ? c.t(`{c:twin} barked at you! Play {c:defuse} to survive (it hides nothing).`)
              : c.t(`{c:twin} barked at you!`)
            : drew
              ? `You drew ${an(c.name(prompt.card.t))}!`
              : `${cap(an(c.name(prompt.card.t)))} is yours!`}
        </p>
        {prompt.canDefuse && (
          <Button
            variant="danger"
            size="lg"
            className="w-full"
            onClick={() => void act({ type: 'defuse' }, { anchor: 'defuse' })}
            data-testid="defuse-button"
          >
            ✂️ {c.t('Play {c:defuse}')}
          </Button>
        )}
        {r && (
          <div className="space-y-2" data-testid="revive">
            {needGhost && (
              <div className="space-y-1">
                <p className="text-sm text-danger-ink">
                  {c.t(
                    'A ghost is at the table: your {c:revive} must bring one back. Pick who (you’ll hide their {bomb} too):',
                  )}
                </p>
                <div
                  className="flex flex-wrap gap-1.5"
                  role="radiogroup"
                  aria-label="Who to bring back"
                >
                  {r.ghosts.map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={ghost === id}
                      onClick={() => setGhost(id)}
                      data-testid="revive-ghost"
                      className={cn(
                        'min-h-10 rounded-full px-3 text-sm font-semibold ring-1',
                        ghost === id
                          ? 'bg-special text-white ring-special'
                          : 'bg-card text-ink ring-special-line',
                      )}
                    >
                      👻 {name(id)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {r.card && (
              <Button
                variant={prompt.canDefuse ? 'secondary' : 'danger'}
                size="lg"
                className="w-full"
                disabled={needGhost && !ghost}
                onClick={() => revive(false)}
                data-testid="revive-button"
              >
                {c.glyph('revive')} {c.t('Use {c:revive}')}
                {needGhost && ghost ? ` (bring back ${name(ghost)})` : ''}
              </Button>
            )}
            {r.copy && (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                disabled={needGhost && !ghost}
                onClick={() => revive(true)}
                data-testid="revive-copy"
              >
                {c.glyph('copy')} {c.t('{c:copy} the {c:revive} on the discard pile')}
              </Button>
            )}
            {needGhost && !ghost && <p className="text-xs text-danger-ink">Pick a ghost first.</p>}
            {!prompt.canDefuse &&
              (dying ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-danger-ink">Explode and become a ghost?</span>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void act({ type: 'die' }, { anchor: 'defuse' })}
                    data-testid="die-confirm"
                  >
                    Yes, explode
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDying(false)}>
                    No
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-xs font-semibold text-danger-ink underline underline-offset-2"
                  onClick={() => setDying(true)}
                  data-testid="die"
                >
                  {c.t('Keep the {c:revive} and explode instead')}
                </button>
              ))}
          </div>
        )}
        <RefusalSlot anchor="defuse" />
      </div>
    </section>
  );
}

/** Look Twice: the top card, seen only by you. Keep it as your draw, or put it back and draw the next. */
export function DigSheet({
  prompt,
  c,
  art,
  act,
  onDone,
}: {
  prompt: Extract<Prompt, { kind: 'dig' }>;
  c: Content;
  art: Art;
  act: Act;
  onDone: () => void;
}) {
  const go = (keep: boolean) => {
    onDone();
    void act({ type: 'dig', keep }, { anchor: 'dig' });
  };
  const bad = prompt.card.t === 'bomb' || prompt.card.t === 'void';
  return (
    <Sheet
      title={c.t('{c:dig}: the top card')}
      footer={
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="lg"
              variant={bad ? 'secondary' : 'primary'}
              onClick={() => go(true)}
              data-testid="dig-keep"
            >
              Keep it
            </Button>
            <Button
              size="lg"
              variant={bad ? 'primary' : 'secondary'}
              onClick={() => go(false)}
              data-testid="dig-next"
            >
              Draw the next one
            </Button>
          </div>
          <RefusalSlot anchor="dig" />
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <CardFace card={prompt.card} art={art} c={c} size="lg" className="sf-flip" />
        <p className="text-sm text-ink">
          Only you see this. Keep it and it’s your draw (that ends a turn). Or put it back on top
          and draw the card under it instead, whatever it is: the next player will find this one
          waiting.
        </p>
      </div>
    </Sheet>
  );
}

/** Whether a card is worth a second thought before giving it away. */
export const precious = (card: CardView) =>
  card.t === 'defuse' || card.t === 'nope' || card.t === 'revive';

export const cardHint = (card: CardView, c: Content, myTurn: boolean): string | null => {
  const info = CARDS[card.t];
  if (card.t === 'nope')
    return c.t('Play it during the countdown after someone’s play, even off your turn.');
  if (card.t === 'defuse') return c.t('Used for you when you draw {c:bomb}: keep it!');
  if (isCat(card.t) || card.t === 'wild')
    return 'Pick two with the same name to steal a random card.';
  if (card.t === 'revive') return c.t('Used when you draw {c:bomb}, like {c:defuse}: keep it!');
  if (card.t === 'seer')
    return c.t('Play it during the countdown after someone’s {c:revive}, even as a ghost.');
  if (info.now) return c.t('Play it any time between actions, even off your turn or as a ghost.');
  if (!info.playable) return null;
  return myTurn ? 'Tap it, then Play.' : 'You can play it on your turn.';
};

/** A blindfolded hand: face-down cards in a shuffled order, picked by position. */
export function BlindSlots({
  count,
  c,
  picked,
  onPick,
  label,
  size = 'md',
}: {
  count: number;
  c: Content;
  picked?: number | null;
  onPick: (slot: number) => void;
  label: string;
  /** Smaller in a sheet, so a big hand fits on a phone. */
  size?: 'sm' | 'md';
}) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label} data-testid="blind-hand">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <button
            type="button"
            aria-pressed={picked === i}
            aria-label={`Face-down card ${i + 1}`}
            data-slot={i}
            onClick={() => onPick(i)}
            className={cn(
              'block rounded-[0.6rem] transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              picked === i && '-translate-y-2 ring-[3px] ring-accent',
            )}
          >
            <CardBack c={c} size={size} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Blindfolded and asked for a card (a Favor, Recycle, Potluck): pick a face-down card. */
export function BlindPickSheet({
  title,
  intro,
  count,
  c,
  confirmLabel,
  onPick,
  anchor,
}: {
  title: string;
  intro: string;
  count: number;
  c: Content;
  confirmLabel: string;
  onPick: (slot: number) => void;
  anchor: string;
}) {
  const [slot, setSlot] = useState<number | null>(null);
  return (
    <Sheet
      title={title}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            className="w-full"
            disabled={slot === null}
            onClick={() => slot !== null && onPick(slot)}
            data-testid="pick-confirm"
          >
            {slot === null ? 'Pick a face-down card' : confirmLabel}
          </Button>
          <RefusalSlot anchor={anchor} />
        </div>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">{intro}</p>
      <BlindSlots
        count={count}
        c={c}
        picked={slot}
        onPick={setSlot}
        label="Your face-down cards"
        size="sm"
      />
    </Sheet>
  );
}

/** A blind card that needs a target: it's turned over, now choose who it's for. */
export function TargetSheet({
  prompt,
  c,
  art,
  name,
  act,
}: {
  prompt: Extract<Prompt, { kind: 'target' }>;
  c: Content;
  art: Art;
  name: (id: string) => string;
  act: Act;
}) {
  return (
    <Sheet
      title={`You turned over ${an(c.name(prompt.card.t))}`}
      footer={<RefusalSlot anchor="target" />}
    >
      <div className="flex items-start gap-3">
        <CardFace card={prompt.card} art={art} c={c} size="md" className="sf-flip" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-ink">{c.rules(prompt.card.t)}</p>
          <p className="text-sm font-semibold text-ink">Choose who it’s for:</p>
          <div className="flex flex-wrap gap-1.5" data-testid="targets">
            {prompt.options.map((id) => (
              <Button
                key={id}
                variant="soft"
                onClick={() => void act({ type: 'target', player: id }, { anchor: 'target' })}
              >
                {name(id)}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Blindfolded with a Bomb: turn face-down cards over one at a time, hoping for a Defuse. Each
 * card that isn't one is lost.
 */
export function SearchSheet({
  prompt,
  c,
  art,
  lost,
  act,
}: {
  prompt: Extract<Prompt, { kind: 'search' }>;
  c: Content;
  art: Art;
  /** The cards already turned over and lost in this search. */
  lost: CardType[];
  act: Act;
}) {
  return (
    <Sheet
      title={
        prompt.twin ? c.t('{c:twin} barked at you!') : `${cap(an(c.name(prompt.card.t)))} is yours!`
      }
      footer={<RefusalSlot anchor="search" />}
    >
      <div className="space-y-3" data-testid="search">
        <div className="flex items-start gap-3">
          <CardFace card={prompt.card} art={art} c={c} size="md" className="sf-shake" />
          <p className="text-sm text-ink">
            {c.t(
              'You’re blindfolded: turn your cards over one at a time. {c:defuse} saves you; every other card is lost. Run out and you explode.',
            )}
          </p>
        </div>
        {lost.length > 0 && (
          <p className="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
            Lost so far:
            {lost.map((t, i) => (
              <CardFace key={i} card={{ t, face: 0 }} art={art} c={c} size="xs" />
            ))}
          </p>
        )}
        <BlindSlots
          count={prompt.slots}
          c={c}
          onPick={(slot) => void act({ type: 'search', slot }, { anchor: 'search' })}
          label="Your face-down cards"
          size="sm"
        />
      </div>
    </Sheet>
  );
}
