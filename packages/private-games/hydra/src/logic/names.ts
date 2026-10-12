import type { Power } from './types.ts';

/**
 * The words the table sees for the teams, the Leader and the ballots. The repository only holds
 * these neutral placeholders; unlocked browsers get the real ones from the private manifest.
 * Text everywhere is written with tokens (`{blue}`, `{reds}`, `{leader}`, `{Leader}`, `{yes}`…)
 * that `fillNames` replaces.
 */
export interface Names {
  title: string;
  /** A blue player, and the adjective for blue policies and party cards. */
  blue: string;
  blues: string;
  red: string;
  reds: string;
  /** The Leader, as it reads mid-sentence ("the Usurper"). */
  leader: string;
  yes: string;
  no: string;
}

export const PLACEHOLDER_NAMES: Names = {
  title: 'Hydra',
  blue: 'Loyalist',
  blues: 'Loyalists',
  red: 'Conspirator',
  reds: 'Conspirators',
  leader: 'the Usurper',
  yes: 'Yes',
  no: 'No',
};

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Replaces the name tokens in `text`. `{Leader}` is the Leader at the start of a sentence. */
export function fillNames(text: string, names: Names): string {
  return text.replace(/\{(title|blue|blues|red|reds|leader|Leader|yes|no)\}/g, (_m, k: string) =>
    k === 'Leader' ? cap(names.leader) : names[k as keyof Names],
  );
}

export const POWER_NAMES: Record<Power, string> = {
  investigate: 'Investigate loyalty',
  special: 'Special election',
  peek: 'Policy peek',
  execute: 'Execution',
};

/** One line each, with name tokens. */
export const POWER_TEXT: Record<Power, string> = {
  investigate:
    'The President secretly sees one player’s party card ({blue} or {red}). Nobody can be investigated twice, and the President may lie about it.',
  special:
    'The President picks any other player to be the next Presidential Candidate. Afterwards the order goes on from the President’s left.',
  peek: 'The President secretly looks at the top three cards of the deck, then puts them back in the same order.',
  execute:
    'The President executes a player. If it’s {leader}, the {blues} win at once; otherwise nobody learns who they were, and they can’t speak, vote or run again.',
};
