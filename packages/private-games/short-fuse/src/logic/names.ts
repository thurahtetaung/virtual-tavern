import type { CardType, SetId } from './cards.ts';
import type { Core } from './types.ts';

/**
 * Names in Short Fuse's text. The code only knows neutral card ids; text is written with tokens
 * (`{c:attack}` for a card's name, `{bomb}`/`{bombs}`/`{Bomb}`/`{Bombs}` for the bomb word,
 * `{title}`), filled from the private manifest's `names` with these placeholders as the fallback.
 */

export const PLACEHOLDER_CARDS: Record<CardType, string> = {
  bomb: 'Bomb',
  defuse: 'Defuse',
  attack: 'Attack',
  skip: 'Skip',
  favor: 'Favor',
  shuffle: 'Shuffle',
  peek3: 'Peek (3)',
  nope: 'Nope',
  cat1: 'Cat A',
  cat2: 'Cat B',
  cat3: 'Cat C',
  cat4: 'Cat D',
  cat5: 'Cat E',
  void: 'Black Hole',
  wild: 'Wild Cat',
  aim: 'Targeted Attack',
  reverse: 'Reverse',
  bottom: 'Draw from the Bottom',
  alter3: 'Rearrange (3)',
  shelter: 'Bomb Shelter',
  superskip: 'Super Skip',
  peek5: 'Peek (5)',
  alter5: 'Rearrange (5)',
  swap: 'Swap Top and Bottom',
  recycle: 'Recycle',
  stack: 'Bomb Stack',
  mark: 'Mark',
  blind: 'Blindfold',
  twin: 'Twin Bomb',
  vault: 'Vault',
  mine: 'Mine!',
  bury: 'Bury',
  self3: 'Self Attack (3)',
  potluck: 'Potluck',
  share3: 'Share (3)',
  alter3now: 'Rearrange (3) NOW',
};

/** A simple glyph per card, for placeholder cards and small chips. */
export const GLYPHS: Record<CardType, string> = {
  bomb: '💣',
  defuse: '✂️',
  attack: '⚔️',
  skip: '⏭️',
  favor: '🙏',
  shuffle: '🔀',
  peek3: '👁️',
  nope: '✋',
  cat1: '🐱',
  cat2: '🐈',
  cat3: '😺',
  cat4: '😼',
  cat5: '🙀',
  void: '🕳️',
  wild: '🐾',
  aim: '🎯',
  reverse: '🔁',
  bottom: '⤵️',
  alter3: '🔮',
  shelter: '🛡️',
  superskip: '⏩',
  peek5: '🔭',
  alter5: '🪄',
  swap: '🔃',
  recycle: '♻️',
  stack: '🧨',
  mark: '🏷️',
  blind: '🙈',
  twin: '👯',
  vault: '👑',
  mine: '🫴',
  bury: '⛏️',
  self3: '🌀',
  potluck: '🍲',
  share3: '🤝',
  alter3now: '⚡',
};

