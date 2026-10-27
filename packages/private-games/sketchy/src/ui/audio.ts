import { wordKey } from '@vt/game-sdk';
import type { Announcer, SketchyView, SoundMode } from '../logic/types.ts';

// The pure half of Sketchy's sound: which device plays what, the music for each part of the game,
// and which file a clip key means. The beats themselves are the show's moments (`show.ts`): every
// sound is a step there, so the stamp of a name and its sound land together on every device, and
// the hook in `useSound.ts` only routes them. Clip keys:
//   `<key>`          a room effect (`reveal.hit`, `timer.10`, `yelp#3`…)
//   `me:<key>`       a personal cue on the player's own phone (`me:break`, `me:fooled`)
//   `voice:<key>#n`  a narrator line (the n-th pick of the key's list in the announcer's lines, wrapped)
//   `joke:<path>`    the joke about one prompt (a file from the manifest's `jokes`)

/** The manifest's `audio`: files by key (a list means "pick one"), their lengths and words. */
export interface AudioManifest {
  music?: Record<string, string[]>;
  sfx?: Record<string, string[]>;
  /** The classic announcer's lines by cue. */
  voice?: Record<string, string[]>;
  /** The other announcers' lines by cue (a cue an announcer lacks stays silent). */
  announcers?: Partial<Record<Exclude<Announcer, 'classic'>, { voice?: Record<string, string[]> }>>;
  /** Clip lengths in ms, by path. */
  durations?: Record<string, number>;
  /** What each voice clip says, by path. */
  text?: Record<string, string>;
}

/** The manifest's `jokes`: a prompt's key (`jokeKey`) to its file. */
export type JokeTable = Record<string, string>;

export const DEFAULT_VOLUME = 0.8;
/** The music plays at this share of the device's volume, and a third of that under the voice. */
export const MUSIC_SHARE = 0.35;
export const DUCK_RATIO = 0.3;

/**
 * The sound the room plays: the host's choice, except that a paired table screen takes it until
 * the host picks one (the owner's default), and "Table screen" without one is the host's device.
 */
export function soundModeIn(
  settings: { sound: SoundMode; soundChosen: boolean },
  stagePresent: boolean,
): SoundMode {
  if (stagePresent && !settings.soundChosen) return 'stage';
  if (settings.sound === 'stage' && !stagePresent) return 'host';
  return settings.sound;
}

/** Whether this device plays the room's sound (music, voice, the table's effects). */
export function deviceSounds(mode: SoundMode, isHost: boolean, isStage: boolean): boolean {
  if (mode === 'stage') return isStage;
  if (mode === 'all') return true;
  return mode === 'host' && isHost && !isStage;
}

export interface Device {
  mode: SoundMode;
  isHost: boolean;
  isStage: boolean;
  music: boolean;
  effects: boolean;
  voice: boolean;
}

/** Whether this device plays a clip key (see the top of the file). */
export function plays(clip: string, d: Device): boolean {
  if (d.mode === 'off') return false;
  if (clip.startsWith('me:')) return d.effects && !d.isStage;
  const room = deviceSounds(d.mode, d.isHost, d.isStage);
  if (clip.startsWith('voice:') || clip.startsWith('joke:')) return room && d.voice;
  return room && d.effects;
}

/** An announcer's lines by cue. */
export function linesOf(
  audio: AudioManifest | undefined,
  announcer: Announcer,
): Record<string, string[]> | undefined {
  return announcer === 'classic' ? audio?.voice : audio?.announcers?.[announcer]?.voice;
}

/** Whether the announcer has a line for a cue. */
export const hasLine = (audio: AudioManifest | undefined, announcer: Announcer, key: string) =>
  !!linesOf(audio, announcer)?.[key]?.length;

