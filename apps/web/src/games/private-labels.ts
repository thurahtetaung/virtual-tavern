import { namesOf as defuseNames } from '@vt/private-defuse/logic';
import type { GameGuide } from '@vt/game-sdk';
import { loadManifest } from '@vt/ui';
import {
  creditOf,
  footerOf,
  guideArtOf,
  nameGuide,
  namesOf,
  placeholderWord,
  powerNamesOf,
} from '@vt/private-hydra/guide';
import { makeGuide } from '@vt/private-tavern-brawl/guide';
import {
  type Manifest as ShortFuseManifest,
  faceOf as shortFuseFace,
  footerOf as shortFuseFooter,
  nameGuide as nameShortFuseGuide,
  namesOf as shortFuseNames,
} from '@vt/private-short-fuse/guide';
import { type Manifest as IconicManifest, iconName } from '@vt/private-iconic/guide';
import { namesOf as thornsNames } from '@vt/private-thorns/guide';
import { namesOf as stampedeNames } from '@vt/private-stampede/guide';
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

/** The guide with the manifest's own tagline (`guide.tagline`), when it has one. */
function withTagline(m: unknown, guide: GameGuide): GameGuide {
  const tagline = obj(obj(m).guide).tagline;
  return typeof tagline === 'string' && tagline.trim()
    ? { ...guide, tagline: tagline.trim() }
    : guide;
}

/**
 * A back-room game's plain guide under its manifest's tagline, for games whose rules need no
 * other names (their cards show the real names in play).
 */
export function taggedGuide(gameId: string, guide: GameGuide): () => Promise<GameGuide> {
  return async () => withTagline(await manifest(gameId), guide);
}

/**
 * A back-room game's guide in its manifest's words and art (`nameGuide`), under the manifest's
 * tagline. Without a manifest, `nameGuide(null)` is the plain guide.
 */
export function manifestGuide(
  gameId: string,
  nameGuide: (manifest: unknown) => GameGuide,
): () => Promise<GameGuide> {
  return async () => {
    const m = await manifest(gameId);
    return withTagline(m, nameGuide(m));
  };
}

/** The manifest's own `title`, if it has one. */
export async function manifestTitle(gameId: string): Promise<string | undefined> {
  const title = (await manifest(gameId))?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

/** A manifest, fetched once per page and shared with the games' own UIs; null without one. */
const manifest = (gameId: string): Promise<Json | null> => loadManifest(gameId);

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
    return withTagline(
      m,
      nameGuide(namesOf(man), footerOf(creditOf(man)), powerNamesOf(man), guideArtOf(man, gameId)),
    );
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
  const url = (p: unknown) =>
    typeof p === 'string' && p ? `/api/backroom/assets/tavern-brawl/${p}` : undefined;
  const paragraphs = Array.isArray(credit.paragraphs)
    ? credit.paragraphs.filter((p): p is string => typeof p === 'string')
    : [];
  return withTagline(
    m,
    makeGuide(
      {
        hero: (id) => name(heroes[id]),
        heroClass: (id) => {
          const c = obj(heroes[id]).class;
          return typeof c === 'string' && c.trim() ? c.trim() : undefined;
        },
        card: (id) => name(cards[id]),
        set: (id) => name(obj(m?.sets)[id]),
        heroArt: (id) => {
          const h = obj(heroes[id]);
          const portrait = url(h.portrait);
          const f = h.portraitFocus;
          const focus =
            Array.isArray(f) && f.length === 2 && f.every((n) => typeof n === 'number')
              ? (f as [number, number])
              : undefined;
          return portrait ? { portrait, ...(focus && { focus }) } : undefined;
        },
        cardArt: (id) => {
          const c = obj(cards[id]);
          const face = url(c.face);
          const thumb = url(c.thumb) ?? face;
          return face || thumb ? { ...(face && { face }), ...(thumb && { thumb }) } : undefined;
        },
      },
      typeof credit.title === 'string' && paragraphs.length
        ? { title: credit.title, paragraphs }
        : undefined,
    ),
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
  const url = (p: string | null | undefined) =>
    p ? `/api/backroom/assets/short-fuse/${p.replace(/^\/+/, '')}` : undefined;
  const names = shortFuseNames(m);
  // The tagline is filled the same way, so its article fits the name too.
  const tagline = obj(obj(m).guide).tagline;
  const g = nameShortFuseGuide(names, shortFuseFooter(m), {
    face: (t) => url(shortFuseFace(m, t, 0, 'classic')),
    text: (t) => {
      const f = shortFuseFace(m, t, 0, 'classic');
      const rules = f ? m?.text?.[f]?.rules : undefined;
      return typeof rules === 'string' && rules.trim() ? rules.trim() : undefined;
    },
    ...(url(m?.back) && { back: url(m?.back)! }),
  });
  return typeof tagline === 'string' && tagline.trim() ? { ...g, tagline: tagline.trim() } : g;
}

/** Thorns' disc names (`{card:thorn}`), from its manifest, with its placeholders otherwise. */
export async function thornsLabels(): Promise<Labeler> {
  const names = thornsNames(await manifest('thorns'));
  return (kind, id) =>
    kind === 'card' && (id === 'rose' || id === 'thorn' || id === 'chance') ? names[id] : undefined;
}

/** Iconic's icon names (`{card:17}`), from its manifest, else "Icon 17". */
export async function iconicLabels(): Promise<Labeler> {
  const m = (await manifest('iconic')) as IconicManifest | null;
  return (kind, id) => (kind === 'card' && /^\d+$/.test(id) ? iconName(m, Number(id)) : undefined);
}

/** Defuse's module names (`{card:wires}`), from its manifest, else plain words. */
export async function defuseLabels(): Promise<Labeler> {
  const names = defuseNames(await manifest('defuse'));
  return (kind, id) =>
    kind === 'card' && id in names ? names[id as keyof typeof names] : undefined;
}

/** Stampede's Pink Cow (`{card:pink-cow}`), from its manifest, with its placeholder otherwise. */
export async function stampedeLabels(): Promise<Labeler> {
  const names = stampedeNames(await manifest('stampede'));
  return (kind, id) => (kind === 'card' && id === 'pink-cow' ? names.pink : undefined);
}
