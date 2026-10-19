import { GameError, type PlayerId } from '@vt/game-sdk';
import type { Round, WordCard } from './types.ts';

/**
 * A word list entry is one word card: `Top / Bottom` holds the word on top and the one printed
 * upside down; an entry without ` / ` is a card with one word.
 */
export function parseWordCard(entry: string): WordCard {
  const [top, bottom] = entry.split(' / ').map((w) => w.trim());
  return bottom && top ? [top, bottom] : [entry.trim()];
}

export const hasOtherWord = (card: WordCard): card is [string, string] => card.length === 2;

/** The stage a round opens in: the First Scout's choice for a two-word card, else marking. */
export const openingStage = (card: WordCard) => (hasOtherWord(card) ? 'word' : 'mark');

/**
 * The house rule for the word printed upside down: the round's First Scout alone decides, before
 * marking starts, whether the table plays it instead. Returns the round with its word chosen
 * (marking opens), or why not.
 */
export function chooseWord(round: Round, side: 0 | 1, by: PlayerId): Round | GameError {
  if (round.stage !== 'word')
    return new GameError('wrong-stage', 'The word has already been chosen.');
  if (by !== round.first)
    return new GameError('not-first-scout', 'The First Scout chooses the word.');
  return { ...round, side, stage: 'mark' };
}

/** The word in play, once chosen. */
export const wordOf = (round: Round): string | null =>
  round.stage === 'word' ? null : (round.card[round.side] ?? round.card[0]);
