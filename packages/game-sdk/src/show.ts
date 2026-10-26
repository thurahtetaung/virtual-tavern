// The show layer's pure half: a *moment* is data (when it began on the server clock and its steps),
// and `schedule` says which of its steps this device plays and how late each one is. Every device
// builds the same moments from its own view and plays them on the server clock, so a phone that
// reconnects, a table screen opened mid-lot and a tab coming back all land on the same frame.
// No DOM here: the browser half is `@vt/ui/show`, and games build moments in their own `ui/`.

/**
 * How much of the show a device plays: the table screen (`stage`: the whole scene, all sound), a
 * phone in a room that has a table screen (`phone-quiet`: its own UI and personal cues only) or a
 * phone without one (`phone-full`).
 */
export type Profile = 'stage' | 'phone-quiet' | 'phone-full';
export const PROFILES: readonly Profile[] = ['stage', 'phone-quiet', 'phone-full'];

/** One original frame: a 2-D matrix (a b c d tx ty) and an opacity. */
export type Frame = [
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number,
  alpha: number,
];

/** A rig track: per-frame poses at the rig's frame rate, played linearly between frames. */
export interface Track {
  ms: number;
  frames: Frame[];
}

/**
 * Vector parts and their motion, exported from the original art (private: rigs live in the game's
 * asset storage, never the repo). `symbols` are inline SVG sources (texture hrefs relative to the
 * rig's URL), `tracks` are named clips by part (`stamp.Appear` is `tracks.stamp.Appear`), `places`
 * resting matrices of parts inside their parents (or lists of them: seat positions per table).
 */
export interface Rig {
  fps: number;
  /** The stage size the places are in, [width, height]. */
  stage: [number, number];
  symbols: Record<string, string>;
  tracks: Record<string, Record<string, Track>>;
  places: Record<string, number[] | number[][]>;
}

/** A keyframe of our own small motions: transform and opacity only (they run on the compositor). */
export interface ShowKeyframe {
  offset?: number;
  transform?: string;
  opacity?: number;
  easing?: string;
}

/** A voice clip in a `voice` step: its key in the game's sound files and how long it lasts. */
export interface VoiceClip {
  clip: string;
  ms: number;
  /** The words, shown while it plays. */
  text?: string;
}

/**
 * Who a step is for: everyone (default), `you` (a personal cue: every player's own device, never
 * the table screen) or one player's id (only that player's devices).
 */
export type StepFor = 'all' | 'you' | (string & {});

interface StepBase {
  /** When it starts, in ms after the moment's `at`. */
  t: number;
  /** The profiles that play it (default: all of them). */
  on?: readonly Profile[];
  for?: StepFor;
}

export type Step = StepBase &
  (
    | { kind: 'anim'; target: string; track: `${string}.${string}` }
    | { kind: 'css'; target: string; keyframes: ShowKeyframe[]; ms: number; easing?: string }
    | { kind: 'set'; target: string; attr: string; value: string }
    | { kind: 'text'; target: string; text: string }
    | {
        kind: 'count';
        target: string;
        from: number;
        to: number;
        ms: number;
        format?: 'money' | 'int';
      }
    | { kind: 'sfx'; clip: string; gain?: number; ms?: number }
    | { kind: 'voice'; clips: VoiceClip[] }
    | { kind: 'haptic'; pattern: number[] }
    | { kind: 'flash'; colour: 'accent' | 'danger' | 'success'; ms?: number }
    | { kind: 'shake'; target: string; ms: number; px: number }
    | { kind: 'confetti'; n: number }
    | { kind: 'sprite'; target: string; sheet: string; ms: number }
    | { kind: 'subtitle'; text: string; ms?: number }
  );

export type StepKind = Step['kind'];

/** A beat of the show: a stable id (never replayed), its server start time and its steps. */
export interface Moment {
  id: string;
  at: number;
  steps: Step[];
}

