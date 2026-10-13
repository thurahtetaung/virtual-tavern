import type { RecapLine, RoomRecap } from '@vt/protocol';
import { type GameInfo, duration, gameMix, nightDate, playedMs } from './copyText.ts';
import { type Labeler, resolveSegments, resolveText } from './resolve.ts';

/**
 * "Save image": the night card drawn by hand on a 1080×1350 (4:5) canvas, which suits group
 * chats. Text and emoji only (never a back-room picture), with names resolved on this device.
 * The layout is pure (it takes a `measure` function), so it is tested without a canvas.
 */

export const IMAGE_WIDTH = 1080;
export const IMAGE_HEIGHT = 1350;
const PAD = 72;
const INNER = IMAGE_WIDTH - PAD * 2;
/** Most award lines the image shows. */
export const IMAGE_AWARDS = 8;
/** Most numbers the image shows. */
export const IMAGE_NUGGETS = 3;
const FOOTER = '🍻 virtual tavern';

const EMOJI = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'";
const SERIF = `ui-serif, Georgia, Cambria, 'Times New Roman', serif, ${EMOJI}`;
const SANS = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif, ${EMOJI}`;

/** The fonts the layout uses, as canvas font strings. */
export const FONTS = {
  title: `700 52px ${SERIF}`,
  sub: `400 30px ${SANS}`,
  label: `700 24px ${SANS}`,
  hero: `600 36px ${SANS}`,
  heroBold: `800 36px ${SANS}`,
  awardTitle: `700 31px ${SANS}`,
  body: `400 29px ${SANS}`,
  bodyBold: `700 29px ${SANS}`,
  nugget: `400 28px ${SANS}`,
  footer: `600 28px ${SERIF}`,
} as const;
type Font = keyof typeof FONTS;

/** Line heights per font, in pixels. */
const LEADING: Record<Font, number> = {
  title: 62,
  sub: 40,
  label: 32,
  hero: 48,
  heroBold: 48,
  awardTitle: 40,
  body: 38,
  bodyBold: 38,
  nugget: 38,
  footer: 36,
};

export interface ImageTheme {
  bg: string;
  text: string;
  muted: string;
  name: string;
  accent: string;
  heroBg: string;
  heroText: string;
  card: string;
  rule: string;
  mvpBg: string;
  mvpRing: string;
  badgeBg: string;
  badgeText: string;
}
type Color = keyof ImageTheme;

/** The app's stone and amber palette, light. */
export const LIGHT: ImageTheme = {
  bg: '#f5f5f4',
  text: '#1c1917',
  muted: '#78716c',
  name: '#92400e',
  accent: '#b45309',
  heroBg: '#fef3c7',
  heroText: '#451a03',
  card: '#ffffff',
  rule: '#e7e5e4',
  mvpBg: '#fffbeb',
  mvpRing: '#fde68a',
  badgeBg: '#fde68a',
  badgeText: '#78350f',
};

/** The same palette, dark. */
export const DARK: ImageTheme = {
  bg: '#0c0a09',
  text: '#f5f5f4',
  muted: '#a8a29e',
  name: '#fcd34d',
  accent: '#fbbf24',
  heroBg: '#292524',
  heroText: '#f5f5f4',
  card: '#1c1917',
  rule: '#292524',
  mvpBg: '#2a2116',
  mvpRing: '#6b4f1d',
  badgeBg: '#78350f',
  badgeText: '#fde68a',
};

/** A piece of text: plain, or a player's name (bold and coloured). */
export interface Run {
  text: string;
  name?: boolean;
}

export interface ImageAward {
  emoji: string;
  title: string;
  runs: Run[];
}

/** What the image shows, already resolved and in the chosen tone. */
export interface ImageCard {
  /** "Virtual Tavern · Tonight". */
  heading: string;
  /** "Sat 11 Oct · 4 games · 1h 52m". */
  sub: string;
  /** "🎭 Masquerade ×3 · 🕵️ Codenames ×2". */
  mix: string;
  moment?: Run[];
  mvp?: ImageAward;
  awards: ImageAward[];
  nuggets: { emoji: string; text: string; record?: boolean }[];
}

/** Measures text in a font (the canvas's `measureText`, or a fake in tests). */
export type Measure = (text: string, font: string) => number;

/** Builds the image's content from a recap, with names and private ids resolved here. */
export function imageCard(
  recap: RoomRecap,
  opts: {
    heading: string;
    names: ReadonlyMap<string, string>;
    labels: Labeler | null;
    gameInfo: (gameId: string) => GameInfo;
  },
): ImageCard {
  const runs = (text: string): Run[] =>
    resolveSegments(text, opts.names, opts.labels).map((s) =>
      s.name ? { text: s.text, name: true } : { text: s.text },
    );
  const award = (l: RecapLine): ImageAward => ({
    emoji: l.emoji,
    title: resolveText(l.title, opts.names, opts.labels),
    runs: runs(l.text),
  });
  const n = recap.games.length;
  return {
    heading: opts.heading,
    sub: `${nightDate(recap.startedAt)} · ${n} ${n === 1 ? 'game' : 'games'} · ${duration(playedMs(recap))}`,
    mix: gameMix(recap, opts.gameInfo),
    ...(recap.moment && {
      moment: [{ text: `${recap.moment.emoji} ` }, ...runs(recap.moment.text)],
    }),
    ...(recap.mvp && { mvp: award(recap.mvp) }),
    awards: recap.awards.slice(0, IMAGE_AWARDS).map(award),
    nuggets: recap.nuggets.slice(0, IMAGE_NUGGETS).map((g) => ({
      emoji: g.emoji,
      text: resolveSegments(g.text, opts.names, opts.labels)
        .map((s) => s.text)
        .join(''),
      ...(g.record && { record: true }),
    })),
  };
}

// ---- Layout ----

/** One word (or space) with its style. */
interface Token extends Run {
  width: number;
}

/**
 * Word-wraps styled runs to `maxWidth`: names use `boldFont`, the rest `font`. Breaks only at
 * spaces, unless a single word is too wide for a line on its own. Returns the lines.
 */
export function wrapRuns(
  runs: readonly Run[],
  maxWidth: number,
  measure: Measure,
  font: string,
  boldFont = font,
): Run[][] {
  const tokens: Token[] = [];
  for (const r of runs) {
    const f = r.name ? boldFont : font;
    for (const part of r.text.split(/(\s+)/)) {
      if (!part) continue;
      // A word wider than a whole line is split into pieces that fit.
      let rest = part;
      while (rest && !/^\s+$/.test(rest) && measure(rest, f) > maxWidth) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut), f) > maxWidth) cut--;
        tokens.push({
          text: rest.slice(0, cut),
          name: r.name,
          width: measure(rest.slice(0, cut), f),
        });
        rest = rest.slice(cut);
      }
      if (rest) tokens.push({ text: rest, name: r.name, width: measure(rest, f) });
    }
  }
  const lines: Token[][] = [];
  let line: Token[] = [];
  let width = 0;
  for (const t of tokens) {
    const space = /^\s+$/.test(t.text);
    if (space && !line.length) continue;
    if (!space && line.length && width + t.width > maxWidth) {
      while (line.length && /^\s+$/.test(line.at(-1)!.text)) line.pop();
      lines.push(line);
      line = [];
      width = 0;
    }
    line.push(t);
    width += t.width;
  }
  while (line.length && /^\s+$/.test(line.at(-1)!.text)) line.pop();
  if (line.length) lines.push(line);
  // Neighbouring tokens of the same style become one run per line.
  return lines.map((l) =>
    l.reduce<Run[]>((out, t) => {
      const last = out.at(-1);
      if (last && !!last.name === !!t.name) last.text += t.text;
      else out.push(t.name ? { text: t.text, name: true } : { text: t.text });
      return out;
    }, []),
  );
}

/** A drawing step, in canvas pixels; colours are theme keys. */
export type Op =
  | { kind: 'text'; x: number; y: number; font: Font; color: Color; text: string; align?: 'center' }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number; color: Color }
  | { kind: 'stroke'; x: number; y: number; w: number; h: number; r: number; color: Color };

export interface Layout {
  ops: Op[];
  /** Where the content ends (before the footer). */
  bottom: number;
  /** Award lines left out to fit (the lowest ones go first). */
  dropped: number;
}

/**
 * Lays out the card top to bottom. Awards that would run past the footer are left out, the
 * lowest first; if even the awardless card is too tall, the numbers go too.
 */
export function layoutCard(card: ImageCard, measure: Measure): Layout {
  const limit = IMAGE_HEIGHT - PAD - LEADING.footer - 24;
  for (let awards = card.awards.length; awards >= 0; awards--) {
    const out = place({ ...card, awards: card.awards.slice(0, awards) }, measure);
    if (out.bottom <= limit)
      return { ...withFooter(out.ops), bottom: out.bottom, dropped: card.awards.length - awards };
  }
  const bare = place({ ...card, awards: [], nuggets: [] }, measure);
  return { ...withFooter(bare.ops), bottom: bare.bottom, dropped: card.awards.length };
}

function withFooter(ops: Op[]): { ops: Op[] } {
  return {
    ops: [
      ...ops,
      {
        kind: 'text',
        x: IMAGE_WIDTH / 2,
        y: IMAGE_HEIGHT - PAD,
        font: 'footer',
        color: 'muted',
        text: FOOTER,
        align: 'center',
      },
    ],
  };
}

/** Places every section; returns the steps and where the content ends. */
function place(card: ImageCard, measure: Measure): { ops: Op[]; bottom: number } {
  const ops: Op[] = [];
  let y = PAD;
  const text = (font: Font, color: Color, s: string, x = PAD) => {
    ops.push({ kind: 'text', x, y: y + LEADING[font] * 0.78, font, color, text: s });
    y += LEADING[font];
  };
  /** Wrapped styled text; names bold in the name colour. */
  const runs = (
    rs: readonly Run[],
    font: Font,
    bold: Font,
    color: Color,
    x: number,
    width: number,
    maxLines = Infinity,
  ) => {
    const lines = wrapRuns(rs, width, measure, FONTS[font], FONTS[bold]).slice(0, maxLines);
    for (const line of lines) {
      let cx = x;
      for (const r of line) {
        const f = r.name ? bold : font;
        ops.push({
          kind: 'text',
          x: cx,
          y: y + LEADING[font] * 0.78,
          font: f,
          color: r.name ? 'name' : color,
          text: r.text,
        });
        cx += measure(r.text, FONTS[f]);
      }
      y += LEADING[font];
    }
  };
  const label = (s: string) => {
    y += 18;
    text('label', 'muted', s.toUpperCase());
    y += 8;
  };

  text('title', 'accent', `🍻 ${card.heading}`);
  y += 4;
  text('sub', 'muted', card.sub);
  if (card.mix) runs([{ text: card.mix }], 'sub', 'sub', 'text', PAD, INNER, 2);

  if (card.moment) {
    label('🎬 Moment of the night');
    const top = y;
    const box = ops.length;
    y += 24;
    runs(card.moment, 'hero', 'heroBold', 'heroText', PAD + 40, INNER - 72, 4);
    y += 24;
    ops.splice(
      box,
      0,
      { kind: 'rect', x: PAD, y: top, w: INNER, h: y - top, r: 20, color: 'heroBg' },
      { kind: 'rect', x: PAD, y: top, w: 10, h: y - top, r: 5, color: 'accent' },
    );
  }

  if (card.mvp) {
    y += 24;
    const top = y;
    const box = ops.length;
    y += 20;
    text('awardTitle', 'text', `${card.mvp.emoji} ${card.mvp.title}`, PAD + 28);
    runs(card.mvp.runs, 'body', 'bodyBold', 'text', PAD + 28, INNER - 56, 2);
    y += 20;
    ops.splice(
      box,
      0,
      { kind: 'rect', x: PAD, y: top, w: INNER, h: y - top, r: 20, color: 'mvpBg' },
      { kind: 'stroke', x: PAD, y: top, w: INNER, h: y - top, r: 20, color: 'mvpRing' },
    );
  }

  if (card.awards.length) {
    label('Awards');
    const top = y;
    const box = ops.length;
    card.awards.forEach((a, i) => {
      if (i) ops.push({ kind: 'rect', x: PAD + 24, y, w: INNER - 48, h: 2, r: 0, color: 'rule' });
      y += 14;
      text('awardTitle', 'text', `${a.emoji} ${a.title}`, PAD + 28);
      runs(a.runs, 'body', 'bodyBold', 'muted', PAD + 28, INNER - 56, 2);
      y += 12;
    });
    ops.splice(box, 0, {
      kind: 'rect',
      x: PAD,
      y: top,
      w: INNER,
      h: y - top,
      r: 20,
      color: 'card',
    });
  }

  if (card.nuggets.length) {
    label('By the numbers');
    for (const n of card.nuggets) {
      const badge = n.record ? '🆕 Room record' : '';
      const badgeW = badge ? measure(badge, FONTS.label) + 28 : 0;
      const lines = wrapRuns(
        [{ text: `${n.emoji} ${n.text}` }],
        INNER - badgeW - 16,
        measure,
        FONTS.nugget,
      );
      const first = y;
      for (const line of lines.slice(0, 2))
        text('nugget', 'text', line.map((r) => r.text).join(''));
      if (badge) {
        const bx = IMAGE_WIDTH - PAD - badgeW;
        ops.push(
          { kind: 'rect', x: bx, y: first + 2, w: badgeW, h: 34, r: 17, color: 'badgeBg' },
          {
            kind: 'text',
            x: bx + 14,
            y: first + 28,
            font: 'label',
            color: 'badgeText',
            text: badge,
          },
        );
      }
    }
  }
  return { ops, bottom: y };
}

// ---- Drawing ----

/** The device's theme: the app's own setting, else the system's. */
export function deviceTheme(): ImageTheme {
  const set = document.documentElement.dataset.theme;
  if (set === 'dark' || set === 'light') return set === 'dark' ? DARK : LIGHT;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
}

function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Draws the card onto a new canvas and returns it as a PNG. */
export async function renderRecapImage(card: ImageCard, theme: ImageTheme): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas here.');
  const measure: Measure = (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const { ops } = layoutCard(card, measure);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  ctx.textBaseline = 'alphabetic';
  for (const op of ops) {
    if (op.kind === 'text') {
      ctx.font = FONTS[op.font];
      ctx.fillStyle = theme[op.color];
      ctx.textAlign = op.align ?? 'left';
      ctx.fillText(op.text, op.x, op.y);
    } else if (op.kind === 'rect') {
      ctx.fillStyle = theme[op.color];
      rounded(ctx, op.x, op.y, op.w, op.h, op.r);
      ctx.fill();
    } else {
      ctx.strokeStyle = theme[op.color];
      ctx.lineWidth = 2;
      rounded(ctx, op.x, op.y, op.w, op.h, op.r);
      ctx.stroke();
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No image.'))), 'image/png'),
  );
}

/** "tavern-night-2026-10-11.png", from the night's start. */
export const imageName = (startedAt: number) => {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `tavern-night-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.png`;
};

/**
 * Saves the image: the share sheet on a phone (it offers "Save Image" and the chat apps), a
 * download elsewhere, and as a last resort the image on its own, to long-press and save.
 */
export async function saveImage(
  blob: Blob,
  name: string,
): Promise<'shared' | 'downloaded' | 'opened' | 'cancelled'> {
  const file = new File([blob], name, { type: 'image/png' });
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Refused (no user activation left, say): fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if ('download' in HTMLAnchorElement.prototype) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    return 'downloaded';
  }
  window.open(url, '_blank');
  return 'opened';
}
