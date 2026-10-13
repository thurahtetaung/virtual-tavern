import type { GameGuide } from '@vt/game-sdk';
import {
  creditOf,
  footerOf,
  nameGuide,
  namesOf,
  placeholderWord,
  powerNamesOf,
} from '@vt/private-hydra/guide';
import { makeGuide } from '@vt/private-tavern-brawl/guide';
import {
  type Manifest as ShortFuseManifest,
  footerOf as shortFuseFooter,
  nameGuide as nameShortFuseGuide,
  namesOf as shortFuseNames,
} from '@vt/private-short-fuse/guide';
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
 * A Hydra edition's words for the recap's and the stats page's `{role:…}` placeholders (teams,
 * offices, cards and powers), from its manifest, with Hydra's own words as the fallback.
 */
export function hydraLabels(gameId: string): () => Promise<Labeler> {
  return async () => {
    const word = placeholderWord(await manifest(gameId));
    return (kind, id) => (kind === 'role' ? word(id) : undefined);
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

/** Tavern Brawl names heroes (`{role:mage}`) and cards (`{card:mage.04}`) from its manifest. */
export async function tavernBrawlLabels(): Promise<Labeler> {
  const m = await manifest('tavern-brawl');
  const heroes = obj(m?.heroes);
  const cards = obj(m?.cards);
  return (kind, id) =>
    kind === 'role' ? name(heroes[id]) : kind === 'card' ? name(cards[id]) : undefined;
}

/** Tavern Brawl's guide with the real hero and card names, and the credits as its footer. */
export async function tavernBrawlGuide(): Promise<GameGuide> {
  const m = await manifest('tavern-brawl');
  const heroes = obj(m?.heroes);
  const cards = obj(m?.cards);
  const credit = obj(m?.credit);
  const paragraphs = Array.isArray(credit.paragraphs)
    ? credit.paragraphs.filter((p): p is string => typeof p === 'string')
    : [];
  return makeGuide(
    { hero: (id) => name(heroes[id]), card: (id) => name(cards[id]) },
    typeof credit.title === 'string' && paragraphs.length
      ? { title: credit.title, paragraphs }
      : undefined,
  );
}

/** Short Fuse's card names (`{card:bomb}`), from its manifest, with its placeholders otherwise. */
export async function shortFuseLabels(): Promise<Labeler> {
  const names = shortFuseNames(await manifest('short-fuse'));
  return (kind, id) => (kind === 'card' ? names.cards[id as keyof typeof names.cards] : undefined);
}

/** Short Fuse's guide in its manifest's names, with the credits as its footer. */
export async function shortFuseGuide(): Promise<GameGuide> {
  const m = (await manifest('short-fuse')) as ShortFuseManifest | null;
  return nameShortFuseGuide(shortFuseNames(m), shortFuseFooter(m));
}
