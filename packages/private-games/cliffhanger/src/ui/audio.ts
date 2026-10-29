import type { Manifest } from '../logic/manifest.ts';
import {
  COUNTDOWN_MS,
  type CliffhangerView,
  OPENING_MS,
  type Settings,
  type SoundMode,
  TEAMS,
  soundModeIn,
} from '../logic/types.ts';

// The pure half of the sound: which cues the view calls for and when, on the server clock. The
// clock is the soundtrack. A face-off ticks twice a second, four times in its last 5 s (the last
// three louder); a turn ticks once a second, then its last 10 s step through three hurry loops
// (hurry, hurry2, hurry3), and time's up is the one loud buzzer. Everything else is a short sting
// as it happens. There is no music: the talking is the game.

/** The cue ids the manifest's `audio` names. */
export type CueId =
  | 'tick'
  | 'hurry'
  | 'hurry2'
  | 'hurry3'
  | 'buzzer'
  | 'press'
  | 'got'
  | 'pass'
  | 'countdown'
  | 'steal'
  | 'genre'
  | 'win';

export interface Cue {
  /** Played once per key. */
  key: string;
  cue: CueId;
  /** Server time it plays at (null: as soon as it is seen). */
  at: number | null;
  gain?: number;
  /** Cut after this long (a hurry loop's share of the last 10 s). */
  maxMs?: number;
  /** The describer's own cues: their phone plays them whatever the room's choice. */
  personal?: boolean;
}

/** The last ticks, louder (+4 dB). */
export const LOUD = 1.58;
/** The hurry loops over a turn's last 10 s: from 10 s, 6 s and 3 s left. */
export const HURRY: readonly { cue: CueId; from: number; to: number }[] = [
  { cue: 'hurry', from: 10_000, to: 6_000 },
  { cue: 'hurry2', from: 6_000, to: 3_000 },
  { cue: 'hurry3', from: 3_000, to: 0 },
];

/** The clock's cues due between `from` and `to` (server times): ticks, hurries, the buzzer. */
export function clockCues(view: CliffhangerView, from: number, to: number): Cue[] {
  const r = view.round;
  if (view.phase !== 'playing' || !r) return [];
  const out: Cue[] = [];
  const within = (t: number) => t >= from && t < to;
  if (r.stage === 'countdown' && r.stageEnds !== null) {
    const at = r.stageEnds - COUNTDOWN_MS;
    if (within(at) || (at < from && r.stageEnds > to)) {
      out.push({ key: `count:${r.number}:${r.after}:${r.turnNo}`, cue: 'countdown', at });
    }
  }
  const fo = r.faceoff;
  if (r.stage === 'faceoff' && fo && !fo.paused && fo.deadline !== null) {
    const total =
      fo.answers === 0 && view.settings.openingClock
        ? OPENING_MS
        : view.settings.answerSeconds * 1000;
    const end = fo.deadline;
    const start = end - total;
    // Twice a second, then four times in the last 5 s; the last three louder.
    for (let t = start + 500; t < end; t += t < end - 5000 ? 500 : 250) {
      if (!within(t)) continue;
      out.push({ key: `tick:${end}:${t}`, cue: 'tick', at: t, gain: t >= end - 750 ? LOUD : 1 });
    }
    // Only an answer's clock ends the face-off (the opening clock deals a new category).
    if (fo.answers > 0 && within(end))
      out.push({ key: `fo-end:${r.number}`, cue: 'buzzer', at: end });
  }
  const turn = r.turn;
  if (r.stage === 'turn' && turn) {
    const end = turn.endsAt;
    for (let t = turn.startedAt + 1000; t < end - HURRY[0]!.from; t += 1000) {
      if (within(t)) out.push({ key: `tick:${end}:${t}`, cue: 'tick', at: t });
    }
    for (const h of HURRY) {
      const at = end - h.from;
      if (within(at) && at >= turn.startedAt) {
        out.push({ key: `${h.cue}:${end}`, cue: h.cue, at, maxMs: h.from - h.to });
      }
    }
    if (within(end))
      out.push({ key: `turn-end:${r.number}:${turn.startedAt}`, cue: 'buzzer', at: end });
  }
  return out;
}

