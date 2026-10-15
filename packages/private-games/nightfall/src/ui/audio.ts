import {
  type CuePart,
  NARRATION_GAP_MS,
  introLines,
  partLines,
  saidAt,
  stepParts,
} from '../logic/narration.ts';
import {
  FRAME_LINES,
  ORACLE_REPLY_MS,
  type StepId,
  pickRoleOf,
  publicPlan,
  stepMs,
  usesMarks,
} from '../logic/plan.ts';
import type { StepPick } from '../logic/tables.ts';
import {
  NIGHT_INTRO_MS,
  type NarrationMode,
  type NightfallView,
  type Phase,
} from '../logic/types.ts';

export { type CuePart, announcementLines, partLines, pickLines } from '../logic/narration.ts';

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
/** Close lines start this long before a step ends, or earlier when they are longer (`fitCues`). */
export const CLOSE_LEAD_MS = 2500;
/** A close whose length is known starts early enough to end this long before its step does. */
export const CLOSE_GAP_MS = NARRATION_GAP_MS;

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

/**
 * Some narration, due at a moment on the server clock. `id` is unique per game and moment;
 * `lines` are the narration keys of its `parts`, in the order they are said.
 */
export interface Cue {
  id: string;
  at: number;
  lines: string[];
  parts: CuePart[];
  /** A step's narration: the moment the step ends, which it should be said by. */
  until?: number;
  /** A step's close: it waits for the step's own narration before it. */
  close?: boolean;
  /** A step's narration: the step's index, so its words speak to that step's players only. */
  step?: number;
  /** Outside a step: when its words stop showing at the latest (the night's opening, the day). */
  ends?: number;
}

const line = (key: string): CuePart => ({ kind: 'line', key });

const cue = (
  id: string,
  at: number,
  parts: CuePart[],
  step?: { until: number; close?: boolean; index: number },
  ends?: number,
): Cue => ({
  id,
  at,
  lines: parts.flatMap(partLines),
  parts,
  ...(step ? { until: step.until, ...(step.close ? { close: true } : {}), step: step.index } : {}),
  ...(ends !== undefined ? { ends } : {}),
});

/**
 * When the current step started: sent with the view, or, from a server that doesn't send it,
 * worked out from its deadline and its plain length.
 */
function stepStart(
  night: NonNullable<NightfallView['night']>,
  plan: readonly StepId[],
  s: NightfallView['settings'],
) {
  if (night.start !== undefined) return night.start;
  return night.index < 0
    ? night.deadline - NIGHT_INTRO_MS
    : night.deadline - stepMs(plan[night.index]!, s.stepSeconds);
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
    const plan = publicPlan(s.roles, view.announcements);
    const start = stepStart(view.night, plan, s);
    if (index < 0) {
      const cues: Cue[] = [
        cue(`${game}:night`, start, introLines(s.roles).map(line), undefined, deadline),
      ];
      // The first wake is cued ahead, unless its instruction is drawn only as the step begins:
      // that cue comes with the step, so its wake line and instruction are said together.
      if (plan.length && !pickRoleOf(plan[0]!))
        cues.push(...stepCues(game, plan[0]!, 0, deadline, null, s, {}));
      return cues;
    }
    // What the narrator announces as this step begins (or as the last one ended) comes first.
    const said = saidAt(view.announcements, start);
    const cues = stepCues(game, plan[index]!, index, start, deadline, s, {
      said,
      pick: view.night.pick,
    });
    // The narrator's reply to the Oracle, at its fixed moment before her step closes.
    if (plan[index] === 'oracle') {
      const at = deadline - ORACLE_REPLY_MS;
      const reply = saidAt(view.announcements, at);
      if (reply.length)
        cues.push(cue(`${game}:${index}:reply`, at, reply, { until: deadline, index }));
    }
    return cues;
  }
  if (view.phase === 'day' && view.day?.deadline) {
    const end = view.day.deadline;
    // The aliens' timer and the ripples can shorten the day.
    const seconds = view.day.seconds ?? s.daySeconds;
    const dawn = end - seconds * 1000;
    const cues: Cue[] = [
      cue(
        `${game}:dawn`,
        dawn,
        [
          ...saidAt(view.announcements, dawn),
          line(usesMarks(s.roles) ? FRAME_LINES.nightEndMarks : FRAME_LINES.nightEnd),
          line(FRAME_LINES.dayStart),
        ],
        undefined,
        end,
      ),
    ];
    if (seconds > 90)
      cues.push(cue(`${game}:1m`, end - 60_000, [line(FRAME_LINES.oneMinute)], undefined, end));
    if (seconds > 45)
      cues.push(
        cue(`${game}:30s`, end - 30_000, [line(FRAME_LINES.thirtySeconds)], undefined, end),
      );
    return cues;
  }
  if (view.phase === 'vote' && view.vote?.deadline) {
    const end = view.vote.deadline;
    return [cue(`${game}:vote`, end - 60_000, [line(FRAME_LINES.vote)], undefined, end)];
  }
  return [];
}

