import {
  FRAME_LINES,
  ORACLE_REPLY_MS,
  type StepId,
  epicPossible,
  pickRoleOf,
  publicPlan,
  stepDef,
  stepMs,
  stepLines,
  usesMarks,
} from '../logic/plan.ts';
import { type PlayerSet, type StepPick, blobKey } from '../logic/tables.ts';
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
/** Close lines start this long before a step ends, or earlier when they are longer (`fitCues`). */
export const CLOSE_LEAD_MS = 2500;
/** A close whose length is known starts early enough to end this long before its step does. */
export const CLOSE_GAP_MS = 500;

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
 * A piece of what the narrator says: a line of its own, a step's random instruction, or an
 * announcement. Each knows its narration keys; the screen words each its own way.
 */
export type CuePart =
  | { kind: 'line'; key: string }
  | { kind: 'pick'; pick: StepPick; doppel?: boolean }
  | { kind: 'announcement'; announcement: Announcement };

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
}

/** The narration keys of a part. */
export function partLines(part: CuePart): string[] {
  switch (part.kind) {
    case 'line':
      return [part.key];
    case 'pick':
      return pickLines(part.pick);
    case 'announcement':
      return announcementLines(part.announcement);
  }
}

const line = (key: string): CuePart => ({ kind: 'line', key });

const cue = (
  id: string,
  at: number,
  parts: CuePart[],
  step?: { until: number; close?: boolean },
): Cue => ({
  id,
  at,
  lines: parts.flatMap(partLines),
  parts,
  ...(step ? { until: step.until, ...(step.close ? { close: true } : {}) } : {}),
});

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
    case 'neighbours':
      return ['fragment:either-neighbor'];
    case 'both-neighbours':
      return ['fragment:both-neighbors'];
    case 'left':
      return ['fragment:left-neighbor'];
    case 'right':
      return ['fragment:right-neighbor'];
    case 'yourself':
      return ['fragment:yourself'];
    // Only the Rascal's swap names these: two players higher, lower, to the left or the right.
    case 'higher':
      return ['fragment:two-higher'];
    case 'lower':
      return ['fragment:two-lower'];
    case 'two-left':
      return ['fragment:two-left'];
    case 'two-right':
      return ['fragment:two-right'];
  }
}

/**
 * The narration keys for a step's random instruction, in the order the narrator says them (right
 * after the step's wake line): the action, then whose cards, then how it ends.
 */