/** Our own short rules text per card (the inspector and the glossary). */
export const RULES: Record<CardType, string> = {
  bomb: 'Explodes when drawn, unless you play a {c:defuse}. You’re out if it goes off.',
  defuse:
    'Saves you from a {bomb} you drew: then hide the {bomb} anywhere in the pile, in secret. Your turn ends.',
  attack:
    'End your turn without drawing. The next player takes 2 turns (more if you were attacked: your turns pass on, plus 2).',
  skip: 'End one turn without drawing.',
  favor: 'Another player gives you a card of their choice.',
  shuffle: 'Shuffle the draw pile.',
  peek3: 'Secretly look at the top 3 cards of the pile.',
  nope: 'Stop any play except a {bomb} or a {c:defuse}, even off your turn. A {c:nope} can be Noped back.',
  cat1: 'No power alone. Two matching cats steal a random card; three name a card to take.',
  cat2: 'No power alone. Two matching cats steal a random card; three name a card to take.',
  cat3: 'No power alone. Two matching cats steal a random card; three name a card to take.',
  cat4: 'No power alone. Two matching cats steal a random card; three name a card to take.',
  cat5: 'No power alone. Two matching cats steal a random card; three name a card to take.',
  void: 'Drawn face down: put it back face up anywhere, in secret (no {c:defuse}). Drawn face up: you’re out, nothing can save you.',
  wild: 'Counts as any cat for pairs and three of a kind.',
  aim: 'End your turn without drawing. Any other player takes 2 turns (stacks like an {c:attack}); play goes on from them.',
  reverse: 'Reverse the order of play and end one turn without drawing.',
  bottom: 'End one turn by drawing the bottom card of the pile.',
  alter3: 'Look at the top 3 cards and put them back in any order.',
  shelter:
    'While it’s in your hand, a {bomb} you draw stays secretly in your hand instead of exploding (one at a time). If the Shelter leaves your hand, that {bomb} goes off on you.',
  superskip: 'End your turn without drawing: every turn you owe ends.',
  peek5: 'Secretly look at the top 5 cards of the pile.',
  alter5: 'Look at the top 5 cards and put them back in any order.',
  swap: 'Swap the top and bottom cards of the pile, without looking.',
  recycle:
    'Everyone with cards, you included, puts one card from their hand into the pile in secret; then it’s shuffled.',
  stack:
    'Take every {bomb} out of the pile in plain view and put them all on top; then end one turn without drawing.',
  mark: 'A random card of another player’s is turned to face everyone, until it leaves their hand.',
  blind:
    'Blindfold another player: they can’t see their cards (any card they play is random) until they draw one safely.',
  twin: 'Play it to find the other one: whoever has it must play a {c:defuse} or explode (that {c:defuse} hides nothing). Both together: aim them at anyone. Never Noped.',
  vault:
    'Wear the Vault for the rest of the game with its face-down Stash: anything stolen from you comes from the Stash first.',
  mine: 'Put it in front of another player: the next card they draw comes to you instead (a {bomb} too!). Their turn still ends.',
  bury: 'End one turn by drawing a card, looking at it and putting it back anywhere in the pile, in secret.',
  self3: 'Take 3 turns in a row yourself (stacks with attacks you owe).',
  potluck:
    'Everyone with cards, starting with you, puts one card from their hand face down on top of the pile.',
  share3: 'Look at the top 3 cards and put them back in any order; the next player sees them too.',
  alter3now:
    'Any time between actions, even off your turn: look at the top 3 cards and put them back in any order.',
};

export const PLACEHOLDER_SETS: Record<Core | SetId | 'adult', string> = {
  classic: 'Classic deck',
  party: 'Party deck',
  adult: 'Adult deck (18+)',
  core: 'Core deck',
  x1: 'Expansion 1',
  x2: 'Expansion 2',
  x3: 'Expansion 3',
};

export interface Names {
  title: string;
  cards: Record<CardType, string>;
  sets: Record<string, string>;
  /** The bomb word: singular and plural. */
  bomb: string;
  bombs: string;
}

export const PLACEHOLDER_NAMES: Names = {
  title: 'Short Fuse',
  cards: PLACEHOLDER_CARDS,
  sets: PLACEHOLDER_SETS,
  bomb: 'bomb',
  bombs: 'bombs',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Fills `{c:type}`, `{bomb}`, `{bombs}`, `{Bomb}`, `{Bombs}` and `{title}` in `text`. */
export function fillNames(text: string, names: Names = PLACEHOLDER_NAMES): string {
  return text.replace(/\{(c:[\w-]+|bombs?|Bombs?|title)\}/g, (m, key: string) => {
    if (key.startsWith('c:')) return names.cards[key.slice(2) as CardType] ?? m;
    if (key === 'title') return names.title;
    const word = key.toLowerCase() === 'bomb' ? names.bomb : names.bombs;
    return key[0] === 'B' ? cap(word) : word;
  });
}
