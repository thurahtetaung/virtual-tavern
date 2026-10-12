import type { GuideFooter } from '@vt/game-sdk';
import { type Names, PLACEHOLDER_NAMES } from './names.ts';
import type { BoardSize } from './tables.ts';
import type { Ballot, Policy, Power, Team } from './types.ts';

/**
 * The private manifest in asset storage (`hydra/manifest.json`). Everything is optional: without
 * it the teams, the Leader and the ballots use the neutral placeholder names and the cards are
 * drawn in CSS. Shape (paths relative to the game's folder):
 * `{ title, names: { blue, blues, red, reds, leader, yes, no }, art: { roles: { blue: [..6],
 *    red: [..3], leader: [..1], back }, party: { blue, red, back }, policy: { blue, red, back },
 *    ballot: { yes, no, back }, boards: { blue, small, medium, large },
 *    powers: { investigate, special, peek, execute, win }, badges: { president, chancellor, cleared } },
 *    powers: { <power>: { name, text } }, guide: { tagline },
 *    credit: { title, game, designers, publisher, link, licence: { name, url }, text, changes } }`.
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
  };
  powers?: Partial<Record<Power, { name?: string; text?: string }>>;
  guide?: { tagline?: string };
  credit?: {
    title?: string;
    game?: string;
    designers?: string[];
    publisher?: string;
    link?: string;
    licence?: { name?: string; url?: string };
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
  if (clean(man?.title)) out.title = clean(man!.title)!;
  return out;
}

export function creditOf(man: Manifest | null): Credit | null {
  const c = man?.credit;
  if (!c) return null;
  const links: Credit['links'] = [];
  if (clean(c.link)) links.push({ label: clean(c.game) ?? 'The original game', href: c.link! });
  if (clean(c.licence?.url))
    links.push({ label: clean(c.licence?.name) ?? 'Licence', href: c.licence!.url! });
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