/** A step's cues: its opening as it starts, and its close before `end` (none when it is cued ahead). */
function stepCues(
  game: string,
  id: StepId,
  index: number,
  start: number,
  end: number | null,
  s: NightfallView['settings'],
  opts: { said?: CuePart[]; pick?: StepPick | undefined },
): Cue[] {
  const { open, close } = stepParts(id, s, opts);
  if (end === null) return [cue(`${game}:${index}:open`, start, open)];
  return [
    cue(`${game}:${index}:open`, start, open, { until: end, index }),
    cue(`${game}:${index}:close`, Math.max(start + 1000, end - CLOSE_LEAD_MS), close, {
      until: end,
      close: true,
      index,
    }),
  ];
}

/**
 * The cues with each close moved earlier when its clips are known to be longer than the lead, so
 * it ends just before its step does instead of running over the next wake (never earlier than a
 * second into the step). `lengths` holds the clip lengths this device has learned, in ms.
 */
export function fitCues<C extends Cue>(
  cues: readonly C[],
  narration: Record<string, readonly string[]> | undefined,
  lengths: ReadonlyMap<string, number>,
): C[] {
  return cues.map((c) => {
    if (!c.close || c.until === undefined) return c;
    const clips = clipsFor(narration, c.lines);
    if (!clips.length || clips.some((src) => !lengths.has(src))) return c;
    const length = clips.reduce((sum, src) => sum + lengths.get(src)!, 0);
    const open = cues.find((o) => o.until === c.until && !o.close && o.at <= c.at);
    const earliest = open ? open.at + 1000 : c.at;
    const at = Math.max(earliest, Math.min(c.at, c.until - length - CLOSE_GAP_MS));
    return at === c.at ? c : { ...c, at };
  });
}

/** The clips for some lines, in order, from the manifest's narration map. */
export function clipsFor(
  narration: Record<string, readonly string[]> | undefined,
  lines: readonly string[],
): string[] {
  return lines.flatMap((l) => narration?.[l] ?? []);
}

/** Cues worth starting now: due, not stale (a device that joins late doesn't replay the past). */
export function dueCues<C extends Pick<Cue, 'id' | 'at'>>(
  cues: readonly C[],
  now: number,
  played: ReadonlySet<string>,
  graceMs = 3000,
) {
  return cues.filter((c) => !played.has(c.id) && c.at <= now && now - c.at <= graceMs);
}

// ---- The narration as text ----

/**
 * A cue's words on screen, from `start` until `end` (server clock), unless a later cue's words
 * replace them first. `spoken` is when its narration is expected to end, so the next cue's words
 * wait for it as its clips do.
 */
export interface Shown {
  cue: string;
  parts: CuePart[];
  /** A step's narration: its words speak to that step's players only. */
  step?: number;
  start: number;
  end: number;
  spoken: number;
  /** With narration on: its step's end (or the night's opening's, or the day's), if known. */
  limit?: number;
  /** While waiting for its first clip: the planned window. */
  plan?: Pick<Shown, 'start' | 'end' | 'spoken'>;
}

/** With narration off, words show this long (never past their step's end). */
export const SHOW_MS = 8000;
/** With narration off, words stay up at least this long, so they can be read. */
export const MIN_SHOW_MS = 2500;
/** Allowed per clip, on top of its length, for loading it and starting it on a speaking device. */
export const CLIP_SLACK_MS = 150;

/**
 * When a cue's words show. With narration on, they show from the moment it is expected to be
 * said (its moment, or once the narration before it is expected to end, as clips queue) and stay
 * until the next cue's words replace them or its step (or the night's opening, or the day) ends:
 * no timer guessed from clip lengths ever blanks them, so a speaker that runs late or a device
 * that drops clips still has them on screen. They stay past the step's end while they are
 * expected to be said. With narration off they show for `SHOW_MS`, never past the step's end. A
 * device that plays the clips itself times them by what it plays instead (`startShown`,
 * `endShown`).
 */