export function pickLines(pick: StepPick): string[] {
  switch (pick.kind) {
    case 'alien':
      switch (pick.action) {
        case 'view':
        case 'all-view':
          return [`alien:action:${pick.action}`, ...(pick.from ? setLines(pick.from, false) : [])];
        case 'new-alien':
        case 'alien-helper':
          // "Even players, put a fist out. Aliens, tap one of the fists…"
          return [...(pick.fists ? setLines(pick.fists, true) : []), `alien:action:${pick.action}`];
        default:
          return [`alien:action:${pick.action}`];
      }
    case 'oracle':
      return [`oracle:question:${pick.question}`];
    case 'body-snatcher':
      if (pick.action === 'pretend') return ['body-snatcher:action:pretend'];
      return [
        `body-snatcher:action:${pick.action}`,
        ...(pick.action === 'steal' && pick.from ? setLines(pick.from, false) : []),
        'body-snatcher:end',
      ];
    case 'psychic':
      return [`psychic:action:view-${pick.count}`, ...setLines(pick.from, false)];
    case 'rascal': {
      const action = `rascal:action:${pick.action}`;
      if (pick.action === 'idiot') return [action];
      const from = pick.from ? setLines(pick.from, false) : [];
      if (pick.action === 'troublemaker') return [action, ...from];
      return [action, ...from, `${action}:end`];
    }
    case 'exposer':
      return [`exposer:action:flip-${pick.count}`];
    case 'mortician':
      return [
        `mortician:action:${pick.action}`,
        ...(pick.from && pick.action !== 'pretend' ? setLines(pick.from, false) : []),
      ];
    case 'empath':
      // "Odd players, keep your eyes closed and point at…"
      return [...setLines(pick.who, true), `empath:prompt:${pick.prompt}`];
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

/** The announcements made at `at` (a step's start, or the dawn), in order. */
const saidAt = (announcements: readonly PublicNote[], at: number): CuePart[] =>
  announcements
    .filter((a) => Math.abs(a.at - at) < 500)
    .map((announcement) => ({ kind: 'announcement', announcement }));

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
      const cues: Cue[] = [cue(`${game}:night`, deadline - NIGHT_INTRO_MS, open.map(line))];
      // The first wake is cued ahead, unless its instruction is drawn only as the step begins:
      // that cue comes with the step, so its wake line and instruction are said together.
      if (plan.length && !pickRoleOf(plan[0]!))
        cues.push(...stepCues(game, plan, 0, deadline, s, { upcoming: true }));
      return cues;
    }
    const starts = stepStarts(plan, s.stepSeconds, index, deadline);
    // What the narrator announces as this step begins (or as the last one ended) comes first.
    const said = saidAt(view.announcements, starts[index]!);
    const cues = stepCues(game, plan, index, starts[index]!, s, { said, pick: view.night.pick });
    // The narrator's reply to the Oracle, at its fixed moment before her step closes.
    if (plan[index] === 'oracle') {
      const at = deadline - ORACLE_REPLY_MS;
      const reply = saidAt(view.announcements, at);
      if (reply.length) cues.push(cue(`${game}:${index}:reply`, at, reply, { until: deadline }));
    }
    return cues;
  }
  if (view.phase === 'day' && view.day?.deadline) {
    const end = view.day.deadline;
    // The aliens' timer and the ripples can shorten the day.
    const seconds = view.day.seconds ?? s.daySeconds;
    const dawn = end - seconds * 1000;
    const cues: Cue[] = [
      cue(`${game}:dawn`, dawn, [
        ...saidAt(view.announcements, dawn),
        line(usesMarks(s.roles) ? FRAME_LINES.nightEndMarks : FRAME_LINES.nightEnd),
        line(FRAME_LINES.dayStart),
      ]),
    ];
    if (seconds > 90) cues.push(cue(`${game}:1m`, end - 60_000, [line(FRAME_LINES.oneMinute)]));
    if (seconds > 45)
      cues.push(cue(`${game}:30s`, end - 30_000, [line(FRAME_LINES.thirtySeconds)]));
    return cues;
  }
  if (view.phase === 'vote' && view.vote?.deadline) {
    return [cue(`${game}:vote`, view.vote.deadline - 60_000, [line(FRAME_LINES.vote)])];
  }
  return [];
}

function stepCues(
  game: string,
  plan: readonly StepId[],
  index: number,
  start: number,
  s: NightfallView['settings'],
  opts: { upcoming?: boolean; said?: CuePart[]; pick?: StepPick | undefined },
): Cue[] {
  const id = plan[index]!;
  const lines = stepLines(id, s.roles, { loneWolf: s.loneWolf });
  const end = start + stepMs(id, s.stepSeconds);
  // The instruction follows the wake line ("Aliens, wake up… Each alien may view…"), before
  // anything else the step's wake says (the Cow's fist). A repeat's instruction isn't said again.
  const [wake, ...after] = lines.open.map(line);
  const def = stepDef(id);
  const pick: CuePart[] =
    opts.pick && !def.repeat
      ? [{ kind: 'pick', pick: opts.pick, ...(def.doppel ? { doppel: true } : {}) }]
      : [];
  const open = [...(opts.said ?? []), ...(wake ? [wake] : []), ...pick, ...after];
  const cues: Cue[] = [cue(`${game}:${index}:open`, start, open, { until: end })];
  if (!opts.upcoming)
    cues.push(
      cue(
        `${game}:${index}:close`,
        Math.max(start + 1000, end - CLOSE_LEAD_MS),
        lines.close.map(line),
        { until: end, close: true },
      ),
    );
  return cues;
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

/** The cue the narrator last said on this device. */
export interface Said {
  cue: string;
  parts: CuePart[];
}

const NOTHING_SAID: CuePart[] = [];

/**
 * What the narrator is saying now: the last cue said, while it still belongs to the current
 * phase's cues. Once its step has ended it says nothing, so the last close line never shows in
 * the second person to the player woken next, or to everyone at dawn.
 */
export function stillSaid(said: Said | null, cues: readonly Pick<Cue, 'id'>[]): CuePart[] {
  return said && cues.some((c) => c.id === said.cue) ? said.parts : NOTHING_SAID;
}

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
