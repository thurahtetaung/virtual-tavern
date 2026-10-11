import { useEffect, useState } from 'react';
import {
  ROLES,
  SET_LABELS,
  type ArtifactId,
  type RoleId,
  type SetId,
  roleLabel,
} from '../logic/roles.ts';
import type { MusicPhase } from './audio.ts';

export const GAME_ID = 'nightfall';

/**
 * The private manifest in asset storage (`nightfall/manifest.json`). Every field is optional;
 * paths are relative to the game's folder. Without it, roles show as styled placeholders with
 * their plain ids, and the game is silent.
 *
 * ```jsonc
 * {
 *   "sets":      { "<set id>": { "name": "…", "roles": ["<role id>"], "artifacts": ["<id>"] } },
 *   "roles":     { "<role id>": { "name": "…", "text": "<card text>", "art": "roles/<id>.webp",
 *                                 "card": "cards/<id>.webp" } },        // card: the full face, 5:7
 *   "artifacts": { "<artifact id>": { "name": "…", "text": "…", "art": "artifacts/<id>.webp" } },
 *   "tokens":    { "shield" | "most-votes-1" | …: { "name": "…", "art": "tokens/<id>.webp" } },
 *   "backs":     { "werewolf": "backs/werewolf.webp" },              // the card back
 *   "narration": { "<line key>": ["audio/<clip>.ogg", …] },   // see `stepLines` in plan.ts
 *   "music":     { "lobby" | "night" | "day" | "vote" | "reveal": ["music/<track>.ogg", …] },
 *   "musicTracks": { "<track id>": { "name": "…", "file": "music/<track>.ogg", "duration": 42.1 } },
 *   "presets":   { "<preset id>": { "name": "…" } }
 * }
 * ```
 */
export interface Manifest {
  sets?: Partial<Record<string, { name?: string; roles?: string[]; artifacts?: string[] }>>;
  roles?: Partial<Record<string, { name?: string; text?: string; art?: string; card?: string }>>;
  tokens?: Partial<Record<string, { name?: string; text?: string; art?: string }>>;
  backs?: Partial<Record<string, string>>;
  artifacts?: Partial<Record<string, { name?: string; text?: string; art?: string }>>;
  narration?: Record<string, string[]>;
  music?: Partial<Record<MusicPhase, string[]>>;
  musicTracks?: Record<string, { name?: string; file: string; duration?: number }>;
  presets?: Partial<Record<string, { name?: string }>>;
}

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest. `null` while loading; `'unavailable'` when the server has no asset
 * storage (or no manifest), in which case everything uses the placeholders.
 */
export function useManifest(): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/backroom/manifest/${GAME_ID}`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) return setManifest('unavailable');
        const body = (await res.json()) as Manifest | null;
        setManifest(body && typeof body === 'object' ? body : 'unavailable');
      })
      .catch(() => live && setManifest('unavailable'));
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

/** Display names, card text and art, from the manifest or the role words. */
export interface Deck {
  name: (role: RoleId | 'vampire') => string;
  text: (role: RoleId) => string;
  /** The portrait (for chips and small tiles). */
  art: (role: RoleId) => string | null;
  /** The full printed card face, 5:7. */
  card: (role: RoleId) => string | null;
  back: string | null;
  token: (id: string) => string | null;
  artifactArt: (id: ArtifactId) => string | null;
  setName: (set: SetId) => string;
  artifactName: (id: ArtifactId) => string;
  artifactText: (id: ArtifactId) => string;
  manifest: Manifest | null;
}

export function deckFor(state: ManifestState, artifactSummary: (id: ArtifactId) => string): Deck {
  const m = state && state !== 'unavailable' ? state : null;
  return {
    manifest: m,
    name: (role) => m?.roles?.[role]?.name?.trim() || roleLabel(role),
    text: (role) => m?.roles?.[role]?.text?.trim() || ROLES[role].summary,
    art: (role) => (m?.roles?.[role]?.art ? assetUrl(m.roles[role].art) : null),
    card: (role) => (m?.roles?.[role]?.card ? assetUrl(m.roles[role].card) : null),
    back: m?.backs?.werewolf ? assetUrl(m.backs.werewolf) : null,
    token: (id) => (m?.tokens?.[id]?.art ? assetUrl(m.tokens[id].art) : null),
    artifactArt: (id) => (m?.artifacts?.[id]?.art ? assetUrl(m.artifacts[id].art) : null),
    setName: (set) => m?.sets?.[set]?.name?.trim() || SET_LABELS[set],
    artifactName: (id) => m?.artifacts?.[id]?.name?.trim() || roleLabel(id),
    artifactText: (id) => m?.artifacts?.[id]?.text?.trim() || artifactSummary(id),
  };
}