/** A sound, haptic or flash more than this late is dropped (a sound inside it starts part-way). */
export const STALE_MS = 1500;
/** How long a confetti burst lasts. */
export const CONFETTI_MS = 1200;
/** How long an edge flash lasts unless the step says. */
export const FLASH_MS = 300;

/** Steps that happen once and leave nothing behind: late ones are dropped, never caught up. */
const TRANSIENT = new Set<StepKind>(['sfx', 'voice', 'haptic', 'flash']);
/** Steps that only move things around: reduced motion and low effects skip them. */
const EFFECTS = new Set<StepKind>(['flash', 'shake', 'confetti']);

/** The device a moment plays on. */
export interface ScheduleCtx {
  profile: Profile;
  /** The player this device belongs to; null on the table screen. */
  you: string | null;
  /** Reduced motion: every state change and sound, no movement. */
  reduced: boolean;
  /** Battery saver: no flashes, shakes, confetti or sprites; on phones no vector motion either. */
  low: boolean;
  tracks: Rig['tracks'];
}

/** A step as this device plays it. */
export interface Scheduled {
  step: Step;
  /** Ms from now until it starts (0 when it has already started). */
  delay: number;
  /** Ms into the step to start from (0 when it is still to come). */
  offset: number;
  /** How long it lasts (0 for a state change). */
  ms: number;
  /**
   * `play`: run it from `offset`; `end`: show its end state without moving (a state change, a
   * finished animation, reduced motion or low effects).
   */
  mode: 'play' | 'end';
  /** For a voice step: the one clip this entry plays. */
  clip?: VoiceClip;
}

/** The track a step names (`stamp.Appear`), or null when the rig has none. */
export function trackOf(tracks: Rig['tracks'], key: string): Track | null {
  const dot = key.indexOf('.');
  if (dot < 0) return null;
  return tracks[key.slice(0, dot)]?.[key.slice(dot + 1)] ?? null;
}

/** How long a step lasts (0 for state changes and steps whose length the player decides). */
export function stepMs(step: Step, tracks: Rig['tracks']): number {
  switch (step.kind) {
    case 'anim':
      return trackOf(tracks, step.track)?.ms ?? 0;
    case 'css':
    case 'count':
    case 'shake':
    case 'sprite':
      return step.ms;
    case 'voice':
      return step.clips.reduce((sum, c) => sum + c.ms, 0);
    case 'confetti':
      return CONFETTI_MS;
    case 'flash':
      return step.ms ?? FLASH_MS;
    case 'sfx':
    case 'subtitle':
      return step.ms ?? 0;
    default:
      return 0;
  }
}

/** When the moment is over, in ms after its `at`: when its last step has finished. */
export function momentEnd(m: Moment, tracks: Rig['tracks']): number {
  let end = 0;
  for (const s of m.steps) end = Math.max(end, s.t + stepMs(s, tracks));
  return end;
}

/** Whether a step is meant for this device at all (its profiles and who it is for). */
export function playsOn(step: Step, ctx: Pick<ScheduleCtx, 'profile' | 'you'>): boolean {
  if (step.on && !step.on.includes(ctx.profile)) return false;
  const who = step.for ?? 'all';
  if (who === 'all') return true;
  if (who === 'you') return ctx.you !== null;
  return ctx.you === who;
}

/**
 * Which steps of a moment this device plays at `now` (server ms), and how: in start order (ties
 * keep the moment's order, so of two state changes at the same time the later one wins). A step
 * already past starts part-way (an animation seeks, a sound starts `offset` in so it ends on time)
 * or, once finished, shows its end state; sounds, haptics and flashes more than `STALE_MS` late are
 * dropped. Reduced motion keeps every state change and sound but no movement; low effects drops
 * flashes, shakes, confetti and sprites, and on phones the vector motion.
 */
