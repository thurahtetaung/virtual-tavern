import type { GameGuide } from '@vt/game-sdk';
import { EVENT_NAMES, EVENT_TEXT } from './names.ts';
import { EVENT_KINDS } from './content.ts';

export const guide: GameGuide = {
  tagline:
    'A murder, a room full of suspects, and one expert who knows the answer but can only point.',
  players: '4 to 12',
  duration: '20–30 minutes',
  goal: 'The Investigators win by naming the Murderer’s exact Key Evidence (a Clue card) and Means of murder (a Means card). The Murderer, hiding among them, wins if nobody does by the end of the third round.',
  quickStart: [
    'Everyone but the Forensic Scientist holds Clue and Means cards, face up for all to see. One of you is the secret Murderer.',
    'At night the Murderer picks one of their own Clue cards and one of their own Means cards: that pair is the crime.',
    'The Forensic Scientist knows the crime but may only hint with bullets on the scene tiles. Talk it over as they land: their order can be a clue.',
    'Then the heart of the game: the whole table discusses the evidence together, before the Forensic Scientist starts the presentations.',
    'Think you know? Tap Solve and name one suspect’s Clue + Means. You get one attempt (your badge).',
    'Three rounds, each with a new tile and bullet. Nobody right by the end of round 3: the Murderer wins.',
  ],
  setup: [
    'Everyone sits down (4 to 12 players). The host chooses how the Forensic Scientist is picked: the host picks, at random, at random among volunteers, or the host picks from the volunteers. Anyone can tap “I’ll be the Forensic Scientist” in the lobby.',
    'With 6 or more players the Accomplice and the Witness are in by default; the host can switch them off (the Witness needs the Accomplice).',
    'Everyone else gets 4 Clue and 4 Means cards (the host can make it 3 + 3 for an easier game or 5 + 5 for a harder one) and one badge, their one attempt to solve.',
  ],
  roles: [
    {
      name: 'Forensic Scientist',
      summary:
        'Not a secret: everyone knows who the Forensic Scientist is, and their card is shown face up. Knows the answer and guides the table only with bullets on the scene tiles: never with words, faces or gestures. Wins with the Investigators.',
    },
    {
      name: 'Murderer',
      summary:
        'Chooses the crime from their own cards, then blends in and steers the table elsewhere. Wins if the crime is never named.',
    },
    {
      name: 'Accomplice',
      summary:
        '(6+ players) Knows the Murderer and the crime, and helps them get away with it. Wins with the Murderer.',
    },
    {
      name: 'Witness',
      summary:
        '(6+ players) Knows the two culprits, but not which is which. Helps the Investigators without being spotted: if the crime is solved, the culprits get one guess at who the Witness is.',
    },
    {
      name: 'Investigator',
      summary: 'Reads the bullets, studies the suspects’ cards and names the exact pair.',
    },
  ],
  sections: [
    {
      title: 'The night',
      paragraphs: [
        'The Murderer has 60 seconds to pick one of their own Clue cards (the Key Evidence) and one of their own Means cards. If time runs out, a pair is picked for them and they are told what it is. The Accomplice learns the crime too; the Witness learns who the two culprits are, in no particular order.',
      ],
    },
    {
      title: 'Collecting evidence',
      bullets: [
        'Round 1: the Forensic Scientist picks a Location tile. With the Cause of Death tile and 4 scene tiles, that makes 6 tiles, each listing 6 items.',
        'They place one bullet on each tile, one at a time, marking the item that best fits the crime. Bullets never move once placed.',
        'From the first bullet on, everyone but the Forensic Scientist talks freely, and the Forensic Scientist places the next bullets at their own pace, guided by what they hear. Everyone sees the order bullets land in: it can be a clue.',
        'Rounds 2 and 3: any events come first, then a new tile is drawn and replaces one of the scene tiles (never the Location or Cause of Death), and gets its own bullet.',
      ],
    },
    {
      title: 'Discussion (the heart of the game)',
      bullets: [
        'This is where cases are cracked: argue over what each bullet means, compare suspects’ cards, test theories out loud and watch who pushes which story. The Murderer is in the conversation too.',
        'Every round, once the last bullet is down, the table discusses the evidence before anyone presents. The round’s new bullets are highlighted.',
        'The host sets the discussion time in the lobby: 1, 2, 3 or 5 minutes (2 by default), or off. It is a reminder: nothing happens by itself at 0, the clock just turns red and nudges the Forensic Scientist.',
        'The Forensic Scientist taps Start presentations whenever the table is ready, early or late. If they are away, the host can start them.',
        'You can solve during the discussion.',
      ],
    },
    {
      title: 'Presentations',
      bullets: [
        'After the discussion, players present in turn, starting left of the Forensic Scientist: say which cards you suspect and why.',
        'Nobody interrupts a speaker, except to solve. Between presentations, talk as much as you like.',
        'The host picks the time per speaker and whether it is a reminder (the speaker taps Done, or the host skips) or strict (the turn passes by itself).',
      ],
    },
    {
      title: 'Solving',
      bullets: [
        'From the first bullet on, anyone but the Forensic Scientist can tap Solve: pick a suspect, then one of their Clue cards and one of their Means cards.',
        'Right: the Investigators win (unless the Reversal turns it round). Wrong: everyone sees it was wrong, and you have spent your badge. You keep presenting, but can’t solve again.',
        'The Murderer and the Accomplice may bluff with a solve of their own.',
        'If every badge is spent, the Murderer’s side wins at once.',
      ],
    },
    {
      title: 'The Reversal',
      paragraphs: [
        'When the Witness is in the game and the crime is solved, the Murderer and the Accomplice get 60 seconds to agree on who the Witness is (they see each other’s taps). The Murderer’s confirm is final. If they find the Witness, the Murderer’s side wins after all.',
      ],
    },
    {
      title: 'Events',
      paragraphs: [
        'With events on, six event tiles are shuffled into the pile after round 1. When one is drawn, it happens straight away, then another tile is drawn.',
      ],
      bullets: EVENT_KINDS.map((k) => `${EVENT_NAMES[k]}: ${EVENT_TEXT[k]}`),
    },
    {
      title: 'If someone drops out',
      bullets: [
        'A player who leaves keeps their cards on the table (a departed Murderer can still be caught) and their presentations are skipped.',
        'If the Forensic Scientist goes offline, the game waits and the host can hand over: a random Investigator becomes the new Forensic Scientist and sees the answer. Their cards stay on the table, but they can no longer solve or present.',
      ],
    },
  ],
  tips: [
    'Use the discussion: say your reading of every bullet out loud and challenge other people’s. A quiet table helps the Murderer.',
    'Long-press a card to mark it ⭐ suspicious or ✕ ruled out. Only you see your marks.',
    'The first bullets are usually the surest: a later bullet may be a compromise, after the table’s talk pulled the Forensic Scientist somewhere less clear.',
    'Murderer: present a confident theory about someone else, and don’t defend your own cards too hard.',
    'Witness: steer the table gently, or the culprits will name you in the Reversal.',
  ],
  glossary: [
    { term: 'Key Evidence', meaning: 'The Clue card the Murderer chose.' },
    { term: 'Means', meaning: 'The Means card the Murderer chose: how it was done.' },
    { term: 'Badge', meaning: 'Your one attempt to solve.' },
    { term: 'Bullet', meaning: 'The Forensic Scientist’s marker on one item of a tile.' },
    {
      term: 'Discussion',
      meaning:
        'The open talk after each round’s bullets, before the presentations: where the table works the case out together.',
    },
  ],
};
