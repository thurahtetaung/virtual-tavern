import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { type CopyKey, type CopyVars, copyLine, fillVars } from '../logic/copy.ts';
import {
  type BoardGeometry,
  type Credit,
  type Manifest,
  creditOf,
  namesOf,
} from '../logic/manifest.ts';
import { type Names, POWER_NAMES, POWER_TEXT, fillNames } from '../logic/names.ts';
import { BLUE_TO_WIN, RED_TO_WIN } from '../logic/types.ts';
import type { BoardSize } from '../logic/tables.ts';
import type { Ballot, Policy, Power, Role, Team } from '../logic/types.ts';

export type { Manifest };

/** Hydra's own id: other editions pass theirs to `HydraGame`. */
export const GAME_ID = 'hydra';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (gameId: string, path: string) =>
  `/api/backroom/assets/${gameId}/${path.replace(/^\/+/, '')}`;

const cached = new Map<string, Promise<Manifest | null>>();

/** An edition's manifest, fetched once per page; null without asset storage (tests, dev). */
export function loadManifest(gameId: string): Promise<Manifest | null> {
  let p = cached.get(gameId);
  if (!p) {
    p = fetch(`/api/backroom/manifest/${gameId}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as unknown;
        return body && typeof body === 'object' ? body : null;
      })
      .catch(() => null);
    cached.set(gameId, p);
  }
  return p;
}

export function useManifest(gameId: string): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
  useEffect(() => {
    let live = true;
    void loadManifest(gameId).then((m) => {
      if (live) setManifest(m ?? 'unavailable');
    });
    return () => {
      live = false;
    };
  }, [gameId]);
  return manifest;
}

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Where the policy slots sit on Hydra's own board art (measured from its crop boxes). */
export const DEFAULT_GEOMETRY: Record<Team, BoardGeometry & { slots: number }> = {
  red: {
    x0: 0.0694,
    pitch: 0.1437,
    top: 0.214,
    bottom: 0.788,
    slots: RED_TO_WIN,
    ratio: 3940 / 1310,
  },
  blue: {
    x0: 0.1385,
    pitch: 0.1446,
    top: 0.203,
    bottom: 0.792,
    slots: BLUE_TO_WIN,
    ratio: 3902 / 1277,
    lamps: { xs: [0.3456, 0.4437, 0.5412, 0.6387], y: 0.885, size: 0.036 },
  },
};

const fraction = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : undefined);

/** The manifest's board geometry over Hydra's, field by field (anything odd is ignored). */
export function geometryOf(man: Manifest | null): typeof DEFAULT_GEOMETRY {
  const pick = (team: Team) => {
    const d = DEFAULT_GEOMETRY[team];
    const g = man?.art?.geometry?.[team] ?? {};
    const ratio = typeof g.ratio === 'number' && g.ratio > 0 && g.ratio < 20 ? g.ratio : d.ratio;
    const l = g.lamps;
    const lamps =
      l && Array.isArray(l.xs) && l.xs.length >= 3 && l.xs.every((x) => fraction(x) !== undefined)
        ? {
            xs: l.xs,
            y: fraction(l.y) ?? d.lamps?.y ?? 0.9,
            size: fraction(l.size) ?? d.lamps?.size ?? 0.03,
          }
        : d.lamps;
    return {
      x0: fraction(g.x0) ?? d.x0,
      pitch: fraction(g.pitch) ?? d.pitch,
      top: fraction(g.top) ?? d.top,
      bottom: fraction(g.bottom) ?? d.bottom,
      slots: d.slots,
      ratio,
      ...(lamps && { lamps }),
    };
  };
  return { red: pick('red'), blue: pick('blue') };
}

/** Tailwind's colour steps, as a mix of a team's colour with white (light) or black (dark). */
const STEPS: [step: number, mix: string][] = [
  [50, 'white 92%'],
  [100, 'white 84%'],
  [200, 'white 68%'],
  [300, 'white 50%'],
  [400, 'white 28%'],
  [500, 'white 12%'],
  [600, 'white 0%'],
  [700, 'black 15%'],
  [800, 'black 30%'],
  [900, 'black 45%'],
  [950, 'black 62%'],
];

/**
 * An edition's team colours. Hydra's drawn cards, chips and tracks use Tailwind's sky (blue team)
 * and red (red team) colours, which read CSS variables: overriding the variables on the game's
 * root recolours all of them. Without colours in the manifest nothing is overridden.
 */
export function colorVars(colors: Manifest['colors']): CSSProperties | undefined {
  const out: Record<string, string> = {};
  for (const [team, scale] of [
    ['blue', 'sky'],
    ['red', 'red'],
  ] as const) {
    const base = clean(colors?.[team]);
    if (!base || !/^[#a-z0-9(),.%\s-]+$/i.test(base)) continue;
    for (const [step, mix] of STEPS)
      out[`--color-${scale}-${step}`] =
        step === 600 ? base : `color-mix(in oklab, ${base}, ${mix})`;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A small seeded shuffle (mulberry32), so every browser picks the same portraits. */
function shuffled(n: number, seed: number): number[] {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const ROLE_SALT: Record<Role, number> = { blue: 0x9e3779b9, red: 0x85ebca6b, leader: 0xc2b2ae35 };

/**
 * The portrait for a player's `index` (distinct within a team, from the server) in a pool of
 * `size`, shuffled by the game's seed: each game draws from the whole pool, and no two players
 * of a team share a portrait while the pool is big enough.
 */
export function portraitIndex(role: Role, index: number, seed: number, size: number): number {
  if (size <= 0) return 0;
  return shuffled(size, (seed ^ ROLE_SALT[role]) >>> 0)[index % size]!;
}

/** Names, copy and art for everything on the table, with placeholders where the manifest is silent. */
export interface Content {
  gameId: string;
  /** The manifest loaded, so real art is expected. */
  art: boolean;
  names: Names;
  /** Fills name tokens: `{blue}`, `{reds}`, `{leader}`, `{Leader}`, `{president}`, `{policy}`… */
  t: (text: string) => string;
  /** A line of table talk (`copy.ts`), reworded by the manifest, with its variables and names. */
  copy: (key: CopyKey, vars?: CopyVars) => string;
  teamName: (team: Team) => string;
  /** A card's colour as the cards call it ("Loyalist"). */
  policyName: (p: Policy) => string;
  roleName: (role: Role) => string;
  ballotName: (b: Ballot) => string;
  roleArt: (role: Role, index: number, seed?: number) => string | null;
  roleBack: string | null;
  party: (team: Team) => string | null;
  partyBack: string | null;
  policy: (p: Policy) => string | null;
  policyBack: string | null;
  ballot: (b: Ballot) => string | null;
  ballotBack: string | null;
  board: (kind: 'blue' | BoardSize) => string | null;
  geometry: typeof DEFAULT_GEOMETRY;
  powerIcon: (p: Power | 'win') => string | null;
  badge: (k: 'president' | 'chancellor' | 'cleared') => string | null;
  powerName: (p: Power) => string;
  powerText: (p: Power) => string;
  credit: Credit | null;
  /** CSS variables for the edition's team colours, if it has any. */
  colors: CSSProperties | undefined;
  /** The display font for headings and big moments, if the edition has one. */
  font: { url: string; family: string } | null;
}

const m = (s: ManifestState): Manifest | null => (s && s !== 'unavailable' ? s : null);

export function contentFor(state: ManifestState, gameId = GAME_ID): Content {
  const man = m(state);
  const names = namesOf(man);
  const a = man?.art;
  const url = (v: unknown) => {
    const c = clean(v);
    return c ? assetUrl(gameId, c) : null;
  };
  const t = (text: string) => fillNames(text, names);
  const roleName = (role: Role) =>
    role === 'leader'
      ? names.leader.replace(/^the /, '')
      : role === 'blue'
        ? names.blue
        : names.red;
  const heading = clean(man?.fonts?.heading);
  const family = clean(man?.fonts?.headingFamily);
  return {
    gameId,
    art: !!man,
    names,
    t,
    copy: (key, vars = {}) =>
      t(fillVars(copyLine(man?.copy, key), { leaderName: roleName('leader'), ...vars })),
    teamName: (team) => (team === 'blue' ? names.blue : names.red),
    policyName: (p) => (p === 'blue' ? names.bluePolicy : names.redPolicy),
    roleName,
    ballotName: (b) => (b === 'yes' ? names.yes : names.no),
    roleArt: (role, i, seed = 0) => {
      const list = (a?.roles?.[role] ?? []).filter((x) => clean(x));
      return list.length ? url(list[portraitIndex(role, i, seed, list.length)]) : null;
    },
    roleBack: url(a?.roles?.back),
    party: (team) => url(a?.party?.[team]),
    partyBack: url(a?.party?.back),
    policy: (p) => url(a?.policy?.[p]),
    policyBack: url(a?.policy?.back),
    ballot: (b) => url(a?.ballot?.[b]),
    ballotBack: url(a?.ballot?.back),
    board: (k) => url(a?.boards?.[k]),
    geometry: geometryOf(man),
    powerIcon: (p) => url(a?.powers?.[p]),
    badge: (k) => url(a?.badges?.[k]),
    powerName: (p) => clean(man?.powers?.[p]?.name) ?? t(POWER_NAMES[p]),
    powerText: (p) => clean(man?.powers?.[p]?.text) ?? t(POWER_TEXT[p]),
    credit: creditOf(man),
    colors: colorVars(man?.colors),
    font: heading && family ? { url: assetUrl(gameId, heading), family } : null,
  };
}