/** The file a clip key names, or null (the manifest lacks it, or the announcer has no such line). */
export function fileOf(
  audio: AudioManifest | undefined,
  clip: string,
  announcer: Announcer = 'classic',
): string | null {
  if (!audio) return null;
  if (clip.startsWith('joke:')) return clip.slice(5) || null;
  const voice = clip.startsWith('voice:');
  // Personal cues are their own keys (`me:break` is `me.break`), so a phone fetches only those.
  const body = clip.startsWith('me:') ? `me.${clip.slice(3)}` : clip.replace(/^voice:/, '');
  const [key, n] = body.split('#') as [string, string | undefined];
  const list = (voice ? linesOf(audio, announcer) : audio.sfx)?.[key];
  if (!list?.length) return null;
  return list[(Number(n) || 0) % list.length] ?? null;
}

/** A voice key with its pick, so every device says the same line. */
export const voiceClip = (key: string, pick: number) => `voice:${key}#${pick}`;

/** The music for the part of the game the view is in: a key of the manifest's `music`. */
export function musicFor(view: SketchyView, now: number, revealEnd: number | null): string | null {
  const g = view.game;
  if (view.phase === 'lobby') return 'lobby';
  if (view.phase === 'over' || !g) return 'end';
  switch (g.stage) {
    case 'draw':
      // The two drawing loops take turns by round.
      return g.round % 2 ? 'draw' : 'draw2';
    case 'write':
      return g.turn && g.turn.number % 2 ? 'write' : 'write2';
    case 'vote':
      return 'vote';
    case 'reveal':
      return revealEnd !== null && now < revealEnd ? 'reveal' : 'board';
  }
}

/**
 * A prompt's key in the joke table: its words as `wordKey` reads them, with each player's name
 * put back as `{player}` (prompts about a player are dealt with a name filled in).
 */
export function jokeKey(prompt: string, names: readonly string[] = []): string {
  let text = prompt.toLocaleLowerCase('en').split('{player}').join(' playerslot ');
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const n = name.trim().toLocaleLowerCase('en');
    if (n) text = text.split(n).join(' playerslot ');
  }
  return wordKey(text);
}

/** A joke clip's length when the manifest doesn't say (most are 2 to 5 s). */
const JOKE_MS = 3500;

/** The joke for a prompt (its file and length), if the table has one: only the classic announcer tells them. */
export function jokeFor(
  audio: Pick<AudioManifest, 'durations'> | undefined,
  jokes: JokeTable | undefined,
  prompt: string | null,
  names: readonly string[],
  announcer: Announcer = 'classic',
): { file: string; ms: number } | null {
  if (!jokes || !prompt || announcer !== 'classic') return null;
  const file = jokes[jokeKey(prompt, names)] ?? jokes[jokeKey(prompt)];
  return file ? { file, ms: audio?.durations?.[file] ?? JOKE_MS } : null;
}

/** The clips a settings preview tries for each type, first found first: real ones from the game. */
const PREVIEW_KEYS = {
  music: ['lobby', 'draw', 'vote'],
  effects: ['reveal.hit', 'write.break', 'likes.thumb'],
  personal: ['me.sent', 'me.break', 'me.fooled'],
  voice: ['start.go', 'draw.luck', 'write.now'],
} as const;

/**
 * The file a ▶ preview plays for a sound type: a few seconds of the lobby's tune, a typical effect
 * (a phone that only makes its own little sounds hears one of those), a line of the room's
 * announcer. Null when the manifest has none.
 */
export function previewClip(
  audio: AudioManifest | undefined,
  kind: 'music' | 'effects' | 'voice',
  personal = false,
  announcer: Announcer = 'classic',
): string | null {
  const lists =
    kind === 'music' ? audio?.music : kind === 'voice' ? linesOf(audio, announcer) : audio?.sfx;
  const keys = kind === 'effects' && personal ? PREVIEW_KEYS.personal : PREVIEW_KEYS[kind];
  for (const key of keys) {
    const src = lists?.[key]?.[0];
    if (src) return src;
  }
  const any = Object.entries(lists ?? {}).find(
    ([key, list]) => list.length && (kind !== 'effects' || key.startsWith('me.') === personal),
  );
  return any?.[1][0] ?? null;
}
