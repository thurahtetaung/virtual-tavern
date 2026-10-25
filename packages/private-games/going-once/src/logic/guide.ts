import type { GameGuide, GuideContext, GuideFooter } from '@vt/game-sdk';
import { type Manifest, footerOf, namesOf } from './manifest.ts';
import { type Names, PLACEHOLDER_NAMES, fillNames } from './names.ts';
import type { GoingOnceView } from './types.ts';

export { type Manifest, footerOf, namesOf } from './manifest.ts';

/** Every string in the guide with its name tokens filled. */
function fill<T>(value: T, names: Names): T {
  if (typeof value === 'string') return fillNames(value, names) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => fill(v, names)) as T;
  if (value && typeof value === 'object' && typeof value !== 'function') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, typeof v === 'function' ? v : fill(v, names)]),
    ) as T;
  }
  return value;
}

const PACE_LABEL = { relaxed: 'relaxed', normal: 'normal', fast: 'fast' } as const;

const base: GameGuide = {
  tagline: 'Draw two quick pictures, then bid on everyone’s art in live auctions. Most money wins.',
  players: '3 to 6 (4 to 6 is best)',
  duration: '15 minutes',
  goal: 'End with the most money: your cash, plus what the drawings you bought are worth, minus anything you owe {bank}.',
  quickStart: [
    'Everyone draws two pictures from secret titles. Titles in a game come in two families that look alike.',
    'Each player’s two drawings are worth $4,500 together: one is worth $3,000–$4,000, the other the rest.',
    'Your wish list tells you the true value of three drawings, but not which picture is which. That’s the puzzle.',
    'Each drawing goes up for a live auction. Bid +$100, +$200 or +$300; the clock restarts after every bid.',
    'The artist earns half of what their drawing sells for (nothing if they buy it themselves).',
    'From half-time, your one screw forces another player to bid. Short of cash? Call {bank} for a loan.',
  ],
  steps: [
    {
      title: 'Draw two titles',
      text: 'You get two secret titles to draw in 90 seconds. Every title has lookalike siblings drawn by others, so a doodle could be any of them.',
      icon: '✏️',
    },
    {
      title: 'Pairs worth $4,500',
      text: 'Your two drawings are worth $4,500 together: one high ($3,000–$4,000) and one low (the rest). Once one sells, everyone can work out the other.',
      icon: '💵',
    },
    {
      title: 'Your wish list',
      text: 'Three drawings with their true values: their titles, not their pictures. Match a picture to a title and you know what it’s worth.',
      icon: '📜',
    },
    {
      title: 'Live auctions',
      text: 'Each drawing is up for a few seconds. Bid +$100, +$200 or +$300. Going once, going twice: any bid restarts the clock. No bid, no sale.',
      icon: '🔨',
    },
    {
      title: 'Artists get half',
      text: 'Whoever buys your drawing pays you half its price as commission. Bidding up your own is allowed, but buy it and you get nothing.',
      icon: '🎨',
    },
    {
      title: 'Screws and loans',
      text: 'From half-time, your one screw forces someone to bid $100 more. Low on cash? {Bank} lends $1,000, and you owe $1,500 at the end.',
      icon: '🔩',
    },
  ],
  stepsDone: 'Your first lot comes with tips. Tap 📖 Rules any time to read the details.',
  setup: [
    'Everyone sits down; 3 to 6 can play, others can watch.',
    'Everyone starts with $3,000 cash and one screw. The app deals the titles and keeps every value secret.',
  ],
  sections: [
    {
      title: 'Drawing',
      level: 'basics',
      bullets: [
        'You get two titles, one from each of the game’s two title families, and one clock for both (90 seconds by default).',
        'Pick a pen, a width, draw, and tap Send. You must draw something to send it.',
        'Nobody else sees your title, ever, until your drawing is sold.',
        'A drawing not sent in time is replaced by a house picture of the same title, and you lose the commission on it.',
        'The auctioneer nudges you at half time and with ten seconds left; whatever is on your page is sent when time runs out.',
      ],
    },
    {
      title: 'What the drawings are worth',
      level: 'basics',
      bullets: [
        'Each player’s two drawings are worth $4,500 together. One, picked at random, is worth $3,000–$4,000; the other the rest ($500–$1,500).',
        'Nobody is told what their own drawings are worth.',
        'At 3 to 5 players the house adds one extra drawing to each family, worth anything from $500 to $4,500. They have no artist.',
        'There are 2 lots per player, plus 2 house lots at 3 to 5 players: 8, 10 or 12 in all.',
      ],
    },
    {
      title: 'Your wish list',
      level: 'basics',
      bullets: [
        'When the drawing ends, you get three titles with their true values: one high-value drawing nobody else knows, and two low ones (one of which someone else also knows).',
        'Never your own drawings and never the house’s.',
        'You don’t know which picture is which title: that is the puzzle. Every value on it is true.',
      ],
    },
    {
      title: 'The auction',
      level: 'basics',
      bullets: [
        'Lots go up one at a time, the first family’s drawings first. Every phone shows the drawing, the top bid and who holds it.',
        'Before any bid the buttons offer $400, $500 and $600; after a bid of $B, $B+100, $B+200 and $B+300.',
        'You can’t raise your own top bid, and you can’t bid more cash than you have.',
        'The clock: about 8 seconds to open, then 4 seconds of quiet after each bid, then “Going once” and “Going twice” (2 seconds each; at the Normal pace 1.5 once the price passes $1,000), then Sold. Any bid restarts the quiet.',
        'If two bids arrive together, the first one the server gets wins; the other player sees the new price and why their bid didn’t count.',
        'No bid at all: the drawing goes unsold and its value is lost to everyone.',
      ],
    },
    {
      title: 'Sold',
      level: 'basics',
      bullets: [
        'The buyer pays the price from their cash. The drawing’s value is not cash: it counts at the end.',
        'Everyone then sees the title, its true value, the artist and the price paid.',
        'The artist earns half the price (rounded down) as commission, unless they bought it themselves. House drawings pay nobody.',
        'An unsold lot shows “Unsold – it was worth $X”. Its artist stays secret until the end.',
      ],
    },
    {
      title: 'Hints',
      level: 'details',
      bullets: [
        'Before each lot, everyone gets one message from an art buyer, {bank} or a passer-by.',
        'Useful ones are always true: “this one is yours”, “Ana knows what this one is worth”, “the most valuable drawing hasn’t sold yet”, “I’ll pay $3,400 for a drawing by Ben”, who is leading, who is short of cash.',
        'The rest is chatter. Only one player per lot is told who knows it.',
      ],
    },
    {
      title: 'Screws',
      level: 'details',
      bullets: [
        'Screws unlock at half-time. Everyone has one for the whole game.',
        'Press Screw during a lot and the clock pauses while you pick a player (15 seconds). The screw is spent as soon as you press it.',
        'Your target is forced to bid $100 more than the top bid ($400 with no bid yet). If they can’t afford it, or you pick nobody, the screw is wasted.',
        'You can’t screw the top bidder. While a forced bid leads, nobody can screw until someone makes a free bid.',
        'You can screw an artist into bidding on their own drawing.',
      ],
    },
    {
      title: 'Loans',
      level: 'details',
      bullets: [
        '{Bank} first opens by itself between lots as soon as anyone has $1,000 or less, for 30 seconds.',
        'After that, anyone can tap Call {bank} during a lot (at most 3 times a game, not on the last lot); it opens once the lot is sold, for 10 seconds.',
        'At each visit, everyone may take one loan: $1,000 now, $1,500 owed at the end. At most 3 loans a game.',
        'There’s no paying back early: debt comes off your money at the end.',
      ],
    },
    {
      title: 'The end',
      level: 'details',
      bullets: [
        'After the last lot, your money is your cash plus the value of every drawing you bought, minus your debt.',
        'The most money wins; ties share the win. The gallery shows every drawing with its title, value and price.',
        'Others’ cash stays secret until the end, though you can work much of it out from the prices.',
      ],
    },
    {
      title: 'Host options',
      level: 'edge',
      bullets: [
        'Drawing time: 60, 90 (default) or 120 seconds for both drawings.',
        'Auction pace: Relaxed, Normal (default) or Fast. Relaxed gives everyone longer before each Sold; Fast suits players who know the game.',
        'The host can hide a drawing for everyone; it still sells, shown as hidden. Anyone can hide a drawing on their own screen.',
        'Between lots the host can tap Next to skip a wait.',
        'The how-to shows in a room’s first game only; anyone can skip it.',
      ],
    },
    {
      title: 'Coming and going',
      level: 'edge',
      bullets: [
        'Players joining during a game watch, and are seated at the next one if there is room.',
        'Someone who leaves keeps their seat, cash and drawings; they just stop bidding. If they come back, they carry on. A drawing they didn’t send becomes a house picture.',
        'If nobody sends a single drawing, everyone gets new titles and draws again. If nobody draws that time either, the game ends with nothing auctioned.',
      ],
    },
  ],
  tips: [
    'Once a player’s drawing sells, their other one is worth exactly $4,500 minus its value. Keep track.',
    'Bid on your own drawing to push the price up, but don’t win it: you’d pay full price for no commission.',
    'A player bidding hard probably knows the value. A buyer may even tell you who knows.',
    'Save your screw for someone with cash who isn’t leading the bid.',
  ],
  glossary: [
    { term: 'Lot', meaning: 'One drawing up for auction.' },
    {
      term: 'Commission',
      meaning: 'Half the price, paid to the artist when someone else buys their drawing.',
    },
    {
      term: 'House drawing',
      meaning: 'An extra drawing (or one a player didn’t send) with no artist.',
    },
    { term: 'Screw', meaning: 'Your one chance from half-time to force another player to bid.' },
  ],
  reference: [
    {
      title: 'Money',
      head: ['', 'Amount'],
      rows: [
        ['Starting cash', '$3,000'],
        ['A player’s two drawings', '$4,500 together ($3,000–$4,000 + the rest)'],
        ['House drawing', '$500–$4,500'],
        ['Opening bid', '$400'],
        ['Raises', '+$100, +$200 or +$300'],
        ['Commission', 'Half the price (none on your own)'],
        ['Loan', '+$1,000 cash, +$1,500 debt (3 at most)'],
      ],
    },
    {
      title: 'The clock (Normal pace)',
      head: ['Step', 'Seconds'],
      rows: [
        ['Before the first bid', '8'],
        ['After a bid', '4'],
        ['Going once', '2'],
        ['Going twice', '2, then Sold'],
        ['Going once / twice above $1,000', '1.5 each (Normal pace)'],
      ],
    },
  ],
};

/** The guide in the given names. */
export function makeGuide(names: Names = PLACEHOLDER_NAMES, footer?: GuideFooter): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as GoingOnceView;
    if (!v?.settings) return undefined;
    const seated = v.game?.players.length ?? v.seats.filter((s) => s.playing).length;
    return {
      summary: `${seated} players · ${v.settings.drawSeconds} s to draw · ${PACE_LABEL[v.settings.pace]} pace`,
    };
  };
  return { ...fill(base, names), ...(footer && { footer }), room };
}

/** The guide without the manifest. */
export const guide: GameGuide = makeGuide();

/** The guide in the manifest's names, with its credit. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = (manifest && typeof manifest === 'object' ? manifest : null) as Manifest | null;
  return makeGuide(namesOf(m), footerOf(m));
}
