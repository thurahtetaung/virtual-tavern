import type { RecapLine, RoomRecap } from '@vt/protocol';
import { describe, expect, it } from 'vitest';
import { chatText } from './copyText.ts';
import {
  FONTS,
  IMAGE_AWARDS,
  IMAGE_HEIGHT,
  IMAGE_NUGGETS,
  IMAGE_WIDTH,
  type ImageCard,
  type Measure,
  imageCard,
  imageName,
  layoutCard,
  wrapRuns,
} from './image.ts';

/** A fake `measureText`: 10 px a character, 12 in a bold font. */
const measure: Measure = (text, font) => [...text].length * (/^[78]00 /.test(font) ? 12 : 10);

const plain = (lines: { text: string }[][]) => lines.map((l) => l.map((r) => r.text).join(''));

describe('wrapping text', () => {
  it('breaks at spaces and never starts or ends a line with one', () => {
    const lines = wrapRuns([{ text: 'one two three four five' }], 100, measure, FONTS.body);
    expect(plain(lines)).toEqual(['one two', 'three four', 'five']);
  });

  it('measures names in the bold font and keeps them as their own runs', () => {
    const lines = wrapRuns(
      [{ text: 'Ana', name: true }, { text: ' shook hands with the assassin' }],
      160,
      measure,
      FONTS.body,
      FONTS.bodyBold,
    );
    expect(lines[0]).toEqual([{ text: 'Ana', name: true }, { text: ' shook hands' }]);
    expect(plain(lines)).toEqual(['Ana shook hands', 'with the', 'assassin']);
  });

  it('splits a word too long for any line', () => {
    const lines = wrapRuns([{ text: 'Supercalifragilistic!' }], 80, measure, FONTS.body);
    expect(plain(lines)).toEqual(['Supercal', 'ifragili', 'stic!']);
    for (const l of plain(lines)) expect(measure(l, FONTS.body)).toBeLessThanOrEqual(80);
  });

  it('copes with nothing at all', () => {
    expect(wrapRuns([], 100, measure, FONTS.body)).toEqual([]);
    expect(wrapRuns([{ text: '   ' }], 100, measure, FONTS.body)).toEqual([]);
  });
});

const award = (i: number, words = 4) => ({
  emoji: '🏅',
  title: `Award ${i}`,
  runs: [{ text: 'Ben', name: true }, { text: ` ${'did a thing '.repeat(words)}` }],
});

const card = (over: Partial<ImageCard> = {}): ImageCard => ({
  heading: 'Virtual Tavern · Tonight',
  sub: 'Sat 10 Oct · 3 games · 1h 05m',
  mix: '🎭 Masquerade ×3',
  moment: [{ text: '🫥 ' }, { text: 'Cy', name: true }, { text: ' blended in perfectly' }],
  mvp: {
    emoji: '👑',
    title: 'Night MVP',
    runs: [{ text: 'Ana', name: true }, { text: ' won 2 of 3' }],
  },
  awards: [1, 2, 3, 4].map((i) => award(i)),
  nuggets: [{ emoji: '🗳️', text: '31 votes cast', record: true }],
  ...over,
});

const texts = (ops: ReturnType<typeof layoutCard>['ops']) =>
  ops.flatMap((o) => (o.kind === 'text' ? [o.text] : []));

describe('laying out the card', () => {
  it('draws every section top to bottom inside the 1080×1350 canvas', () => {
    const out = layoutCard(card(), measure);
    expect(out.dropped).toBe(0);
    const all = texts(out.ops).join('\n');
    expect(all).toContain('🍻 Virtual Tavern · Tonight');
    expect(all).toContain('MOMENT OF THE NIGHT');
    expect(all).toContain('👑 Night MVP');
    expect(all).toContain('Award 4');
    expect(all).toContain('🆕 Room record');
    // The footer, and never a link.
    expect(texts(out.ops).at(-1)).toBe('🍻 virtual tavern');
    expect(all).not.toMatch(/https?:|\.\w{2,3}\//);
    for (const o of out.ops) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeLessThanOrEqual(IMAGE_HEIGHT);
      if (o.kind !== 'text') expect(o.x + o.w).toBeLessThanOrEqual(IMAGE_WIDTH);
    }
    // The sections sit in order down the page.
    const yOf = (text: string) =>
      out.ops.find((o) => o.kind === 'text' && o.text.includes(text))!.y;
    const order = ['Virtual Tavern', 'MOMENT', 'Night MVP', 'AWARDS', 'Award 4', 'BY THE NUMBERS'];
    const ys = order.map(yOf);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(yOf('virtual tavern')).toBeGreaterThan(yOf('31 votes'));
  });

  it('names are drawn bold in their own colour', () => {
    const named = layoutCard(card(), measure).ops.filter(
      (o) => o.kind === 'text' && o.color === 'name',
    );
    expect(named.map((o) => (o.kind === 'text' ? o.text : ''))).toEqual(
      expect.arrayContaining(['Cy', 'Ana', 'Ben']),
    );
    expect(named.every((o) => o.kind === 'text' && /Bold$/.test(o.font))).toBe(true);
  });

  it('leaves out the lowest awards rather than running off the bottom', () => {
    const long = card({ awards: Array.from({ length: IMAGE_AWARDS }, (_, i) => award(i + 1, 12)) });
    const out = layoutCard(long, measure);
    expect(out.dropped).toBeGreaterThan(0);
    expect(out.bottom).toBeLessThanOrEqual(IMAGE_HEIGHT - 72);
    const all = texts(out.ops);
    expect(all).toContain('🏅 Award 1');
    expect(all).not.toContain(`🏅 Award ${IMAGE_AWARDS}`);
  });

  it('a long moment is cut to four lines', () => {
    const words = Array.from({ length: 200 }, () => 'word').join(' ');
    const out = layoutCard(card({ moment: [{ text: words }], awards: [] }), measure);
    const moment = out.ops.filter((o) => o.kind === 'text' && o.font === 'hero');
    expect(moment).toHaveLength(4);
  });
});

