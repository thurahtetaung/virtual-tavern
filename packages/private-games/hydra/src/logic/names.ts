import type { Power } from './types.ts';

/**
 * The words the table sees for the teams, the Leader, the ballots, the offices and the cards. The
 * repository only holds these neutral placeholders; unlocked browsers get the real ones from the
 * private manifest. Text everywhere is written with tokens (`{blue}`, `{reds}`, `{leader}`,
 * `{president}`, `{policies}`…) that `fillNames` replaces; a capitalised token (`{Leader}`,
 * `{Policy}`) capitalises the word, for the start of a sentence.
 */
export interface Names {
  title: string;
  /** A blue player. */
  blue: string;
  blues: string;
  red: string;
  reds: string;
  /** The Leader, as it reads mid-sentence ("the Usurper"). */
  leader: string;
  yes: string;
  no: string;
  /** The two offices, as they read mid-sentence ("the President"). */
  president: string;
  chancellor: string;
  /** Whoever nominates this round, before the vote ("the Presidential Candidate"). */
  candidate: string;
  /** Short placard labels on a seat. */
  presidentShort: string;
  chancellorShort: string;
  /** The cards on the boards. */
  policy: string;
  policies: string;
  /** The card an investigation looks at ("party card"). */
  party: string;
  /** The Chancellor's request to discard both cards. */
  veto: string;
  /** The adjective for a blue or red card ("a Loyalist policy"); the team word by default. */
  bluePolicy: string;
  redPolicy: string;
}

/** The fields a manifest may leave out and that fall back to another name. */
export const NAME_FALLBACKS: Partial<Record<keyof Names, keyof Names>> = {
  bluePolicy: 'blue',
  redPolicy: 'red',
};

export const PLACEHOLDER_NAMES: Names = {
  title: 'Hydra',
  blue: 'Loyalist',
  blues: 'Loyalists',
  red: 'Conspirator',
  reds: 'Conspirators',
  leader: 'the Usurper',
  yes: 'Yes',
  no: 'No',
  president: 'President',
  chancellor: 'Chancellor',
  candidate: 'Presidential Candidate',
  presidentShort: 'Pres',
  chancellorShort: 'Chanc',
  policy: 'policy',
  policies: 'policies',
  party: 'party',
  veto: 'veto',
  bluePolicy: 'Loyalist',
  redPolicy: 'Conspirator',
};

const KEYS = new Set(Object.keys(PLACEHOLDER_NAMES));

export const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const word = (k: string, names: Names): string | null => {
  if (KEYS.has(k)) return names[k as keyof Names];
  const lower = k[0]!.toLowerCase() + k.slice(1);
  return k !== lower && KEYS.has(lower) ? capitalise(names[lower as keyof Names]) : null;
};

/**
 * Replaces the name tokens in `text`. `{leader}` is the word as named, `{Leader}` the same word
 * capitalised, and "a {veto}" becomes "an …" when the name starts with a vowel. Anything else in
 * braces (a copy line's `{player}`, say) is left alone.
 */
export function fillNames(text: string, names: Names): string {
  return text.replace(
    /(\b(?:[Aa]n?) )?\{([A-Za-z]+)\}/g,
    (m, article: string | undefined, k: string) => {
      const w = word(k, names);
      if (w === null) return m;
      if (!article) return w;
      const an = /^[aeiou]/i.test(w);
      const a = article[0]!;
      return `${an ? `${a}n` : a} ${w}`;
    },
  );
}

/** The powers' default names, with name tokens. */
export const POWER_NAMES: Record<Power, string> = {
  investigate: 'Investigate loyalty',
  special: 'Special election',
  peek: '{Policy} peek',
  execute: 'Execution',
};

/** One line each, with name tokens. */
export const POWER_TEXT: Record<Power, string> = {
  investigate:
    'The {president} secretly sees one player’s {party} card ({blue} or {red}). Nobody can be investigated twice, and the {president} may lie about it.',
  special:
    'The {president} picks any other player to be the next {candidate}. Afterwards the order goes on from the {president}’s left.',
  peek: 'The {president} secretly looks at the top three cards of the deck, then puts them back in the same order.',
  execute:
    'The {president} executes a player. If it’s {leader}, the {blues} win at once; otherwise nobody learns who they were, and they can’t speak, vote or run again.',
};
