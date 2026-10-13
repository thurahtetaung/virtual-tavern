import type { GameGuide } from '@vt/game-sdk';
import { creditOf, footerOf, nameGuide, namesOf, powerNamesOf } from '@vt/private-hydra/guide';
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

type HydraManifest = Parameters<typeof namesOf>[0];

/**
 * A Hydra edition's words for the recap's and the stats page's placeholders, from its manifest:
 * the teams and the Leader (`{role:blue}`, `{role:red}`, `{role:leader}`), the offices
 * (`{role:chancellor}`), the veto (`{role:Veto}` capitalised) and the boards' policies
 * (`{role:blue-policies}`). Hydra's own words stand in for anything the manifest leaves out.
 */
export function hydraLabels(gameId: string): () => Promise<Labeler> {
  return async () => {
    const names = namesOf(await manifest(gameId));
    const words: Record<string, string> = {
      ...names,
      leader: names.leader,
      'blue-policies': `${names.bluePolicy} ${names.policies}`,
      'red-policies': `${names.redPolicy} ${names.policies}`,
    };
    return (kind, id) => {
      if (kind !== 'role') return undefined;
      const lower = id[0] ? id[0].toLowerCase() + id.slice(1) : id;
      const word = words[lower];
      if (word === undefined || id === 'title') return undefined;
      return id === lower ? word : word[0]!.toUpperCase() + word.slice(1);
    };
  };
}

/** A Hydra edition's guide with its manifest's names, and the credits as its footer. */
export function hydraGuide(gameId: string): () => Promise<GameGuide> {
  return async () => {
    const m = await manifest(gameId);
    const man = m as HydraManifest;
    const guide = nameGuide(namesOf(man), footerOf(creditOf(man)), powerNamesOf(man));
    const tagline = obj(m?.guide).tagline;
    return typeof tagline === 'string' && tagline.trim()
      ? { ...guide, tagline: tagline.trim() }
      : guide;
  };
}
