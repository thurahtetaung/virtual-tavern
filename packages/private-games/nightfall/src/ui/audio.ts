import {
  FRAME_LINES,
  type StepId,
  epicPossible,
  publicPlan,
  stepMs,
  stepLines,
  usesMarks,
} from '../logic/plan.ts';
import { type PlayerSet, blobKey } from '../logic/tables.ts';
import {
  type Announcement,
  NIGHT_INTRO_MS,
  type NarrationMode,
  type NightfallView,
  type Phase,
  type PublicNote,
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

// ---- What the narrator says out loud for everyone ----

/** Player numbers, spoken: "player:3", joined by `and` or `or`. */
const spoken = (ns: readonly number[], joiner: 'and' | 'or') =>
  ns.flatMap((n, i) => (i ? [`fragment:${joiner}`, `player:${n}`] : [`player:${n}`]));

/** A set of players, as the narrator's fragments ("Any even player", "the centre"…). */
function setLines(set: PlayerSet, group: boolean): string[] {
  switch (set.kind) {
    case 'everyone':
      return ['fragment:everyone'];
    case 'any':
      return ['fragment:any-player'];
    case 'even':
      return [group ? 'fragment:even-players' : 'fragment:any-even-player'];
    case 'odd':
      return [group ? 'fragment:odd-players' : 'fragment:any-odd-player'];
    case 'numbers':
      return spoken(set.numbers, group ? 'and' : 'or');
    case 'center':
      return ['fragment:center'];
    default:
      return [];
  }
}

/** The narration keys for an announcement, in the order they are said. */
export function announcementLines(a: Announcement): string[] {
  switch (a.kind) {
    case 'oracle-parity':
      return [`oracle:answer:${a.parity}`];
    case 'oracle-view':
      return [`oracle:answer:view-player:${a.swapped ? 'other' : 'yes'}`, `player:${a.number}`];
    case 'oracle-number':
      return [`oracle:answer:number:${a.right ? 'right' : 'wrong'}`];
    case 'nostradamus':
      return [
        a.doppel ? 'doppelganger:nostradamus:announce' : 'nostradamus:announce',
        `nostradamus:team:${a.team}`,
      ];
    case 'blob':
      return [
        `blob:members:${blobKey(a.shape)}`,
        a.shape.left + a.shape.right === 1 ? 'blob:end:one' : 'blob:end:many',
      ];
    case 'ripple': {
      const rp = a.ripple;
      const intro = 'ripple:intro';
      switch (rp.key) {
        case 'none':
          return [];
        case 'one-minute':
          return [intro, 'ripple:event:one-minute'];
        case 'vote-for-app':
          return [intro, 'ripple:event:vote-for-app'];
        case 'repeat-role':
          return [intro, `name:${rp.role}`, 'ripple:event:repeat-role'];
        case 'i-am-alien':
        case 'face-away':
        case 'two-hand-vote':
        case 'no-speak':
          return [intro, ...setLines(rp.who, true), `ripple:event:${rp.key}`];
        case 'view-1':
        case 'view-2':
          return [
            intro,
            `player:${rp.actor}`,
            `ripple:event:${rp.key}`,
            ...setLines(rp.from, false),
          ];
        case 'dual-view':
          return [
            intro,
            ...spoken(rp.actors, 'and'),
            'ripple:event:view-2',
            ...setLines(rp.from, false),
          ];
        case 'insomniac':
          return [intro, ...spoken(rp.actors, 'and'), 'ripple:event:insomniac'];
        case 'troublemaker':
          return [
            intro,
            `player:${rp.actor}`,
            'ripple:event:troublemaker',
            ...spoken(rp.between, 'and'),
            'ripple:event:troublemaker:end',
          ];
        case 'steal':
        case 'drunk':
          return [
            intro,
            `player:${rp.actor}`,
            `ripple:event:${rp.key}`,
            ...setLines(rp.from, false),
            `ripple:event:${rp.key}:end`,
          ];
        case 'witch':
          return [intro, `player:${rp.actor}`, 'ripple:event:witch', ...setLines(rp.from, false)];
        case 'reveal':
          return [
            intro,
            `player:${rp.actor}`,
            'ripple:event:reveal',
            rp.target === 'yourself' ? 'fragment:yourself' : `fragment:${rp.target}-neighbor`,
            'ripple:event:reveal:end',
          ];
        case 'shuffle': {
          const other = rp.players.find((n) => n !== rp.giver) ?? rp.giver;
          return [
            intro,
            ...spoken(rp.players, 'and'),
            'ripple:event:shuffle:1',
            `player:${rp.giver}`,
            'ripple:event:shuffle:2',
            `player:${other}`,
            'ripple:event:shuffle:3',
          ];
        }
        case 'repeat-night':
          return [intro, 'ripple:event:repeat-night'];
        case 'repeat-observer':
          return [
            intro,
            'ripple:event:repeat-night',
            `player:${rp.observer}`,
            'ripple:event:repeat-night:observer-end',
          ];
      }
    }
  }
}

/** The lines of the announcements made at `at` (a step's start, or the dawn), in order. */
const saidAt = (announcements: readonly PublicNote[], at: number) =>
  announcements.filter((a) => Math.abs(a.at - at) < 500).flatMap(announcementLines);

/** When each step of tonight's plan starts, from the current step's deadline. */
function stepStarts(plan: readonly StepId[], stepSeconds: number, index: number, deadline: number) {
  const len = (i: number) => stepMs(plan[i]!, stepSeconds);
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
    const plan = publicPlan(s.roles, view.announcements);
    if (index < 0) {
      // With werewolves and vampires both in the game, the narrator warns of an epic battle.
      const open = epicPossible(s.roles)
        ? [FRAME_LINES.epicBattle, FRAME_LINES.nightStart]
        : [FRAME_LINES.nightStart];
      const cues: Cue[] = [{ id: `${game}:night`, at: deadline - NIGHT_INTRO_MS, lines: open }];
      if (plan.length) cues.push(...stepCues(game, plan, 0, deadline, s, true));
      return cues;
    }
    const starts = stepStarts(plan, s.stepSeconds, index, deadline);
    const cues = stepCues(game, plan, index, starts[index]!, s, false);
    // What the narrator announces as this step begins (or as the last one ended) comes first.
    const said = saidAt(view.announcements, starts[index]!);
    if (said.length) cues[0] = { ...cues[0]!, lines: [...said, ...cues[0]!.lines] };
    return cues;
  }
  if (view.phase === 'day' && view.day?.deadline) {
    const end = view.day.deadline;
    // The aliens' timer and the ripples can shorten the day.
    const seconds = view.day.seconds ?? s.daySeconds;
    const dawn = end - seconds * 1000;
    const cues: Cue[] = [
      {
        id: `${game}:dawn`,
        at: dawn,
        lines: [
          ...saidAt(view.announcements, dawn),
          usesMarks(s.roles) ? FRAME_LINES.nightEndMarks : FRAME_LINES.nightEnd,
          FRAME_LINES.dayStart,
        ],
      },
    ];
    if (seconds > 90)
      cues.push({ id: `${game}:1m`, at: end - 60_000, lines: [FRAME_LINES.oneMinute] });
    if (seconds > 45)
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
  const end = start + stepMs(id, s.stepSeconds);
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

// ---- The narration queue ----

/** A narration clip waiting to play, with the moment its cue was due (server clock). */
export interface QueuedClip {
  src: string;
  at: number;
}

/** A clip that couldn't start within this long of its cue is dropped, not played late. */
export const STALE_CLIP_MS = 4000;

/**
 * The queue once a new cue is due: its clips replace any that haven't started yet, so a long
 * clip never pushes the next step's narration ever further behind.
 */
export function enqueueClips(clips: readonly string[], at: number): QueuedClip[] {
  return clips.map((src) => ({ src, at }));
}

/** The next clip worth playing now, and what's left after it (stale clips are dropped). */
export function nextClip(
  queue: readonly QueuedClip[],
  now: number,
  staleMs = STALE_CLIP_MS,
): { clip: QueuedClip | null; rest: QueuedClip[] } {
  const fresh = queue.filter((c) => now - c.at <= staleMs);
  return { clip: fresh[0] ?? null, rest: fresh.slice(1) };
}
