import { Button, Modal } from '@vt/ui';
import { useState } from 'react';
import { HEROES, cardsOf } from '../logic/cards.ts';
import { POWER_TEXT, cardText, powersOf } from '../logic/guide.ts';
import type { CardId, HeroId } from '../logic/types.ts';
import { type Art, heroVars } from './assets.ts';
import { Card, Zoom } from './Card.tsx';
import { Portrait } from './Lobby.tsx';
import { midSentence } from './text.ts';

const deckSize = (hero: HeroId) => cardsOf(hero).reduce((n, c) => n + c.count, 0);

/** A hero's mighty powers in a line or two each: the card name and what the power does. */
export function PowerLines({
  hero,
  art,
  full = false,
}: {
  hero: HeroId;
  art: Art;
  /** The whole card's text (its symbols too), rather than just the power. */
  full?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-1" aria-label={`${art.hero(hero)}’s mighty powers`}>
      {powersOf(hero).map((c) => (
        <li key={c.id} className="text-sm leading-snug">
          <span className="font-semibold">✦ {art.card(c.id)}</span>
          <span className="text-ink-muted dark:text-stone-400">
            {' '}
            {full ? cardText(c) : POWER_TEXT[c.effect!]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Everything public about a hero: their style, mighty powers and whole deck, card by card. The
 * lobby's hero pick and the table's seats open it; nothing in it depends on anyone's hand.
 */
export function HeroSheet({
  hero,
  art,
  who,
  onClose,
  footer,
}: {
  hero: HeroId | null;
  art: Art;
  /** Who plays this hero ("Ana", "You"), worded for the middle of a sentence. */
  who?: string | undefined;
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  const [zoom, setZoom] = useState<CardId | null>(null);
  const box = hero ? art.heroClass(hero) : null;
  const set = hero ? art.set(HEROES[hero].set) : null;
  return (
    <Modal
      open={hero !== null}
      onClose={onClose}
      title={hero ? art.hero(hero) : ''}
      footer={footer}
    >
      {hero && (
        <div className="flex flex-col gap-3" data-testid="tb-hero-sheet" style={heroVars(hero)}>
          <div className="flex items-center gap-3">
            <Portrait hero={hero} art={art} size={56} />
            <div className="min-w-0">
              <p className="text-xs text-ink-muted dark:text-stone-400">
                {[box, set, who && `played by ${midSentence(who)}`].filter(Boolean).join(' · ')}
              </p>
              <p className="text-sm">{HEROES[hero].style}</p>
            </div>
          </div>
          <section
            aria-label="Mighty powers"
            className="rounded-xl bg-accent-soft/60 p-3 ring-1 ring-accent-line dark:bg-amber-500/10 dark:ring-amber-500/30"
          >
            <h3 className="text-xs font-bold tracking-wider text-accent-text uppercase dark:text-amber-300">
              Mighty powers
            </h3>
            <ul className="mt-1.5 flex flex-col gap-2">
              {powersOf(hero).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setZoom(c.id)}
                    className="flex w-full gap-2.5 text-left"
                    aria-label={`${art.card(c.id)}: ${cardText(c)}`}
                  >
                    <Card card={c.id} art={art} width={52} />
                    <span className="min-w-0">
                      <span className="block font-bold">
                        {art.card(c.id)}
                        <span className="font-semibold text-ink-muted dark:text-stone-400">
                          {' '}
                          ×{c.count}
                        </span>
                      </span>
                      <span className="block text-sm">{cardText(c)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <details className="group rounded-xl ring-1 ring-line dark:ring-stone-700">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 font-semibold [&::-webkit-details-marker]:hidden">
              The whole deck ({deckSize(hero)} cards)
              <span
                aria-hidden
                className="text-ink-muted transition-transform group-open:rotate-90"
              >
                ▸
              </span>
            </summary>
            <ul className="flex flex-col gap-1 px-2 pb-2" aria-label="The deck">
              {cardsOf(hero).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setZoom(c.id)}
                    className="flex w-full items-center gap-2 rounded-lg p-1 text-left hover:bg-panel dark:hover:bg-stone-800"
                    aria-label={`${art.card(c.id)} ×${c.count}: ${cardText(c)}`}
                  >
                    <Card card={c.id} art={art} width={36} />
                    <span className="min-w-0 text-sm leading-snug">
                      <span className="font-semibold">
                        {c.effect && '✦ '}
                        {art.card(c.id)} ×{c.count}
                      </span>{' '}
                      <span className="text-ink-muted dark:text-stone-400">{cardText(c)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
          <Zoom card={zoom} art={art} onClose={() => setZoom(null)} />
        </div>
      )}
    </Modal>
  );
}

/** One "Powers" line per hero at the table: theirs and everyone else's, each opening the sheet. */
export function PowersPanel({
  heroes,
  art,
}: {
  heroes: { hero: HeroId; who: string; out?: boolean }[];
  art: Art;
}) {
  const [open, setOpen] = useState<{ hero: HeroId; who: string } | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid="tb-powers">
      {heroes.map(({ hero, who, out }) => (
        <section
          key={`${hero}-${who}`}
          aria-label={`${who}: ${art.hero(hero)}`}
          style={heroVars(hero)}
          className="rounded-xl bg-card p-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-800"
        >
          <div className="mb-1 flex items-center gap-2">
            <Portrait hero={hero} art={art} size={32} className={out ? 'opacity-60' : ''} />
            <p className="min-w-0 flex-1 truncate text-sm">
              <span className="font-semibold">{who}</span>
              <span className="text-ink-muted dark:text-stone-400"> · {art.hero(hero)}</span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen({ hero, who })}
              aria-label={`Mighty powers and deck: ${art.hero(hero)}`}
            >
              Deck ›
            </Button>
          </div>
          <PowerLines hero={hero} art={art} />
        </section>
      ))}
      <HeroSheet
        hero={open?.hero ?? null}
        who={open?.who}
        art={art}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