export function scheduleShown(
  c: Pick<Cue, 'id' | 'at' | 'lines' | 'parts' | 'until' | 'step' | 'ends'>,
  before: readonly Shown[],
  opts: {
    narrated: boolean;
    narration: Record<string, readonly string[]> | undefined;
    lengths: ReadonlyMap<string, number>;
  },
): Shown {
  const base = { cue: c.id, parts: c.parts, ...(c.step !== undefined ? { step: c.step } : {}) };
  if (!opts.narrated) {
    const end =
      c.until !== undefined
        ? Math.max(c.at + MIN_SHOW_MS, Math.min(c.at + SHOW_MS, c.until))
        : c.at + SHOW_MS;
    return { ...base, start: c.at, end, spoken: c.at };
  }
  const limit = c.ends ?? c.until;
  const held = { ...(limit !== undefined ? { limit } : {}) };
  const clips = clipsFor(opts.narration, c.lines);
  if (clips.length && clips.every((src) => opts.lengths.has(src))) {
    const length =
      clips.reduce((sum, src) => sum + opts.lengths.get(src)!, 0) + clips.length * CLIP_SLACK_MS;
    // Words still waiting for their first clip on this device don't hold later ones back.
    const start = Math.max(c.at, ...before.map((s) => s.spoken).filter(Number.isFinite));
    const spoken = start + length;
    return { ...base, ...held, start, end: Math.max(limit ?? Infinity, spoken), spoken };
  }
  return { ...base, ...held, start: c.at, end: limit ?? Infinity, spoken: c.at };
}

/**
 * A cue's step end, learned once the step has begun (the first step's wake is cued during the
 * night's opening, before its end is known): words held with no end yet now end with the step.
 */
export function limitShown(s: Shown, c: Pick<Cue, 'until' | 'step' | 'ends'>): Shown {
  const limit = c.ends ?? c.until;
  if (s.limit !== undefined || limit === undefined) return s;
  const step = c.step !== undefined ? { step: c.step } : {};
  // Words timed by `SHOW_MS` (narration off) keep their end.
  if (s.end !== Infinity) return { ...s, ...step };
  if (s.start === Infinity) {
    // Waiting for its first clip: only its plan changes.
    const plan = s.plan && { ...s.plan, end: Math.max(limit, s.plan.spoken) };
    return { ...s, ...step, limit, ...(plan ? { plan } : {}) };
  }
  // Its clips are playing (`spoken` not known yet): the words stay until they end.
  if (s.spoken === Infinity) return { ...s, ...step, limit };
  return { ...s, ...step, limit, end: Math.max(limit, s.spoken) };
}

/** Waiting for its first clip to play on this device: not shown yet, its plan kept. */
export const pendingShown = (s: Shown): Shown => ({
  ...s,
  start: Infinity,
  end: Infinity,
  spoken: Infinity,
  plan: { start: s.start, end: s.end, spoken: s.spoken },
});

/** Its first clip started playing at `now`: the words show from now, until its last clip ends. */
export function startShown(s: Shown, now: number): Shown {
  if (s.start !== Infinity) return s;
  const { plan: _plan, ...rest } = s;
  return { ...rest, start: now };
}

/**
 * Its last clip ended (or the rest was dropped) at `now`: the words stay until the next cue's
 * replace them or its step ends (never shorter than its clips). Words whose clips were all
 * dropped (a phone in the background, a blocked tab) show from now on the same terms, however
 * late: what a device didn't say still reaches its screen.
 */
export function endShown(s: Shown, now: number): Shown {
  const { plan: _plan, ...rest } = s;
  const end = Math.max(now, s.limit ?? Infinity);
  if (s.start === Infinity)
    return { ...rest, start: Math.min(now, s.plan?.start ?? now), end, spoken: now };
  return { ...rest, end, spoken: now };
}

/**
 * The words on screen at `now`: of the cues showing, the one due last (`list` is in the order
 * the cues came due), so a cue's words replace the ones before it however late its clips start.
 */
export function shownAt(list: readonly Shown[], now: number): Shown | null {
  let best: Shown | null = null;
  for (const s of list) if (s.start <= now && now < s.end) best = s;
  return best;
}

