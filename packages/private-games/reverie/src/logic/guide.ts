import { type GameGuide, shapeGuide } from '@vt/game-sdk';
import type { ReverieView } from './types.ts';

const text: GameGuide = {
  tagline: 'Give a dreamy clue for one of your picture cards, and let some, but not all, find it.',
  players: '3 to 8',
  duration: '30 minutes',
  goal: 'Be the first to the target score (15, 20 or 30 points, chosen by the host) by giving clues that are neither too obvious nor too obscure, and by spotting other players’ clues.',
  quickStart: [
    'Each turn one player is the storyteller: they pick a picture card from their hand and give a clue for it.',
    'Everyone else gives the card from their own hand that best fits the clue.',
    'All the cards are shuffled and laid out. Vote for the one you think is the storyteller’s.',
    'If some, but not all, find it, the storyteller and the finders score.',
    'If everyone or nobody finds it, the storyteller scores nothing and the others score.',
    'You also score for each vote your card gets. Once someone reaches the target, the highest score wins.',
  ],
  setup: [
    'Everyone sits down (up to 8 players; others can watch).',
    'The host picks which card sets to play with and the score to play to, then presses Start. Everyone gets 6 picture cards (7 with three players).',
    'Only you can see your hand.',
  ],
  roles: [
    {
      name: 'Storyteller',
      summary:
        'Changes every turn. Picks one card from their hand and gives a clue for it: a word, a sentence, a song line, a sound… anything.',
    },
    {
      name: 'Everyone else',
      summary:
        'Picks the card from their own hand that best fits the clue, then tries to spot the storyteller’s card among all the cards on the table.',
    },
  ],
  sections: [
    {
      title: 'A turn',
      bullets: [
        'The storyteller chooses a card and types a clue. Nobody else sees the card yet, and once told, the card and clue can’t be changed.',
        'Each other player gives one card from their hand that could match the clue (two cards each with three players).',
        'All the cards are shuffled and laid face up, numbered.',
        'Everyone except the storyteller votes for the card they think is the storyteller’s. You can’t vote for your own card. You can change your vote (open another card and tap Change vote) until the last vote is in.',
        'The cards are revealed with their owners and votes, and points are scored.',
      ],
    },
    {
      title: 'Between turns',
      bullets: [
        'The host presses Next turn: the table is discarded, everyone draws back up to a full hand, and the next player round the table becomes the storyteller. The scoreboard always names the next storyteller.',
        'When the draw pile runs out, the used cards are shuffled back in to make a new pile, and the table is told so. The game never ends because the cards ran out.',
      ],
    },
    {
      title: 'Scoring',
      bullets: [
        'If everyone found the storyteller’s card, or nobody did: the storyteller scores 0 and everyone else scores 2.',
        'Otherwise: the storyteller scores 3, and so does everyone who found the card.',
        'On top of that, each player except the storyteller scores 1 point for every vote their own card received.',
        'The reveal shows how each player’s points add up, for example “3 (found it) + 2 (votes)”.',
      ],
    },
    {
      title: 'Winning',
      paragraphs: [
        'When a turn ends with someone on the target score or more, the game is over and the highest score wins (ties share the win). The host’s button then reads See final scores instead of Next turn. The host chooses the target, 15, 20 or 30 points, in the settings.',
      ],
    },
    {
      title: 'With three players',
      paragraphs: [
        'Everyone holds 7 cards and the two other players each give 2 cards, so there are still 5 cards on the table. Vote bonuses work the same way.',
      ],
    },
    {
      title: 'Coming and going',
      bullets: [
        'You can sit down or stand up at the reveal, between turns. Someone who stands up discards their hand but keeps their score; someone who sits down gets cards at the next turn, as long as the chosen card sets have enough left for another hand.',
        'If the storyteller leaves mid-turn, the turn is cancelled: cards that were given go back to their owners, and the next player tells a story instead.',
        'If anyone else leaves mid-turn, their card and vote are simply dropped and the turn carries on without them (anyone who had voted for that card votes again). Someone who leaves during the reveal keeps their place in it; their cards on the table are discarded at the next turn.',
        'Someone who leaves the room keeps their score: if they come back during the same game, they pick it up again, watching until they take a seat at a reveal.',
        'Someone who joins mid-game watches until the reveal, then can take a seat and gets cards from the next turn.',
        'If fewer than 3 players are left, the game ends and the highest score among those still playing wins.',
      ],
    },
    {
      title: 'Timers (optional)',
      paragraphs: [
        'The host can set a time for the storyteller, and a time for giving cards and voting. By default the timer is just a reminder. In Strict mode, a storyteller who runs out of time is skipped, late card givers play the first card (or two) of their hand, and late voters miss the vote. The table is told each time: who was skipped, whose cards were played for them, and who missed the vote.',
        'When a strict vote closes early, anyone who didn’t vote counts as not having found the card. So if only some of the players voted and found it, that’s “some found it”: the storyteller and the finders score 3. Someone who didn’t vote scores only the votes their own card received, and if nobody voted at all, nobody scores for the clue.',
      ],
    },
  ],
  tips: [
    'The sweet spot is a clue that one or two people get. Too clear and everyone finds it; too strange and nobody does. Both score you nothing.',
    'Picking a card to give is the sneaky part: choose one that could plausibly be the storyteller’s, and you’ll collect votes.',
    'Clues can be a feeling, a memory, a song, a film title, or just a sound.',
    'Tap any card to see it full size before you decide.',
  ],
  glossary: [
    { term: 'Storyteller', meaning: 'The player giving the clue this turn.' },
    { term: 'Table', meaning: 'The shuffled, numbered cards everyone votes on.' },
    {
      term: 'Card set',
      meaning: 'A group of up to 84 picture cards; the host can mix several.',
    },
  ],
};

export const guide: GameGuide = shapeGuide(text, {
  steps: [
    ['The storyteller gives a clue', '📖'],
    ['Everyone matches it', '🃏'],
    ['Shuffle, then vote', '🗳️'],
    ['Some, not all, should find it', '⚖️'],
    ['Everyone or nobody: no points', '🙅'],
    ['Votes count too', '🏆'],
  ],
  levels: {
    'A turn': 'basics',
    Scoring: 'basics',
    Winning: 'basics',
    'With three players': 'details',
  },
  options: { 'With three players': { key: 'three', label: '3 players' } },
  roleIcons: ['📖', '🃏'],
  room: (raw) => {
    const v = raw as ReverieView;
    if (!Array.isArray(v?.seats)) return undefined;
    const n = v.seats.filter((x) => x.playing).length;
    return {
      summary: `${n} ${n === 1 ? 'player' : 'players'} · first to ${v.settings.targetScore} points`,
      options: n === 3 ? ['three'] : [],
    };
  },
  reference: [
    {
      title: 'Scoring',
      head: ['What happened', 'Storyteller', 'Everyone else'],
      rows: [
        ['Everyone or nobody found it', '0', '2 each'],
        ['Some found it', '3', '3 for each finder'],
        ['Each vote your own card got', '—', '+1'],
      ],
    },
  ],
});