/** The stings the view shows have happened (played once each, as soon as they are seen). */
export function eventCues(view: CliffhangerView): Cue[] {
  const out: Cue[] = [];
  if (view.phase === 'over' && view.winner)
    out.push({ key: `win:${view.winner}`, cue: 'win', at: null });
  const r = view.round;
  if (!r || view.phase === 'lobby') return out;
  const fo = r.faceoff;
  if (fo && fo.answers > 0)
    out.push({ key: `press:${r.number}:${fo.answers}:${fo.last}`, cue: 'press', at: null });
  // A face-off or turn that ran out while this device wasn't looking still buzzes (once).
  if (r.faceoffResult?.how === 'time')
    out.push({ key: `fo-end:${r.number}`, cue: 'buzzer', at: null });
  const turn = r.turn;
  if (
    turn &&
    r.stage !== 'turn' &&
    turn.endsAt - turn.startedAt >= view.settings.turnSeconds * 1000 - 50
  ) {
    out.push({ key: `turn-end:${r.number}:${turn.startedAt}`, cue: 'buzzer', at: null });
  }
  for (const t of TEAMS) {
    for (const s of r.board[t] ?? []) {
      if (s.got && s.card) {
        const describing = turn?.describer === view.me?.id;
        out.push({ key: `got:${s.card.id}`, cue: 'got', at: null, personal: describing });
      }
    }
  }
  if (turn?.stealOpen)
    out.push({ key: `open:${r.number}:${turn.startedAt}`, cue: 'steal', at: null });
  r.steals.forEach((_, i) => out.push({ key: `trade:${r.number}:${i}`, cue: 'steal', at: null }));
  // A tape sliding into a team's collection.
  for (const t of TEAMS) {
    const n = view.collections[t].length;
    if (n > 0) out.push({ key: `genre:${t}:${n}`, cue: 'genre', at: null });
  }
  return out;
}

/**
 * The sound the room plays: the host's choice once made; before that a paired table screen, else
 * every device on a call and the host's device in a room. "Table screen" without one is the host's.
 */
export function soundModeOf(
  settings: Pick<Settings, 'sound' | 'soundChosen' | 'mode'>,
  stagePresent: boolean,
): SoundMode {
  const mode = soundModeIn(settings, stagePresent);
  return mode === 'stage' && !stagePresent ? 'host' : mode;
}

/** Whether this device plays the room's cues. */
export function deviceSounds(mode: SoundMode, isHost: boolean, isStage: boolean): boolean {
  if (mode === 'stage') return isStage;
  if (mode === 'all') return !isStage;
  return mode === 'host' && isHost && !isStage;
}

/**
 * Whether this device plays a cue, and how loud (0 = not at all). The room's cues where the
 * host's choice puts them; the describer's own cues on their phone, quietly, wherever the room's
 * aren't (a table screen's room gets a buzz instead). The describer's clock is 6 dB down on a
 * call, where their microphone is open.
 */
export function gainFor(
  cue: Cue,
  d: { mode: SoundMode; isHost: boolean; isStage: boolean; describing: boolean },
): number {
  if (d.mode === 'off') return 0;
  const room = deviceSounds(d.mode, d.isHost, d.isStage);
  const base = cue.gain ?? 1;
  if (room) return d.describing && d.mode === 'all' && isClock(cue.cue) ? base * 0.5 : base;
  if (cue.personal && !d.isStage && d.mode !== 'stage') return base * 0.5;
  return 0;
}

const isClock = (c: CueId) => c === 'tick' || c.startsWith('hurry');

/** A cue's file: the manifest's first choice, or its fallback where that can't play. */
export function fileOf(
  audio: Manifest['audio'],
  cue: CueId,
  canPlay: (path: string) => boolean,
): string | null {
  const a = audio?.[cue];
  if (!a) return null;
  if (a.file && canPlay(a.file)) return a.file;
  return a.fallback ?? a.file ?? null;
}

/** Whether this browser plays a file's type (Ogg isn't on older Safari). */
export function canPlayType(path: string): boolean {
  if (typeof document === 'undefined') return true;
  const ext = path.split('.').pop()?.toLowerCase();
  const type =
    ext === 'ogg'
      ? 'audio/ogg; codecs="vorbis"'
      : ext === 'm4a'
        ? 'audio/mp4'
        : ext === 'mp3'
          ? 'audio/mpeg'
          : '';
  if (!type) return true;
  return document.createElement('audio').canPlayType(type) !== '';
}
