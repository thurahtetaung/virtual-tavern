import type { AnyGameDefinition } from '@vt/game-sdk';
import { codenames } from '@vt/game-codenames/logic';
import { echo } from '@vt/game-echo/logic';
import { enigma } from '@vt/game-enigma/logic';
import { masquerade } from '@vt/game-masquerade/logic';
import { roundTable } from '@vt/game-round-table/logic';
import { hoodwink } from '@vt/private-hoodwink/logic';
import { EVENT_KINDS, type EventKind, inquest, setTestEventOrder } from '@vt/private-inquest/logic';
import { masqueradeOriginals } from '@vt/private-masquerade-originals/logic';
import { nightfall } from '@vt/private-nightfall/logic';
import { reverie } from '@vt/private-reverie/logic';
import { royalPost } from '@vt/private-royal-post/logic';
import { seance } from '@vt/private-seance/logic';

// Browser tests only: Inquest events to put on top of the pile when they are shuffled in (a comma
// list such as `ruled-out,countdown`), so a spec can reach them. Never read in production.
if (process.env.NODE_ENV !== 'production' && process.env.INQUEST_TEST_EVENTS) {
  const kinds = process.env.INQUEST_TEST_EVENTS.split(',').map((k) => k.trim());
  setTestEventOrder(
    kinds.filter((k): k is EventKind => (EVENT_KINDS as readonly string[]).includes(k)),
  );
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
