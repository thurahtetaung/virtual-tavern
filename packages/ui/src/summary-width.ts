/**
 * An estimate of whether a guests' settings summary fits its two lines on a phone, for tests: the
 * screen itself measures (`LobbySettings`), but a test can't. Widths are Arial's (Liberation Sans)
 * at 14 px, close to the phones' own Roboto, plus 5% for San Francisco, which runs a little wider;
 * the layout is `LobbySettings` at 360 or 390 px (it matches the live check's measurements). Where
 * a wider fallback font is all there is (DejaVu Sans on some Linux boxes), the screen shows fewer
 * parts and counts the rest, never an ellipsis.
 */

// Advance widths of ' ' to '~' (32 to 126), regular weight, in px.
const ASCII =
  '3.89 3.89 4.97 7.79 7.79 12.45 9.34 2.67 4.66 4.66 5.45 8.18 3.89 4.66 3.89 3.89 7.79 7.79 7.79 7.79 7.79 7.79 7.79 7.79 7.79 7.79 3.89 3.89 8.18 8.18 8.18 7.79 14.21 9.34 9.34 10.11 10.11 9.34 8.55 10.89 10.11 3.89 7 9.34 7.79 11.66 10.11 10.89 9.34 10.89 10.11 9.34 8.55 10.11 9.34 13.21 9.34 9.34 8.55 3.89 3.89 3.89 6.57 7.79 4.66 7.79 7.79 7 7.79 7.79 3.89 7.79 7.79 3.11 3.11 7 3.11 11.66 7.79 7.79 7.79 7.79 4.66 7 3.89 7.79 7 10.11 7 7 7 4.68 3.64 4.68 8.18'
    .split(' ')
    .map(Number);
const OTHER: Record<string, number> = {
  '×': 8.18,
  '·': 4.66,
  '’': 3.11,
  '…': 14,
  '–': 7.79,
  '—': 14,
};
/** Allowance for wider phone fonts; the bold title is about 10% wider; an emoji is about 17 px. */
const MARGIN = 1.05;
const BOLD = 1.1;
const EMOJI = 17;

function charWidth(ch: string): number {
  const code = ch.codePointAt(0)!;
  if (code >= 32 && code <= 126) return ASCII[code - 32]!;
  if (OTHER[ch] !== undefined) return OTHER[ch];
  if (code > 0x2000 && /\p{Extended_Pictographic}/u.test(ch)) return EMOJI;
  // Accented Latin letters are about as wide as their base letter.
  const base = ch.normalize('NFD')[0]!;
  return base !== ch ? charWidth(base) : 9;
}

export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text.replace(/\uFE0F/g, '')) w += charWidth(ch);
  return w * MARGIN;
}

/** Lines `text` takes at `width` px, wrapping at spaces as the browser does. */
export function linesAt(text: string, width: number): number {
  const space = textWidth(' ');
  let lines = 1;
  let used = 0;
  for (const word of text.split(' ')) {
    const w = textWidth(word);
    if (used > 0 && used + space + w > width) {
      lines++;
      used = 0;
    }
    used += (used > 0 ? space : 0) + w;
    // A word wider than the line breaks across lines too.
    while (used > width) {
      lines++;
      used -= width;
    }
  }
  return lines;
}

/** The summary's width: card and summary padding, the bold title, the two gaps and the ▾. */
export function summaryWidth(title: string, viewport = 360): number {
  return viewport - 2 * 16 - 2 * 16 - EMOJI - textWidth(` ${title}`) * BOLD - 2 * 8 - 8;
}

/** Whether `text` fits the two summary lines next to `title` at `viewport` px. */
export function summaryFits(text: string, title = 'Settings', viewport = 360): boolean {
  return linesAt(text, summaryWidth(title, viewport)) <= 2;
}