describe('the image content', () => {
  const line = (n: number): RecapLine => ({
    awardId: `a${n}`,
    emoji: '⭐',
    title: `Star ${n}`,
    text: `{p:ana} shone ${n} times`,
    players: ['ana'],
    valence: 'glory',
  });
  const recap: RoomRecap = {
    nightKey: 'K',
    status: 'wrapped',
    tone: 'cheeky',
    startedAt: Date.UTC(2026, 9, 10, 19),
    endedAt: Date.UTC(2026, 9, 10, 21),
    running: 0,
    abandoned: 0,
    games: [
      {
        gameNo: 1,
        gameId: 'masquerade',
        startedAt: 0,
        durationMs: 30 * 60_000,
        players: [],
        winners: [],
        lines: [],
        history: [],
      },
      {
        gameNo: 1,
        gameId: 'codenames',
        startedAt: 0,
        durationMs: 20 * 60_000,
        players: [],
        winners: [],
        lines: [],
        history: [],
        elsewhere: true,
      },
    ],
    players: [{ id: 'ana', name: 'Ana', played: 2 }],
    audience: [],
    moment: { ...line(0), emoji: '🎬', text: 'At {loc:e1-07}, {p:ana} stole it' },
    awards: Array.from({ length: 12 }, (_, i) => line(i + 1)),
    nuggets: Array.from({ length: 5 }, (_, i) => ({ emoji: '🔢', text: `${i} things` })),
  };

  it('resolves names and private ids here, and keeps to 8 awards and 3 numbers', () => {
    const out = imageCard(recap, {
      heading: 'Virtual Tavern · Last night',
      names: new Map([['ana', 'Ana']]),
      labels: (kind, id) => (kind === 'loc' && id === 'e1-07' ? 'Lighthouse' : undefined),
      gameInfo: (id) => ({ name: id === 'codenames' ? 'Codenames' : 'Masquerade', icon: '🎲' }),
    });
    expect(out.awards).toHaveLength(IMAGE_AWARDS);
    expect(out.nuggets).toHaveLength(IMAGE_NUGGETS);
    expect(out.moment?.map((r) => r.text).join('')).toBe('🎬 At Lighthouse, Ana stole it');
    expect(out.awards[0]!.runs).toEqual([{ text: 'Ana', name: true }, { text: ' shone 1 times' }]);
    expect(out.mix).toBe('🎲 Masquerade ×1 · 🎲 Codenames ×1');
    expect(out.sub).toBe('Sat 10 Oct · 2 games · 50m');
    expect(JSON.stringify(out)).not.toMatch(/\{(p|loc):/);
  });

  it('carries no link to the site, in the picture or the chat text', () => {
    const opts = {
      heading: 'Virtual Tavern · Last night',
      names: new Map([['ana', 'Ana']]),
      labels: null,
      gameInfo: (id: string) => ({ name: id, icon: '🎲' }),
    };
    const drawn = layoutCard(imageCard(recap, opts), measure)
      .ops.flatMap((op) => (op.kind === 'text' ? [op.text] : []))
      .join('\n');
    const chat = chatText(recap, opts);
    for (const text of [drawn, chat]) {
      expect(text).toContain('Ana');
      expect(text).not.toMatch(/https?:|www\.|\/\/|\.(com|net|org|app|io|xyz|dev)\b/i);
    }
  });

  it('names the file after the night', () => {
    expect(imageName(new Date(2026, 9, 11, 21).getTime())).toBe('tavern-night-2026-10-11.png');
  });
});