/**
 * Whether the words speak to this device's player: a step's narration only while that player
 * is awake in that very step (`step`, the night's current step, or undefined after the night).
 * Anyone else, and anyone once the step has moved on, reads them in the third person, the same
 * for everyone, so lingering words never tell who acts.
 */
export const speaksTo = (shown: Pick<Shown, 'step'>, awake: boolean, step: number | undefined) =>
  awake && (shown.step === undefined || shown.step === step);

// ---- The narration queue ----

/**
 * A narration clip waiting to play. `at` is the moment it is due in sequence (server clock): its
 * cue's moment for the cue's first clip, and for each later one the moment the clip before it was
 * due plus that clip's length, set once the clip before it has played (`afterClip`).
 */
export interface QueuedClip {
  src: string;
  /** The id of the cue it belongs to. */
  cue: string;
  /** Its place in its cue (0 for the first clip). */
  n: number;
  at?: number;
  /** Its step's end (step cues only). */
  until?: number;
  /** A close's clip: it waits for the narration before it. */
  waits?: boolean;
}

/** A clip that couldn't start within this long of when it was due is dropped, not played late. */
export const STALE_CLIP_MS = 4000;

/**
 * How far past its step's end a step's narration may run (pushing the next step's wake back)
 * before the clips that don't fit are dropped.
 */
export const OVERRUN_MS = 3000;

/**
 * The queue once a new cue is due: its clips go after any still waiting, so every cue is said in
 * order and in full whenever it fits (`nextClip` drops what doesn't).
 */
export function enqueueClips(
  clips: readonly string[],
  cue: Pick<Cue, 'id' | 'at' | 'until' | 'close'>,
  queue: readonly QueuedClip[] = [],
): QueuedClip[] {
  return [
    ...queue,
    ...clips.map((src, n) => ({
      src,
      cue: cue.id,
      n,
      ...(n === 0 ? { at: cue.at } : {}),
      ...(cue.until !== undefined ? { until: cue.until } : {}),
      ...(cue.close ? { waits: true } : {}),
    })),
  ];
}

/**
 * The queue once `played` has finished after `lengthMs`: the next clip of its cue is due when
 * `played` was due plus its length, so a cue's clips follow each other however long each is, and
 * a cue that started a little late stays only that late.
 */
export function afterClip(
  queue: readonly QueuedClip[],
  played: QueuedClip,
  lengthMs: number,
): QueuedClip[] {
  const [next, ...rest] = queue;
  if (!next || next.cue !== played.cue || next.at !== undefined || played.at === undefined)
    return [...queue];
  return [{ ...next, at: played.at + Math.max(0, lengthMs) }, ...rest];
}

/**
 * The next clip worth playing now, and what's left after it. A clip is dropped with the rest of
 * its cue (an instruction's tail means nothing without its start) when:
 * - it is more than `staleMs` past its moment (a device that woke up late, or was in the
 *   background);
 * - it is known not to end by its step's end (plus `overrunMs`), unless it is the first clip of a
 *   step's wake: the wake line itself is always said;
 * - a later cue that doesn't wait (the next step's wake, the dawn) has already waited `overrunMs`
 *   behind it (for clips whose length isn't known yet).
 * A close's clips wait behind its step's wake and instruction, and the next wake behind the close,
 * as long as they fit.
 */
export function nextClip(
  queue: readonly QueuedClip[],
  now: number,
  opts: { staleMs?: number; overrunMs?: number; lengths?: ReadonlyMap<string, number> } = {},
): { clip: QueuedClip | null; rest: QueuedClip[] } {
  const { staleMs = STALE_CLIP_MS, overrunMs = OVERRUN_MS, lengths } = opts;
  let rest = [...queue];
  while (rest.length) {
    const [clip, ...after] = rest;
    // A clip whose predecessor's length never came is due no later than now.
    const at = clip!.at ?? now;
    const length = lengths?.get(clip!.src) ?? 0;
    const overruns =
      clip!.until !== undefined &&
      (clip!.n > 0 || clip!.waits === true) &&
      now + length > clip!.until + overrunMs;
    const held = after.find((c) => c.cue !== clip!.cue && !c.waits && c.at !== undefined);
    const holding = held !== undefined && now > held.at! + overrunMs;
    if (now - at <= staleMs && !overruns && !holding)
      return { clip: { ...clip!, at }, rest: after };
    rest = after.filter((c) => c.cue !== clip!.cue);
  }
  return { clip: null, rest: [] };
}
