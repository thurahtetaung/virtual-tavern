import type { AnyGameDefinition } from '@vt/game-sdk';
import { codenames } from '@vt/game-codenames/logic';
import { echo } from '@vt/game-echo/logic';
import { enigma } from '@vt/game-enigma/logic';
import { masquerade } from '@vt/game-masquerade/logic';
import { roundTable } from '@vt/game-round-table/logic';
import { hogwarts } from '@vt/private-hogwarts/logic';
import { hoodwink } from '@vt/private-hoodwink/logic';
import { hydra, setTestDeck } from '@vt/private-hydra/logic';
import { EVENT_KINDS, type EventKind, inquest, setTestEventOrder } from '@vt/private-inquest/logic';
import { masqueradeOriginals } from '@vt/private-masquerade-originals/logic';
import { nightfall } from '@vt/private-nightfall/logic';
import { reverie } from '@vt/private-reverie/logic';
import { royalPost } from '@vt/private-royal-post/logic';
import { seance } from '@vt/private-seance/logic';
import { setTestRig, tavernBrawl } from '@vt/private-tavern-brawl/logic';
import { enableTestRig, shortFuse } from '@vt/private-short-fuse/logic';

// Browser tests only: Inquest events to put on top of the pile when they are shuffled in (a comma
// list such as `ruled-out,countdown`), so a spec can reach them. Never read in production.
if (process.env.NODE_ENV !== 'production' && process.env.INQUEST_TEST_EVENTS) {
  const kinds = process.env.INQUEST_TEST_EVENTS.split(',').map((k) => k.trim());
  setTestEventOrder(
    kinds.filter((k): k is EventKind => (EVENT_KINDS as readonly string[]).includes(k)),
  );
}

// Browser tests only: Hydra policies to put on top of every new deck (a string of `b`/`r`, top
// first), so a spec can reach the powers. Never read in production.
if (process.env.NODE_ENV !== 'production' && process.env.HYDRA_TEST_DECK) {
  setTestDeck(
    [...process.env.HYDRA_TEST_DECK.toLowerCase()].flatMap((c) =>
      c === 'b' ? ['blue' as const] : c === 'r' ? ['red' as const] : [],
    ),
  );
}

// Browser tests only: Tavern Brawl cards to put on top of a hero's deck (`mage:mage.04,mage.02;
// thief:thief.07`), the first seat always starting, and fewer starting hit points by player count
// (`TAVERN_BRAWL_TEST_HP=3:4,6:5`), so a spec can reach the powers and finish its games quickly.
// Never read in production.
if (
  process.env.NODE_ENV !== 'production' &&
  (process.env.TAVERN_BRAWL_TEST_DECK || process.env.TAVERN_BRAWL_TEST_HP)
) {
  const decks = Object.fromEntries(
    (process.env.TAVERN_BRAWL_TEST_DECK ?? '').split(';').flatMap((part) => {
      const [hero, cards] = part.split(':');
      return hero && cards ? [[hero.trim(), cards.split(',').map((c) => c.trim())]] : [];
    }),
  );
  setTestRig({ decks, firstSeat: true, hp: testHp(process.env.TAVERN_BRAWL_TEST_HP) });
}

/** `3:4,5:5`: starting hit points by player count. */
function testHp(spec: string | undefined): Partial<Record<number, number>> {
  return Object.fromEntries(
    (spec ?? '').split(',').flatMap((part) => {
      const [count, hp] = part.split(':').map(Number);
      return count && hp ? [[count, hp]] : [];
    }),
  );
}

// Browser tests only: let the host fix Short Fuse's hands and the top of the pile (the `rig`
// action), so a spec can reach a given card. Never read in production.
if (process.env.NODE_ENV !== 'production' && process.env.SHORT_FUSE_TEST_RIG === '1') {
  enableTestRig();
}

export type GameRegistry = ReadonlyMap<string, AnyGameDefinition>;

/**
 * Every playable game. Add new games here (and in the web app's registry; private games go in
 * `apps/web/src/games/private.ts`).
 */
export function buildGames(): GameRegistry {
  const list: AnyGameDefinition[] = [
    codenames,
    enigma,
    echo,
    masquerade,
    roundTable,
    reverie,
    hoodwink,
    royalPost,
    masqueradeOriginals,
    nightfall,
    inquest,
    seance,
    hydra,
    hogwarts,
    tavernBrawl,
    shortFuse,
  ];
  return new Map(list.map((g) => [g.id, g]));
}

export const isPrivate = (game: AnyGameDefinition | undefined) => game?.access === 'private';

/** Ids of the registered games that draw words from word lists, in registry order. */
export const wordListGameIds = (games: GameRegistry): string[] =>
  [...games.values()].filter((g) => g.usesWordLists).map((g) => g.id);

/** Ids of the registered games that draw questions from question decks, in registry order. */
export const questionDeckGameIds = (games: GameRegistry): string[] =>
  [...games.values()].filter((g) => g.usesQuestionDecks).map((g) => g.id);
