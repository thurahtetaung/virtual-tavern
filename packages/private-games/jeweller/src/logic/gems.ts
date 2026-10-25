import type { Token } from './types.ts';

/** What the table calls each piece. */
export const TOKEN_NAME: Record<Token, string> = {
  white: 'Diamond',
  blue: 'Sapphire',
  green: 'Emerald',
  red: 'Ruby',
  black: 'Onyx',
  gold: 'Gold',
};

/** Each piece as an emoji, for text and placeholders. */
export const TOKEN_EMOJI: Record<Token, string> = {
  white: '⚪',
  blue: '🔵',
  green: '🟢',
  red: '🔴',
  black: '⚫',
  gold: '🟡',
};

export const LEVEL_NAME = { 1: 'I', 2: 'II', 3: 'III' } as const;
