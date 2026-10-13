import type { GuideFooter } from '@vt/game-sdk';
import { NAME_FALLBACKS, type Names, PLACEHOLDER_NAMES } from './names.ts';
import type { BoardSize } from './tables.ts';
import type { Ballot, Policy, Power, Team } from './types.ts';

/** Where the policy slots (and, on the blue board, the tracker lamps) sit on a board's art. */
export interface BoardGeometry {
  /** The first slot's left edge, the distance between slots, and the slots' top and bottom. */
  x0: number;
  pitch: number;
  top: number;
  bottom: number;
  /** The board image's width over its height. */
  ratio: number;
  lamps?: { xs: number[]; y: number; size: number };
}

/**
 * An edition's private manifest in asset storage (`<gameId>/manifest.json`). Everything is
 * optional: without it every name is a neutral placeholder and the cards are drawn in CSS.
 * Shape (paths relative to the game's folder):
 * `{ title, names: { blue, blues, red, reds, leader, yes, no, president, chancellor, candidate,
 *    presidentShort, chancellorShort, policy, policies, party, veto, bluePolicy, redPolicy },
 *    art: { roles: { blue: [..], red: [..], leader: [..], back }, party: { blue, red, back },
 *    policy: { blue, red, back }, ballot: { yes, no, back }, boards: { blue, small, medium, large },
 *    geometry: { red: BoardGeometry, blue: BoardGeometry },
 *    powers: { investigate, special, peek, execute, win }, badges: { president, chancellor, cleared } },
 *    powers: { <power>: { name, text } }, guide: { tagline }, copy: { <copy key>: string },
 *    colors: { blue, red }, fonts: { heading, headingFamily },
 *    credit: { title, game, designers, publisher, link, licence: { name, url }, art: { name, link },
 *    text, changes } }`.
 * Role art lists are pools of any length: each player gets one portrait from their team's pool.
 */
export interface Manifest {
  title?: string;
  names?: Partial<Names>;
  art?: {
    roles?: { blue?: string[]; red?: string[]; leader?: string[]; back?: string };
    party?: Partial<Record<Team | 'back', string>>;
    policy?: Partial<Record<Policy | 'back', string>>;
    ballot?: Partial<Record<Ballot | 'back', string>>;
    boards?: Partial<Record<'blue' | BoardSize, string>>;
    powers?: Partial<Record<Power | 'win', string>>;
    badges?: Partial<Record<'president' | 'chancellor' | 'cleared', string>>;
    geometry?: Partial<Record<Team, Partial<BoardGeometry>>>;
  };
  powers?: Partial<Record<Power, { name?: string; text?: string }>>;
  guide?: { tagline?: string };
  copy?: Record<string, string>;
  /** Each team's accent colour (a CSS colour), for chips, rings, tracks and drawn cards. */
  colors?: Partial<Record<Team, string>>;
  /** A display font for headings and big moments only (path relative to the game's folder). */
  fonts?: { heading?: string; headingFamily?: string };
  credit?: {
    title?: string;
    game?: string;
    designers?: string[];
    publisher?: string;
    link?: string;
    licence?: { name?: string; url?: string };
    /** A second credit: the edition's artist. */
    art?: { name?: string; link?: string };
    text?: string;
    changes?: string[];
  };
}

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export interface Credit {
  title: string;
  text: string;
  changes: string[];
  links: { label: string; href: string }[];
}

export function namesOf(man: Manifest | null): Names {
  const n = man?.names ?? {};
  const out = { ...PLACEHOLDER_NAMES };
  for (const k of Object.keys(out) as (keyof Names)[]) out[k] = clean(n[k]) ?? out[k];
  // A name the manifest leaves out follows the one it derives from (a blue card is "Loyalist").
  for (const [k, from] of Object.entries(NAME_FALLBACKS) as [keyof Names, keyof Names][])
    if (!clean(n[k])) out[k] = out[from];
  if (clean(man?.title)) out.title = clean(man!.title)!;
  return out;
}

/** The manifest's power names, where it has them. */
export function powerNamesOf(man: Manifest | null): Partial<Record<Power, string>> {
  const out: Partial<Record<Power, string>> = {};
  for (const [p, v] of Object.entries(man?.powers ?? {}) as [Power, { name?: string }][]) {
    const name = clean(v?.name);
    if (name) out[p] = name;
  }
  return out;
}

export function creditOf(man: Manifest | null): Credit | null {
  const c = man?.credit;
  if (!c) return null;
  const links: Credit['links'] = [];
  if (clean(c.link)) links.push({ label: clean(c.game) ?? 'The original game', href: c.link! });
  if (clean(c.licence?.url))
    links.push({ label: clean(c.licence?.name) ?? 'Licence', href: c.licence!.url! });
  if (clean(c.art?.link))
    links.push({ label: `Art: ${clean(c.art?.name) ?? 'the artist'}`, href: c.art!.link! });
  return {
    title: clean(c.title) ?? 'Credits',
    text:
      clean(c.text) ??
      [
        clean(c.game),
        c.designers?.length ? `by ${c.designers.join(', ')}` : '',
        clean(c.publisher) ? `(${c.publisher})` : '',
      ]
        .filter(Boolean)
        .join(' '),
    changes: (c.changes ?? []).filter((x) => typeof x === 'string'),
    links,
  };
}

export function footerOf(credit: Credit | null): GuideFooter | undefined {
  if (!credit) return undefined;
  return {
    title: credit.title,
    paragraphs: [
      credit.text,
      ...(credit.changes.length ? [`What we changed: ${credit.changes.join(' ')}`] : []),
    ],
    links: credit.links,
  };
}
