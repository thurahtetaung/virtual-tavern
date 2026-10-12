import { WORD_KINDS, type WordKind } from '@vt/protocol';

// Which word kinds each game reports through its `insights()`, so the Words card only offers tabs
// that can hold something. The first kind is the default tab.

const KINDS_BY_GAME: Readonly<Record<string, readonly WordKind[]>> = {
  codenames: ['clue', 'guess', 'assassin'],
  enigma: ['clue'],
  echo: ['clue', 'guess', 'cancelled'],
  reverie: ['story'],
  // Every lie on the board, reported as a guess.
  hoodwink: ['guess'],
  // A card game: no words at all, so no Words card.
  'royal-post': [],
  // Each round's location, and the locations caught spies guessed.
  masquerade: ['clue', 'guess'],
  'masquerade-originals': ['clue', 'guess'],
  // Hidden roles and votes: no words at all, so no Words card.
  'round-table': [],
  // Role ids: the roles dealt, and the roles that died.
  nightfall: ['clue', 'guess'],
  // Cards, not words: no Words card.
  inquest: [],
  // Picture cards, not words: no Words card.
  seance: [],
  // Policies and votes, not words: no Words card.
  hydra: [],
};

const LABELS: Record<WordKind, string> = {
  clue: 'Clues',
  guess: 'Guesses',
  cancelled: 'Cancelled clues',
  assassin: 'Assassin hits',
  story: 'Story clues',
};

const GAME_LABELS: Readonly<Record<string, Partial<Record<WordKind, string>>>> = {
  hoodwink: { guess: 'Lies' },
  masquerade: { clue: 'Locations', guess: 'Spy guesses' },
  'masquerade-originals': { clue: 'Locations', guess: 'Spy guesses' },
  nightfall: { clue: 'Roles dealt', guess: 'Roles that died' },
};

/** The kinds a known game reports, or null for a game this page doesn't know yet. */
export const knownWordKinds = (gameId: string): readonly WordKind[] | null =>
  KINDS_BY_GAME[gameId] ?? null;

/** For an unknown game: the kinds with words in the range, or every kind if none has any. */
export function kindsWithWords(counts: Partial<Record<WordKind, number>>): readonly WordKind[] {
  const kinds = WORD_KINDS.filter((k) => (counts[k] ?? 0) > 0);
  return kinds.length ? kinds : WORD_KINDS;
}

export const wordKindLabel = (gameId: string, kind: WordKind): string =>
  GAME_LABELS[gameId]?.[kind] ?? LABELS[kind];
