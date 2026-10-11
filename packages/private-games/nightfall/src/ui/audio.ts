import { FRAME_LINES, type StepId, buildNightPlan, stepFactor, stepLines } from '../logic/plan.ts';
import {
  NIGHT_INTRO_MS,
  type NarrationMode,
  type NightfallView,
  type Phase,
} from '../logic/types.ts';

// The pure half of the sound: which clips play when, which music track each phase plays, and
// how loud. The React hook in `useSound.ts` only turns these decisions into audio elements, so
// everything here is testable without a browser. Every device works these out from the same
// view and server clock, so devices that play sound play the same clips at the same moments.

export type MusicPhase = 'lobby' | 'night' | 'day' | 'vote' | 'reveal';

/** Music volume out of the box, as a share of full volume. */
export const DEFAULT_MUSIC_VOLUME = 0.35;
/** Music drops to this share of its volume while a narration clip plays. */
export const DUCK_RATIO = 0.25;
/** How long music takes to fade between phases, and in and out of ducking. */
export const CROSSFADE_MS = 1500;
export const DUCK_FADE_MS = 300;
/** Close lines start this long before a step ends. */
export const CLOSE_LEAD_MS = 2500;

/** Which music a game phase plays. Getting ready keeps the lobby's track. */
export function musicPhaseFor(phase: Phase): MusicPhase {
  switch (phase) {
    case 'lobby':
    case 'ready':
      return 'lobby';
    case 'night':
      return 'night';
    case 'day':
      return 'day';
    case 'vote':
      return 'vote';
    case 'reveal':
      return 'reveal';
  }
}

/**
 * The track for a phase: the first listed for the first game, then the next one each game, so
 * every device picks the same track. Null when the phase has no music.
 */
export function trackFor(
  music: Partial<Record<MusicPhase, readonly string[]>> | undefined,
  phase: MusicPhase,
  gameNumber: number,
): string | null {
  const list = music?.[phase]?.filter((t) => typeof t === 'string' && t) ?? [];
  if (!list.length) return null;
  return list[Math.max(0, gameNumber - 1) % list.length]!;
}

/** Whether this device makes sound at all: the host's narration choice, and its own switch. */
export function deviceSpeaks(mode: NarrationMode, isHost: boolean): boolean {
  return mode === 'all' || (mode === 'host' && isHost);
}

/** Whether this device plays music now. */
export function devicePlaysMusic(opts: {
  mode: NarrationMode;
  isHost: boolean;
  /** The host's "Background music" switch. */
  gameMusic: boolean;
  /** This device's own music switch. */
  deviceMusic: boolean;
}): boolean {
  return deviceSpeaks(opts.mode, opts.isHost) && opts.gameMusic && opts.deviceMusic;
}

/** The music volume to aim for: ducked while narration speaks. */
export const musicTarget = (volume: number, narrating: boolean) =>
  Math.max(0, Math.min(1, volume)) * (narrating ? DUCK_RATIO : 1);

/** What to do when the wanted track changes: fade the old one out and the new one in. */
export function musicChange(
  playing: string | null,
  wanted: string | null,
): { fadeOut: string | null; fadeIn: string | null } {
  if (playing === wanted) return { fadeOut: null, fadeIn: null };
  return { fadeOut: playing, fadeIn: wanted };
}

/** A linear ramp from `from` to `to` over `ms`, sampled `elapsed` ms in. */
export function ramp(from: number, to: number, elapsed: number, ms: number): number {
  if (ms <= 0 || elapsed >= ms) return to;
  if (elapsed <= 0) return from;
  return from + ((to - from) * elapsed) / ms;
}

// ---- Narration cues ----

/** Some narration, due at a moment on the server clock. `id` is unique per game and moment. */
export interface Cue {
  id: string;
  at: number;
  lines: string[];
}

/** When each step of tonight's plan starts, from the current step's deadline. */
function stepStarts(plan: readonly StepId[], stepSeconds: number, index: number, deadline: number) {
  const len = (i: number) => stepFactor(plan[i]!) * stepSeconds * 1000;
  const starts: number[] = [];
  let at = deadline - len(index);
  starts[index] = at;
  for (let i = index + 1; i < plan.length; i++) {
    at += len(i - 1);
    starts[i] = at;
  }
  return starts;
}

/**
 * The narration due in the current phase, as cues on the server clock: the night's opening
 * line, each step's wake and close lines, the warnings in the day, and the call to vote. The
 * night's plan comes from the public roles, so this never needs to know who holds what.
 */
export function cuesFor(view: NightfallView): Cue[] {
  const game = `${view.gamesPlayed}`;
  const s = view.settings;
  if (view.phase === 'night' && view.night) {
    const { index, deadline } = view.night;
    const plan = buildNightPlan(s.roles);
    if (index < 0) {
      const cues: Cue[] = [
        { id: `${game}:night`, at: deadline - NIGHT_INTRO_MS, lines: [FRAME_LINES.nightStart] },
      ];
      if (plan.length) cues.push(...stepCues(game, plan, 0, deadline, s, true));
      return cues;
    }
    const starts = stepStarts(plan, s.stepSeconds, index, deadline);
    return stepCues(game, plan, index, starts[index]!, s, false);
  }
  if (view.phase === 'day' && view.day?.deadline) {
    const end = view.day.deadline;
    const dawn = end - s.daySeconds * 1000;
    const cues: Cue[] = [
      { id: `${game}:dawn`, at: dawn, lines: [FRAME_LINES.nightEnd, FRAME_LINES.dayStart] },
    ];
    if (s.daySeconds > 90)
      cues.push({ id: `${game}:1m`, at: end - 60_000, lines: [FRAME_LINES.oneMinute] });
    if (s.daySeconds > 45)
      cues.push({ id: `${game}:30s`, at: end - 30_000, lines: [FRAME_LINES.thirtySeconds] });
    return cues;
  }
  if (view.phase === 'vote' && view.vote?.deadline) {
    return [{ id: `${game}:vote`, at: view.vote.deadline - 60_000, lines: [FRAME_LINES.vote] }];
  }
  return [];
}

function stepCues(
  game: string,
  plan: readonly StepId[],
  index: number,
  start: number,
  s: NightfallView['settings'],
  upcoming: boolean,
): Cue[] {
  const id = plan[index]!;
  const lines = stepLines(id, s.roles, { loneWolf: s.loneWolf });
  const end = start + stepFactor(id) * s.stepSeconds * 1000;
  const cues: Cue[] = [{ id: `${game}:${index}:open`, at: start, lines: lines.open }];
  if (!upcoming)
    cues.push({
      id: `${game}:${index}:close`,
      at: Math.max(start + 1000, end - CLOSE_LEAD_MS),
      lines: lines.close,
    });
  return cues;
}

/** The clips for some lines, in order, from the manifest's narration map. */
export function clipsFor(
  narration: Record<string, readonly string[]> | undefined,
  lines: readonly string[],
): string[] {
  return lines.flatMap((l) => narration?.[l] ?? []);
}

/** Cues worth starting now: due, not stale (a device that joins late doesn't replay the past). */
export function dueCues(
  cues: readonly Cue[],
  now: number,
  played: ReadonlySet<string>,
  graceMs = 3000,
) {
  return cues.filter((c) => !played.has(c.id) && c.at <= now && now - c.at <= graceMs);
}
