import { loadManifest } from '@vt/ui';
import { createContext, useContext, useEffect, useState } from 'react';
import {
  type LogbookEntry,
  type Manifest,
  type Names,
  PLACEHOLDER_NAMES,
  artOf,
  asManifest,
  cardKey,
  fillNames,
  namesOf,
  thumbOf,
} from '../logic/manifest.ts';

export const GAME_ID = 'mission-control';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/** The private manifest: null while loading or when there is none (placeholders then). */
export function useManifest(): Manifest | null {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    let live = true;
    void loadManifest(GAME_ID).then((body) => {
      if (live && body) setManifest(asManifest(body));
    });
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

const path = (p: string | undefined) => (p ? assetUrl(p) : null);

const TOKEN_KEYS = {
  token: 'sonar-green',
  used: 'sonar-red',
  captain: 'captain',
  distress: 'distress-up',
  'distress-down': 'distress-down',
  reminder: 'reminder',
} as const;

export interface Art {
  names: Names;
  /** Fills name tokens ({trump}, {captain}…). */
  say: (text: string) => string;
  card: (id: string) => string | null;
  cardThumb: (id: string) => string | null;
  back: string | null;
  task: (key: string) => string | null;
  taskThumb: (key: string) => string | null;
  token: (which: keyof typeof TOKEN_KEYS) => string | null;
  box: string | null;
  logbook: (n: number) => LogbookEntry | null;
}

export function artFor(m: Manifest | null): Art {
  const names = namesOf(m);
  const cards = m?.cards && typeof m.cards === 'object' ? m.cards : {};
  const tasks = m?.tasks && typeof m.tasks === 'object' ? m.tasks : {};
  const logbook = m?.logbook && typeof m.logbook === 'object' ? m.logbook : {};
  return {
    names,
    say: (text) => fillNames(text, names),
    card: (id) => path(artOf(cards[cardKey(id)] ?? cards[id])),
    cardThumb: (id) => {
      const ref = cards[cardKey(id)] ?? cards[id];
      return path(thumbOf(ref) ?? artOf(ref));
    },
    back: path(artOf(m?.back)),
    // Task scans are keyed by the task's own id (the part after the pack id).
    task: (key) => path(artOf(tasks[key.split(':').at(-1)!])),
    taskThumb: (key) => {
      const ref = tasks[key.split(':').at(-1)!];
      return path(thumbOf(ref) ?? artOf(ref));
    },
    token: (which) => {
      const t = m?.tokens && typeof m.tokens === 'object' ? m.tokens : {};
      return path(artOf(t[TOKEN_KEYS[which]] ?? t[which]));
    },
    box: path(artOf(m?.box)),
    logbook: (n) => {
      const e = logbook[n === 0 ? 'epilogue' : String(n)];
      return e && typeof e === 'object' ? e : null;
    },
  };
}

export const ArtContext = createContext<Art>(artFor(null));
export const useArt = () => useContext(ArtContext);
export { PLACEHOLDER_NAMES };
