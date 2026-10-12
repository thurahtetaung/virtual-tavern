import type { GameGuide } from '@vt/game-sdk';
import { creditOf, footerOf, nameGuide, namesOf } from '@vt/private-hydra/guide';
import type { Labeler } from '../recap/resolve.ts';

/**
 * Names for the night recap's private placeholders, read from each back-room game's manifest.
 * This module is only ever imported by `private.ts`, so it ships in the back-room bundle.
 */

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const name = (v: unknown): string | undefined => {
  const n = obj(v).name;
  return typeof n === 'string' && n.trim() ? n.trim() : undefined;
};

/** Fetches a manifest once per page; null without asset storage. */
const manifests = new Map<string, Promise<Json | null>>();
function manifest(gameId: string): Promise<Json | null> {
  let p = manifests.get(gameId);
  if (!p) {
    p = fetch(`/api/backroom/manifest/${gameId}`)
      .then(async (res) => (res.ok ? obj(await res.json()) : null))
      .catch(() => null);
    manifests.set(gameId, p);
  }
  return p;
}

/** "e1-07" → "Location 7", "e2-01" → "Location 31", as the game's own placeholders. */
function locationPlaceholder(id: string): string | undefined {
  const m = /^e([12])-(\d{2})$/.exec(id);
  return m ? `Location ${(m[1] === '1' ? 0 : 30) + Number(m[2])}` : undefined;
}

export async function originalsLabels(): Promise<Labeler> {
  const m = await manifest('masquerade-originals');
  const locations = obj(m?.locations);
  return (kind, id) =>
    kind === 'loc' ? (name(locations[id]) ?? locationPlaceholder(id)) : undefined;
}

export async function nightfallLabels(): Promise<Labeler> {
  const m = await manifest('nightfall');
  const roles = obj(m?.roles);
  const artifacts = obj(m?.artifacts);
  return (kind, id) =>
    kind === 'role' ? name(roles[id]) : kind === 'card' ? name(artifacts[id]) : undefined;
}

export async function royalPostLabels(): Promise<Labeler> {
  const m = await manifest('royal-post');
  const editions = obj(m?.editions);
  // A role has one name per edition; the classic one is the usual, the 2019 one covers the rest.
  const cards = [obj(obj(editions.classic).cards), obj(obj(editions['2019']).cards)];
  return (kind, id) =>
    kind === 'role' || kind === 'card'
      ? cards.map((c) => name(c[id])).find((n) => n !== undefined)
      : undefined;
}

/** Inquest names its cards `clue-17` / `means-4`; the manifest keys them by number per deck. */
export async function inquestLabels(): Promise<Labeler> {
  const m = await manifest('inquest');
  const decks = { clue: obj(m?.clue), means: obj(m?.means) };
  const roles = obj(m?.roles);
  return (kind, id) => {
    if (kind === 'role') return name(roles[id]);
    if (kind !== 'card') return undefined;
    const match = /^(clue|means)-(\d+)$/.exec(id);
    if (!match) return undefined;
    const n = decks[match[1] as 'clue' | 'means'][match[2]!];
    return typeof n === 'string' && n.trim() ? n.trim() : undefined;
  };
}

/** Hydra's teams and Leader (`{role:blue}`, `{role:red}`, `{role:leader}`) from its manifest names. */
export async function hydraLabels(): Promise<Labeler> {
  const names = obj((await manifest('hydra'))?.names);
  const word = (k: string) => {
    const v = names[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  return (kind, id) => {
    if (kind !== 'role') return undefined;
    if (id === 'leader') return word('leader');
    return id === 'blue' || id === 'red' ? word(id) : undefined;
  };
}

/** Hydra's guide with the manifest's names, and the original game's credit as its footer. */
export async function hydraGuide(): Promise<GameGuide> {
  const m = await manifest('hydra');
  const man = m as Parameters<typeof namesOf>[0];
  const guide = nameGuide(namesOf(man), footerOf(creditOf(man)));
  const tagline = obj(m?.guide).tagline;
  return typeof tagline === 'string' && tagline.trim()
    ? { ...guide, tagline: tagline.trim() }
    : guide;
}
