import type { Rig } from '@vt/game-sdk/show';
import { useEffect, useState } from 'react';
import { loadManifest } from '../manifest.ts';

// Rigs and textures live in the game's private asset folder and are named by its manifest:
//   show: { stage: { rig: 'show/x.stage.rig.json', phases: { lobby: [...], auction: [...] } },
//           phone: { rig: 'show/x.phone.rig.json', phases: { auction: [...] } } }
// Each phase lists the files it draws. A device fetches the files of the phase it is in (and,
// when asked, the next one's), keeps them in one Cache Storage cache per game (their URLs never
// change, so a second game downloads nothing), and textures are handed to the art as object URLs
// from that cache. Going Once's sound engine keeps its clips the same way.

export type Audience = 'stage' | 'phone';

export interface ShowFiles {
  rig: string;
  phases: Record<string, string[]>;
}

/** The manifest's `show` block. */
export type ShowManifest = Partial<Record<Audience, ShowFiles>>;

/** A rig with its textures resolved to URLs the art can draw. */
export interface LoadedRig extends Rig {
  textures: Record<string, string>;
}

export const showAssetUrl = (game: string, path: string) =>
  `/api/backroom/assets/${game}/${path.replace(/^\/+/, '')}`;

const caches_ = new Map<string, Promise<Cache | null>>();
function openCache(game: string): Promise<Cache | null> {
  let c = caches_.get(game);
  if (!c) {
    c = (typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(`vt-${game}-show`))
      .then((x): Cache | null => x)
      .catch(() => null);
    caches_.set(game, c);
  }
  return c;
}

const files = new Map<string, Promise<Response | null>>();
/**
 * A file from Cache Storage, else fetched (and kept there). Where there is no Cache Storage (an
 * insecure page), the fetched bytes are kept for this page instead.
 */
export function showFile(game: string, path: string): Promise<Blob | null> {
  const url = showAssetUrl(game, path);
  let p = files.get(url);
  if (!p) {
    p = openCache(game)
      .then(async (cache) => {
        const hit = await cache?.match(url);
        if (hit) return hit;
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return null;
        if (cache) await cache.put(url, res.clone());
        return res;
      })
      .catch(() => null);
    files.set(url, p);
    // A failure isn't an answer: the next caller asks again.
    void p.then((r) => r || files.delete(url));
  }
  return p.then((r) => r?.clone().blob() ?? null).catch(() => null);
}

/** Fetches a phase's files ahead, decoding nothing. */
export function prefetchShow(game: string, show: ShowFiles | undefined, phase: string) {
  for (const f of show?.phases[phase] ?? []) void showFile(game, f);
}

const TEXTURE = /href="([^"#:]+\.(?:webp|avif|png))"/g;
const rigs = new Map<string, Promise<LoadedRig | null>>();

/** Loads a rig and its textures (named relative to the rig's folder). */
export function loadRig(game: string, path: string): Promise<LoadedRig | null> {
  const key = `${game}/${path}`;
  let p = rigs.get(key);
  if (!p) {
    p = (async () => {
      const blob = await showFile(game, path);
      if (!blob) return null;
      const rig = JSON.parse(await blob.text()) as Rig;
      const dir = path.slice(0, path.lastIndexOf('/') + 1);
      const names = new Set<string>();
      for (const src of Object.values(rig.symbols))
        for (const m of src.matchAll(TEXTURE)) names.add(m[1]!);
      const textures: Record<string, string> = {};
      await Promise.all(
        [...names].map(async (name) => {
          const tex = await showFile(game, dir + name);
          textures[name] = tex ? URL.createObjectURL(tex) : showAssetUrl(game, dir + name);
        }),
      );
      return { ...rig, textures };
    })().catch(() => null);
    rigs.set(key, p);
    void p.then((r) => r || rigs.delete(key));
  }
  return p;
}

/** The manifest's show block for an audience, if the game has one. */
export function showFilesOf(manifest: unknown, audience: Audience): ShowFiles | undefined {
  const show = (manifest as { show?: ShowManifest } | null)?.show?.[audience];
  return show && typeof show.rig === 'string' && show.phases ? show : undefined;
}

/**
 * The rig for an audience once the phase this device is in needs it (its manifest lists the rig
 * in that phase's files, or an earlier phase already loaded it); null until then, and for a game
 * without a show. The phase's other files are fetched too, and `next`'s ahead of time.
 */
export function useRig(
  game: string,
  audience: Audience,
  phase: string,
  next?: string,
): LoadedRig | null {
  const [rig, setRig] = useState<LoadedRig | null>(null);
  useEffect(() => {
    let live = true;
    void loadManifest(game).then((manifest) => {
      const show = showFilesOf(manifest, audience);
      if (!live || !show) return;
      prefetchShow(game, show, phase);
      if (next) prefetchShow(game, show, next);
      if (!rig && show.phases[phase]?.includes(show.rig)) {
        void loadRig(game, show.rig).then((r) => {
          if (live && r) setRig(r);
        });
      }
    });
    return () => {
      live = false;
    };
  }, [game, audience, phase, next, rig]);
  return rig;
}