export function schedule(m: Moment, now: number, ctx: ScheduleCtx): Scheduled[] {
  const elapsed = now - m.at;
  const out: { s: Scheduled; start: number; i: number }[] = [];
  const phone = ctx.profile !== 'stage';
  m.steps.forEach((step, i) => {
    if (!playsOn(step, ctx)) return;
    if (EFFECTS.has(step.kind) && (ctx.reduced || ctx.low)) return;
    if (step.kind === 'sprite' && ctx.low) return;
    const ms = stepMs(step, ctx.tracks);
    const late = elapsed - step.t;
    const delay = Math.max(0, -late);
    const offset = Math.max(0, late);
    const push = (s: Omit<Scheduled, 'step'>, start = step.t) =>
      out.push({ s: { step, ...s }, start, i });

    if (step.kind === 'voice') {
      // Each clip is its own sound: a late device hears the rest of the line from where it is.
      let start = 0;
      for (const clip of step.clips) {
        const clipLate = late - start;
        start += clip.ms;
        if (clipLate >= clip.ms || clipLate > STALE_MS) continue;
        push(
          {
            delay: Math.max(0, -clipLate),
            offset: Math.max(0, clipLate),
            ms: clip.ms,
            mode: 'play',
            clip,
          },
          step.t + start - clip.ms,
        );
      }
      return;
    }
    if (TRANSIENT.has(step.kind)) {
      if (late > STALE_MS) return;
      if (ms > 0 && late >= ms) return;
      push({ delay, offset, ms, mode: 'play' });
      return;
    }
    switch (step.kind) {
      case 'set':
      case 'text':
        push({ delay, offset: 0, ms: 0, mode: 'end' });
        return;
      case 'subtitle':
        // A line with a length leaves nothing behind once it has been said.
        if (ms > 0 && late >= ms) return;
        push({ delay, offset, ms, mode: 'end' });
        return;
      case 'shake':
      case 'confetti':
        // Motions with no end state: a late one plays its rest, a finished one nothing.
        if (late >= ms) return;
        push({ delay, offset, ms, mode: 'play' });
        return;
      default: {
        // anim, css, count, sprite: things that end somewhere.
        const still =
          ctx.reduced ||
          (ctx.low && phone && step.kind === 'anim') ||
          (ctx.low && step.kind === 'count');
        if (still || late >= ms) push({ delay, offset: ms, ms, mode: 'end' });
        else push({ delay, offset: Math.min(offset, ms), ms, mode: 'play' });
      }
    }
  });
  out.sort((a, b) => a.start - b.start || a.i - b.i);
  return out.map((o) => o.s);
}

/**
 * A stable pick among `n` variants for a key (a bid's seq, a moment id), so every device shows the
 * same one where the original picked at random (a paddle's raise wobble).
 */
export function variantOf(key: string | number, n: number): number {
  const s = String(key);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % Math.max(1, n);
}

/** A matrix as a CSS transform. */
export function matrixCss(m: readonly number[]): string {
  return `matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4]},${m[5]})`;
}

/** A rig track as keyframes: one per original frame, evenly spaced, linear between them. */
export function trackKeyframes(track: Track): ShowKeyframe[] {
  const n = track.frames.length;
  return track.frames.map((f, i) => ({
    transform: matrixCss(f),
    opacity: f[6],
    offset: n > 1 ? i / (n - 1) : 0,
  }));
}

/** Where a track leaves its part. */
export function trackEnd(track: Track): { transform: string; opacity: number } {
  const f = track.frames.at(-1) ?? [1, 0, 0, 1, 0, 0, 1];
  return { transform: matrixCss(f), opacity: f[6] };
}

/** A count-up's value `k` (0–1) of the way through: eases out, like a meter settling. */
export function countAt(from: number, to: number, k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return from + (to - from) * (1 - (1 - c) ** 3);
}

/** The room snapshot's table-screen field (`RoomSnapshot.stage`): whether one is paired. */
export interface StagePresence {
  present: boolean;
}

/**
 * A device's profile: the table screen itself, else a phone that goes quiet while the room has a
 * table screen and plays the fuller show without one.
 */
export function profileFor(stage: StagePresence | null | undefined, isStage = false): Profile {
  if (isStage) return 'stage';
  return stage?.present ? 'phone-quiet' : 'phone-full';
}
