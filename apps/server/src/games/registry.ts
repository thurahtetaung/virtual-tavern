import type { AnyGameDefinition } from '@vt/game-sdk';
import { codenames } from '@vt/game-codenames/logic';
import { echo } from '@vt/game-echo/logic';
import { enigma } from '@vt/game-enigma/logic';
import { masquerade } from '@vt/game-masquerade/logic';
import { roundTable } from '@vt/game-round-table/logic';
import { hogwarts } from '@vt/private-hogwarts/logic';
import { hoodwink } from '@vt/private-hoodwink/logic';
import { hydra, setTestDeck } from '@vt/private-hydra/logic';
import { iconic, setTestWord } from '@vt/private-iconic/logic';
import { EVENT_KINDS, type EventKind, inquest, setTestEventOrder } from '@vt/private-inquest/logic';
import { jeweller, setTestDeck as setJewellerDeck } from '@vt/private-jeweller/logic';
import { masqueradeOriginals } from '@vt/private-masquerade-originals/logic';
import { type Colour, mosaic, setTestBag } from '@vt/private-mosaic/logic';
import { nightfall, setTestHold } from '@vt/private-nightfall/logic';
import { reverie } from '@vt/private-reverie/logic';
import { royalPost } from '@vt/private-royal-post/logic';
import { seance } from '@vt/private-seance/logic';
import { setTestRig, tavernBrawl } from '@vt/private-tavern-brawl/logic';
import { enableTestRig, shortFuse } from '@vt/private-short-fuse/logic';
import { starlight } from '@vt/private-starlight/logic';
import { thorns } from '@vt/private-thorns/logic';
import { stampede } from '@vt/private-stampede/logic';
import { enableTestRig as enableGoingOnceRig, goingOnce } from '@vt/private-going-once/logic';
import { enableTestRig as enableSketchyRig, sketchy } from '@vt/private-sketchy/logic';
import {
  encore,
  parseTestDeck as parseEncoreDeck,
  setTestDeck as setEncoreDeck,
} from '@vt/private-encore/logic';

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

// Browser tests only: let the host fix Going Once's deal and speed up its clock (the `rig`
// action), so a spec can play a whole game quickly. Never read in production.
if (process.env.NODE_ENV !== 'production' && process.env.GOING_ONCE_TEST_RIG === '1') {
  enableGoingOnceRig();
}

// Browser tests only: Sketchy deals the prompts in the packs' own order and brings the drawings
// up in seat order, so a spec knows what each player draws. Never read in production.
if (process.env.NODE_ENV !== 'production' && process.env.SKETCHY_TEST_RIG === '1') {
  enableSketchyRig();
}

// Browser tests only: Encore's deck by table size (`3:1/2 4/1 …;2:…`, each card up-number first),
// dealt in seat order every round, so a spec knows every hand. Never read in production.
if (process.env.NODE_ENV !== 'production' && process.env.ENCORE_TEST_DECK) {
  setEncoreDeck(parseEncoreDeck(process.env.ENCORE_TEST_DECK));
}

// Browser tests only: a Nightfall step waits up to this many seconds past its clock for players
// who still have a choice to make, so a busy machine's clicks aren't beaten by the night's timer.
// Never read in production.
if (process.env.NODE_ENV !== 'production' && process.env.NIGHTFALL_TEST_HOLD) {
  setTestHold(Number(process.env.NIGHTFALL_TEST_HOLD) * 1000 || 0);
}

// Browser tests only: the first word of every Iconic card, so a spec knows the answer. Never read
// in production.
if (process.env.NODE_ENV !== 'production' && process.env.ICONIC_TEST_WORD) {
  setTestWord(process.env.ICONIC_TEST_WORD);
}

// Browser tests only: Jeweller cards and nobles to put on top when a game is dealt
// (`1:L1-01,L1-25;2:L2-03;n:N01,N06;own:L3-05;c:C3a,C1b;h:L1-35,L1-35`: a level's cards top first,
// `n` the nobles, `own` cards the first seat already owns, `c` the City sides with Cities on, `h`
// face-up cards the first seat's strongholds start on with Strongholds on), with the first seat
// always starting, so a spec can reach a noble visit, a City, a Conquest and the end quickly.
// Never read in production.
if (process.env.NODE_ENV !== 'production' && process.env.JEWELLER_TEST_DECK) {
  const parts = Object.fromEntries(
    process.env.JEWELLER_TEST_DECK.split(';').flatMap((part) => {
      const [key, ids] = part.split(':');
      return key && ids ? [[key.trim(), ids.split(',').map((id) => id.trim())]] : [];
    }),
  );
  setJewellerDeck({
    decks: { 1: parts['1'] ?? [], 2: parts['2'] ?? [], 3: parts['3'] ?? [] },
    nobles: parts.n ?? [],
    owned: parts.own ?? [],
    cities: parts.c ?? [],
    holds: parts.h ?? [],
    firstSeat: true,
  });
}

// Browser tests only: Mosaic tiles for the top of the bag when a game is dealt, as letters (b
// blue, y yellow, r red, k black, a light blue; four fill each factory in turn), and tiles already
// on the first seat's wall (`top:bbbbyyyy;wall0:yrka`: row 0 holds yellow, red, black and light
// blue), with the first seat always starting, so a spec knows the deal and reaches the end in a
// round. Never read in production.
if (process.env.NODE_ENV !== 'production' && process.env.MOSAIC_TEST_BAG) {
  const letters: Record<string, Colour> = {
    b: 'blue',
    y: 'yellow',
    r: 'red',
    k: 'black',
    a: 'aqua',
  };
  const tiles = (s: string) => [...s].flatMap((ch) => (letters[ch] ? [letters[ch]] : []));
  const wall: Record<number, Colour[]> = {};
  let top: Colour[] = [];
  for (const part of process.env.MOSAIC_TEST_BAG.split(';')) {
    const [key, value] = part.split(':').map((x) => x.trim());
    if (!key || !value) continue;
    if (key === 'top') top = tiles(value);
    const row = /^wall([0-4])$/.exec(key);
    if (row) wall[Number(row[1])] = tiles(value);
  }
  setTestBag({ top, wall, firstSeat: true });
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
    starlight,
    thorns,
    iconic,
    stampede,
    jeweller,
    goingOnce,
    sketchy,
    mosaic,
    encore,
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

/** The question-deck games that read open questions (no answers) rather than trivia. */
export const openQuestionGameIds = (games: GameRegistry): string[] =>
  [...games.values()]
    .filter((g) => g.usesQuestionDecks && g.questionKind === 'open')
    .map((g) => g.id);
