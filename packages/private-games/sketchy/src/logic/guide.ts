import { type GameGuide, type GuideContext, type GuideFooter, shapeGuide } from '@vt/game-sdk';
import type { SketchyView } from './types.ts';

/**
 * The private `sketchy/manifest.json` (asset storage, never the repo) holds only the credit:
 * `{ credit?: { text?, url? } }`. Without it the guide has no credits.
 */
export interface Manifest {
  credit?: { text?: string; url?: string };
}

const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;

export function footerOf(manifest: unknown): GuideFooter | undefined {
  const m = (manifest && typeof manifest === 'object' ? manifest : {}) as Manifest;
  const credit = text(m.credit?.text, 400);
  if (!credit) return undefined;
  const url = text(m.credit?.url, 300);
  return {
    title: 'Credits',
    paragraphs: [credit],
    ...(url && /^https:\/\//.test(url) && { links: [{ label: 'Original game', href: url }] }),
  };
}

const base: GameGuide = {
  tagline:
    'Draw a secret prompt, write fake titles for everyone’s drawings, and spot the real one.',
  players: '3 to 8 (best with 4 to 8)',
  duration: '15–25 minutes',
  goal: 'Score the most points: by finding the real titles of other people’s drawings, by fooling them with your fake titles, and by drawing clearly enough that they find yours.',
  quickStart: [
    'Everyone gets a secret prompt and draws it at the same time.',
    'One drawing at a time comes up on every screen. Everyone but its artist writes a fake title for it.',
    'The real title is shuffled in with the fakes. Pick the one you think is real, and like the funny ones.',
    'The answers turn over one by one: who wrote each fake, who fell for it, and the truth last.',
    'Find the truth: 1,000. Fool someone: 500 each. Artist: 1,000 for everyone who found it.',
    'Two drawings each (one at a full table of 8). Most points wins.',
  ],
  setup: [
    'Up to 8 players can play; anyone else in the room watches. Use “Sit out (watch)” to sit out, and “Take a seat” to play again.',
    'The host picks the prompt packs, whether adult prompts are dealt, and the timers.',
    'The host presses Start. You need at least 3 players.',
  ],
  sections: [
    {
      title: 'A round, step by step',
      bullets: [
        'Draw: everyone draws their own secret prompt at once. Once a game you may swap it for a new one (🎲 New prompt) before sending.',
        'Each drawing then comes up on every screen, with a quick replay of its strokes. Nobody is told whose it is.',
        'Write: everyone but the artist writes a fake title that could pass for the real one.',
        'Pick: the real title is shuffled in with the fakes. Pick the one you think is real (never your own). You can change your pick until everyone has picked.',
        'Like: once you’ve picked, tap 👍 on titles that made you laugh. The artist can like titles too.',
        'Reveal: the picked fakes turn over one by one, showing who wrote each and who fell for it. The real title comes last, with its artist.',
        'The host moves on to the next drawing, then the next round.',
      ],
    },
    {
      title: 'Writing a fake title',
      bullets: [
        'Keep it short: one line, at most 45 characters. Everything on the board is shown in lowercase, real title included, so nobody stands out by their capitals.',
        'If your title is the real one (or too close to it), the game tells you privately and you write another. Capitals, accents, plurals, hyphens and apostrophes are ignored when checking.',
        'If two players write the same title, it shows once and counts for both of them, sharing the points. The game warns you so you can change it.',
        'Stuck? Press “Lie for me” and the game offers you two ready-made titles to choose from. Your pick counts as your fake but scores half. Type your own to replace it.',
      ],
    },
    {
      title: 'Scoring',
      bullets: [
        'Find the real title: 1,000 points.',
        'Streak: find it on several drawings in a row and you get 100 more for each drawing after the first (the third in a row: +200). Your own drawing doesn’t break a streak; a wrong pick or no pick does.',
        'Every player who picks your fake title: 500 points to you (shared when several of you wrote it, half for a ready-made one).',
        'The artist: 1,000 points for every player who found the real title. So draw clearly!',
        'In small games the board is topped up with house titles. They belong to nobody: picking one scores nothing.',
        'Likes are for fun: they score no points, but the most liked player gets an award at the end.',
        'After the last drawing, the highest score wins. Ties are shared.',
      ],
    },
    {
      title: 'Timers',
      paragraphs: [
        'The timers are reminders by default: 130 seconds to draw, 40 to write a title and 30 to pick, and the game waits for everyone. Each stage ends once everyone is in. The host can change each timer, or make them strict: then when time runs out, whatever you’ve drawn is sent (a blank page means no drawing this round), anyone without a fake title gets a ready-made one (worth half) while there are some, and anyone who hasn’t picked scores nothing and loses their streak.',
      ],
    },
    {
      title: 'Coming and going',
      bullets: [
        'Players who join during a game watch until the next round’s drawing starts.',
        'If a player leaves, a drawing they sent still comes up and still scores for them. A fake title still being written is dropped; once picking has started it stays on the board.',
        'If the game is stuck waiting for someone, the host can press “Continue without…”, which ends the stage as a strict timer would.',
        'The host can hide a drawing for everyone: it still plays, shown as hidden. Anyone can hide a drawing on their own screen.',
        'If fewer than 3 players are left, the game ends with the scores so far.',
      ],
    },
  ],
  tips: [
    'Draw what makes the title obvious, not what looks nice: you score when people find it.',
    'The best fake titles fit the drawing better than the real one.',
    'Real titles are often stranger than you think. Don’t rule out the weirdest one.',
  ],
  glossary: [
    { term: 'Prompt', meaning: 'The secret title you draw; on the board it’s the real title.' },
    { term: 'Fake title', meaning: 'A title written by a player to fool the others.' },
    {
      term: 'House title',
      meaning: 'A fake the game adds to fill a small board. It scores for nobody.',
    },
  ],
};

const shaped = (footer?: GuideFooter): GameGuide =>
  shapeGuide(base, {
    steps: [
      ['Draw your prompt', '✏️'],
      ['Write fake titles', '🤥'],
      ['Pick the real one', '🔎'],
      ['The reveal', '🎭'],
      ['Score three ways', '🧮'],
      ['Two drawings each', '🖼️'],
    ],
    levels: {
      'A round, step by step': 'basics',
      'Writing a fake title': 'basics',
      Scoring: 'basics',
    },
    reference: [
      {
        title: 'Scoring',
        head: ['You…', 'Points'],
        rows: [
          ['find the real title', '1,000'],
          ['…on several drawings in a row', '+100 per drawing after the first'],
          ['fool a player with your fake', '500 each'],
          ['fool one with a ready-made fake', '250 each'],
          ['are the artist', '1,000 per player who found it'],
          ['pick a house title', '0'],
          ['get a like', '0 (the Most liked award)'],
        ],
        note: 'A fake several players wrote shares its points.',
      },
      {
        title: 'Drawings each',
        head: ['Players', 'Drawings each'],
        rows: [
          ['3 to 7', '2'],
          ['8', '1'],
        ],
      },
    ],
    ...(footer && { footer }),
  });

/** The guide, with the manifest's credit when there is one. */
export function makeGuide(footer?: GuideFooter): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as SketchyView;
    if (!v?.settings) return undefined;
    const seated = v.game?.players.length ?? v.seats.filter((s) => s.playing).length;
    const s = v.settings;
    const clock = s.drawSeconds === null ? 'no drawing timer' : `${s.drawSeconds} s to draw`;
    return {
      summary: `${seated} players · ${clock} · ${s.timerMode === 'strict' ? 'strict timers' : 'reminder timers'}${s.adult ? ' · adult prompts' : ''}`,
    };
  };
  return { ...shaped(footer), room };
}

/** The guide without the manifest. */
export const guide: GameGuide = makeGuide();

/** The guide with the manifest's credit. */
export function nameGuide(manifest: unknown): GameGuide {
  return makeGuide(footerOf(manifest));
}
