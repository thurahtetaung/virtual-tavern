import type { PlayerId, Rng } from '@vt/game-sdk';
import type { Game, GoingOnceState, HostClip } from './types.ts';
import { VOICE_MS } from './voice-lengths.ts';

// The auctioneer's voice, when the host turns it on: the server picks every clip (keys and clip
// numbers into the private manifest's `audio.voice`, lengths from `VOICE_MS`), so each stage lasts
// as long as what is said in it, on every device, whether or not that device plays sound. Devices
// play the chosen clips on the server clock and show each one's words (`ui/audio.ts`).

/** A short breath between two clips said one after the other. */
export const CLIP_GAP_MS = 150;
/** The original's pause after a chant (or the opening) before "going once". */
export const CHANT_GAP_MS = 1000;
/** One chant in five is a long one, as in the original. */
export const LONG_CHANT = 0.2;

/**
 * One thing to say: a clip key, a key said to a player (`<key>-<their colour>`), or keys to try
 * in turn (the first the table has).
 */
export type VoicePart = string | { key: string; player: PlayerId } | readonly VoicePart[];

/** Whether this game is voiced (the host's voice switch, with sound on, when it began). */
export const voiced = (s: GoingOnceState) => s.game?.voiced === true;

/** The table key a part names now, or null when there is no such clip. */
function keyOf(s: GoingOnceState, part: string | { key: string; player: PlayerId }): string | null {
  if (typeof part === 'string') return VOICE_MS[part]?.length ? part : null;
  const color = s.seats[part.player]?.color;
  const key = color ? `${part.key}-${color}` : null;
  return key && VOICE_MS[key]?.length ? key : null;
}

/** The clips for `parts`, each picked from its key's clips. */
export function clipsFor(s: GoingOnceState, rng: Rng, parts: readonly VoicePart[]): HostClip[] {
  const out: HostClip[] = [];
  for (const part of parts) {
    const options = (Array.isArray(part) ? part : [part]) as readonly VoicePart[];
    for (const o of options) {
      if (Array.isArray(o)) continue;
      const one = o as string | { key: string; player: PlayerId };
      const key = keyOf(s, one);
      if (!key) continue;
      const lengths = VOICE_MS[key]!;
      const i = rng.int(lengths.length);
      out.push({
        key,
        i,
        ms: lengths[i]!,
        ...(typeof one !== 'string' && { player: one.player }),
      });
      break;
    }
  }
  return out;
}

/** How long clips take, said one after the other. */
export const clipsMs = (clips: readonly HostClip[]) =>
  clips.reduce((n, c, i) => n + c.ms + (i ? CLIP_GAP_MS : 0), 0);

/** The chant after a bid of `amount` (or the opening's, at $400): a long one one time in five. */
export function chantKey(amount: number, rng: Rng): string {
  const tag = amount <= 4000 ? String(amount) : 'high';
  const long = `chant-long-${tag}`;
  return rng.next() < LONG_CHANT && VOICE_MS[long]?.length ? long : `chant-${tag}`;
}

/**
 * The host says `parts` from `now` (a new line replaces what was being said); returns how long it
 * takes. Says nothing (keeping the last line) when no part has a clip, unless `clear` is set.
 */
export function speak(
  s: GoingOnceState,
  rng: Rng,
  now: number,
  parts: readonly VoicePart[],
  clear = false,
): number {
  const g = s.game!;
  const clips = clipsFor(s, rng, parts);
  if (!clips.length) {
    if (clear) g.host = null;
    return 0;
  }
  s.seq += 1;
  const ms = clipsMs(clips);
  g.host = { id: s.seq, lines: [], clips, at: now, ms };
  return ms;
}

/** A player's colour lead-in ("Yellow…"), for a remark said to them. */
export const leadIn = (player: PlayerId): VoicePart => ({ key: 'lead', player });

/** When the host stops talking (now, if they aren't). */
export const doneTalking = (g: Game, now: number) =>
  g.host?.at !== undefined && g.host.ms ? Math.max(now, g.host.at + g.host.ms) : now;
