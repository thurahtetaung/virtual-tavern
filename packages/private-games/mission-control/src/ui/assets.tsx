import { loadManifest } from '@vt/ui';
import { isCard } from '../logic/cards.ts';
import type { OrderToken } from '../logic/content.ts';
import { createContext, useContext, useEffect, useState } from 'react';
import {
  type ArtRef,
  type LogbookEntry,
  type Manifest,
  type Names,
  PLACEHOLDER_NAMES,
  artOf,
  asManifest,
  cardKey,
  clean,
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
  /** An order token's art (small), or null for the drawn badge. */
  orderToken: (t: OrderToken) => string | null;
  /** A campaign's real title from the manifest, if any. */
  voyageTitle: (key: string) => string | null;
  box: string | null;
  logbook: (n: number) => LogbookEntry | null;
}

/** An order token's art key in the manifest. */
const ORDER_KEYS: Record<OrderToken, string> = {
  '1': 'task-1',
  '2': 'task-2',
  '3': 'task-3',
  '4': 'task-4',
  '5': 'task-5',
  a1: 'task-arrow-1',
  a2: 'task-arrow-2',
  a3: 'task-arrow-3',
  a4: 'task-arrow-4',
  o: 'task-omega',
};

const obj = <T,>(v: T | undefined): T | Record<string, never> =>
  v && typeof v === 'object' ? v : {};

/** The art for the campaign being played: its own block first, then the top-level keys. */
export function artFor(m: Manifest | null, voyage: string | null = null): Art {
  const v = (voyage && m?.voyages?.[voyage]) || null;
  const names = namesOf(m, voyage);
  const cards = { ...obj(m?.cards), ...obj(v?.cards) } as Record<string, ArtRef>;
  const tasks = { ...obj(m?.tasks), ...obj(v?.tasks) } as Record<string, ArtRef>;
  const tokens = { ...obj(m?.tokens), ...obj(v?.tokens) } as Record<string, ArtRef>;
  const logbook = { ...obj(m?.logbook), ...obj(v?.logbook) } as Record<string, LogbookEntry>;
  // A task's art: by the task's own id, or (one-card tasks) by its card.
  const taskRef = (key: string) => {
    const id = key.split(':').at(-1)!;
    return tasks[id] ?? (isCard(id) ? tasks[cardKey(id)] : undefined);
  };
  return {
    names,
    say: (text) => fillNames(text, names),
    card: (id) => path(artOf(cards[cardKey(id)] ?? cards[id])),
    cardThumb: (id) => {
      const ref = cards[cardKey(id)] ?? cards[id];
      return path(thumbOf(ref) ?? artOf(ref));
    },
    back: path(artOf(v?.back ?? m?.back)),
    task: (key) => path(artOf(taskRef(key))),
    taskThumb: (key) => {
      const ref = taskRef(key);
      return path(thumbOf(ref) ?? artOf(ref));
    },
    token: (which) => {
      const ref = tokens[TOKEN_KEYS[which]] ?? tokens[which];
      return path(artOf(ref));
    },
    orderToken: (t) => {
      const ref = tokens[ORDER_KEYS[t]];
      return path(thumbOf(ref) ?? artOf(ref));
    },
    voyageTitle: (key) => clean(m?.voyages?.[key]?.title, 80) ?? null,
    box: path(artOf(v?.box ?? m?.box)),
    logbook: (n) => {
      const e = logbook[n === 0 ? 'epilogue' : String(n)];
      return e && typeof e === 'object' ? e : null;
    },
  };
}

export const ArtContext = createContext<Art>(artFor(null));
export const useArt = () => useContext(ArtContext);
export { PLACEHOLDER_NAMES };
