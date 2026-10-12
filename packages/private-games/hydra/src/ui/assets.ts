import { useEffect, useState } from 'react';
import { type Credit, type Manifest, creditOf, namesOf } from '../logic/manifest.ts';
import { type Names, POWER_NAMES, POWER_TEXT, fillNames } from '../logic/names.ts';
import type { BoardSize } from '../logic/tables.ts';
import type { Ballot, Policy, Power, Role, Team } from '../logic/types.ts';

export type { Manifest };

export const GAME_ID = 'hydra';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

let cached: Promise<Manifest | null> | null = null;

/** The manifest, fetched once per page; null without asset storage (tests, dev). */
export function loadManifest(): Promise<Manifest | null> {
  cached ??= fetch(`/api/backroom/manifest/${GAME_ID}`)
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as unknown;
      return body && typeof body === 'object' ? body : null;
    })
    .catch(() => null);
  return cached;
}

export function useManifest(): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
  useEffect(() => {
    let live = true;
    void loadManifest().then((m) => {
      if (live) setManifest(m ?? 'unavailable');
    });
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const url = (v: unknown) => {
  const c = clean(v);
  return c ? assetUrl(c) : null;
};

/** Names and art for everything on the table, with placeholders where the manifest is silent. */
export interface Content {
  /** The manifest loaded, so real art is expected. */
  art: boolean;
  names: Names;
  /** Fills name tokens: `{blue}`, `{reds}`, `{leader}`, `{Leader}`, `{yes}`… */
  t: (text: string) => string;
  teamName: (team: Team) => string;
  roleName: (role: Role) => string;
  ballotName: (b: Ballot) => string;
  roleArt: (role: Role, index: number) => string | null;
  roleBack: string | null;
  party: (team: Team) => string | null;
  partyBack: string | null;
  policy: (p: Policy) => string | null;
  policyBack: string | null;
  ballot: (b: Ballot) => string | null;
  ballotBack: string | null;
  board: (kind: 'blue' | BoardSize) => string | null;
  powerIcon: (p: Power | 'win') => string | null;
  badge: (k: 'president' | 'chancellor' | 'cleared') => string | null;
  powerName: (p: Power) => string;
  powerText: (p: Power) => string;
  credit: Credit | null;
}

const m = (s: ManifestState): Manifest | null => (s && s !== 'unavailable' ? s : null);

export function contentFor(state: ManifestState): Content {
  const man = m(state);
  const names = namesOf(man);
  const a = man?.art;
  const t = (text: string) => fillNames(text, names);
  return {
    art: !!man,
    names,
    t,
    teamName: (team) => (team === 'blue' ? names.blue : names.red),
    roleName: (role) =>
      role === 'leader'
        ? names.leader.replace(/^the /, '')
        : role === 'blue'
          ? names.blue
          : names.red,
    ballotName: (b) => (b === 'yes' ? names.yes : names.no),
    roleArt: (role, i) => {
      const list = a?.roles?.[role] ?? [];
      return list.length ? url(list[i % list.length]) : null;
    },
    roleBack: url(a?.roles?.back),
    party: (team) => url(a?.party?.[team]),
    partyBack: url(a?.party?.back),
    policy: (p) => url(a?.policy?.[p]),
    policyBack: url(a?.policy?.back),
    ballot: (b) => url(a?.ballot?.[b]),
    ballotBack: url(a?.ballot?.back),
    board: (k) => url(a?.boards?.[k]),
    powerIcon: (p) => url(a?.powers?.[p]),
    badge: (k) => url(a?.badges?.[k]),
    powerName: (p) => clean(man?.powers?.[p]?.name) ?? POWER_NAMES[p],
    powerText: (p) => clean(man?.powers?.[p]?.text) ?? t(POWER_TEXT[p]),
    credit: creditOf(man),
  };
}
