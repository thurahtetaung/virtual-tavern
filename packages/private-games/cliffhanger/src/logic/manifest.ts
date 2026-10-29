import type { GuideFooter } from '@vt/game-sdk';
import {
  type DeckKind,
  FILM_GENRES,
  STYLES,
  type StyleId,
  TV_GENRES,
  genreInfo,
} from './genres.ts';

/** A picture: a path in the game's asset folder, or a full picture with a small copy. */
export type Picture = string | { art: string; thumb?: string };
/** A box as fractions of its picture: x, y, width, height. */
export type Box = [number, number, number, number];

export interface TapeArt {
  name?: string;
  /** One original card of the genre; our title goes over its label. */
  tape?: Picture;
  thumb?: string;
  labelBox?: Box;
  /** Where the printed genre band was blanked: our genre name is printed inside it. */
  genreBox?: Box;
}

/**
 * The private `cliffhanger/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; anything missing falls back to the genre colours, emoji and a plain CSS tape, and the
 * game is silent without `audio`.
 *
 * {
 *   title, credit: "text" | { title, paragraphs, links }, box, boxReturns, board, sign,
 *   genres: { <filmGenreId>: { name, tape, thumb, labelBox: [x, y, w, h] } },
 *   tvGenres: { <tvGenreId>: { name, tape, thumb, labelBox, genreBox? } },
 *   faceoff: { card, thumb, textBox: [x, y, w, h] },
 *   app: { go, timesUp, faceoffTitle, roundTitle, pressStart, pressReset, buzzer, background },
 *   audio: { <cueId>: { file, fallback, length } },
 *   names: { genres: { <id>: name }, tvGenres: { <id>: name }, styles: { one-word, quote-it, act-it, … } }
 * }
 *
 * Tapes are portrait: the title (and a blanked genre band's name) is printed turned 90° clockwise.
 */
export interface Manifest {
  title?: string;
  credit?:
    string | { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
  box?: Picture;
  boxReturns?: Picture;
  board?: Picture;
  sign?: Picture;
  genres?: Record<string, TapeArt>;
  tvGenres?: Record<string, TapeArt>;
  faceoff?: { card?: Picture; thumb?: string; textBox?: Box };
  app?: Record<string, Picture>;
  /** Each cue's clip (`fallback` for browsers that can't play the first), its length in seconds. */
  audio?: Record<string, { file?: string; fallback?: string; length?: number }>;
  names?: {
    genres?: Record<string, string>;
    tvGenres?: Record<string, string>;
    /** By style id, or by the board's words (`quote-it`, `act-it`). */
    styles?: Record<string, string>;
  };
}

export const clean = (v: unknown, max = 40): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

export const TITLE = 'Cliffhanger';

export interface Names {
  title: string;
  /** Genre names per deck (six ids are in both, with their own names). */
  genres: Record<DeckKind, Record<string, string>>;
  styles: Record<StyleId, string>;
}

/** The manifest's names over ours. */
export function namesOf(m: Manifest | null | undefined): Names {
  const films: Record<string, string> = {};
  for (const g of FILM_GENRES) {
    films[g.id] = clean(m?.names?.genres?.[g.id]) ?? clean(m?.genres?.[g.id]?.name) ?? g.name;
  }
  const tv: Record<string, string> = {};
  for (const g of TV_GENRES) {
    tv[g.id] = clean(m?.names?.tvGenres?.[g.id]) ?? clean(m?.tvGenres?.[g.id]?.name) ?? g.name;
  }
  const given = m?.names?.styles;
  const styles = Object.fromEntries(
    Object.values(STYLES).map((s) => [
      s.id,
      clean(given?.[s.id]) ?? clean(given?.[STYLE_ALIASES[s.id] ?? '']) ?? s.name,
    ]),
  ) as Record<StyleId, string>;
  return { title: clean(m?.title) ?? TITLE, genres: { films, tv }, styles };
}

/** The manifest may name styles by the board's words. */
const STYLE_ALIASES: Partial<Record<StyleId, string>> = { quote: 'quote-it', act: 'act-it' };

export const genreName = (names: Names | null | undefined, id: string, deck: DeckKind = 'films') =>
  names?.genres[deck][id] ?? genreInfo(id, deck).name;

/** The original game's credit, for the guide's footer (unlocked browsers only). */
export function footerOf(m: Manifest | null | undefined): GuideFooter | undefined {
  const c = typeof m?.credit === 'string' ? { paragraphs: [m.credit] } : m?.credit;
  const paragraphs = (c?.paragraphs ?? []).flatMap((p) => (clean(p, 600) ? [p.trim()] : []));
  if (!paragraphs.length) return undefined;
  const links = ((c && 'links' in c ? c.links : undefined) ?? []).flatMap((l) =>
    clean(l.label) && typeof l.href === 'string' && /^https:\/\//.test(l.href)
      ? [{ label: l.label!.trim(), href: l.href }]
      : [],
  );
  const title = c && 'title' in c ? clean(c.title) : undefined;
  return { title: title ?? 'Credits', paragraphs, ...(links.length ? { links } : {}) };
}
