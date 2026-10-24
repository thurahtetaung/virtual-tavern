import type { PlayerId } from '@vt/game-sdk';
import { PILLARS, kindOf, poolOf } from './cards.ts';
import {
  COLORS,
  type Difficulty,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type PsychicColor,
  type Settings,
} from './types.ts';

/**
 * Cards laid on the table per pillar (suspects, places, objects), by difficulty and by players
 * at the table (the ghost included): index 0 is 3 players, 4 is 7.
 */
export const TABLE_CARDS: Readonly<Record<Difficulty, readonly number[]>> = {
  easy: [5, 5, 6, 6, 7],
  medium: [6, 6, 7, 8, 8],
  hard: [7, 7, 8, 9, 9],
};

export const tableCards = (difficulty: Difficulty, players: number) =>
  TABLE_CARDS[difficulty][Math.min(Math.max(players, MIN_PLAYERS), MAX_PLAYERS) - MIN_PLAYERS]!;

/** Ravens (discard and redraw any of the hand): Easy once per hour, Medium 3, Hard 1 a game. */
export const RAVENS: Readonly<Record<Difficulty, { count: number; perHour: boolean }>> = {
  easy: { count: 1, perHour: true },
  medium: { count: 3, perHour: false },
  hard: { count: 1, perHour: false },
};

/** Clairvoyance tokens per psychic: none with 3 players, 4 with 4–5, 6 with 6–7. */
export const tokensFor = (players: number) => (players <= 3 ? 0 : players <= 5 ? 4 : 6);

/**
 * The clairvoyance levels that unlock the second and third shared card in the final vote:
 * 4–5 players: 5 and 7; 6–7 players: 7 and 10.
 */
export const levelThresholds = (players: number): [number, number] =>
  players <= 5 ? [5, 7] : [7, 10];

/**
 * When a psychic votes in the final: after 1, 2 or 3 shared cards. Without clairvoyance (3
 * players) the shared vision is laid face up, so everyone votes on all three.
 */
export function voteStageOf(level: number, players: number, clairvoyance: boolean): number {
  if (!clairvoyance) return 3;
  const [mid, high] = levelThresholds(players);
  return level >= high ? 3 : level >= mid ? 2 : 1;
}

export const VISION_MIN = 30;

/** Why a game can't start yet, or null. Shared with the lobby UI. */
export function startProblem(
  settings: Settings,
  seats: readonly { id: PlayerId; playing: boolean; volunteer: boolean }[],
): string | null {
  const playing = seats.filter((s) => s.playing);
  if (playing.length < MIN_PLAYERS)
    return `${MIN_PLAYERS} players are needed: the ghost and at least 2 psychics (${playing.length} so far).`;
  if (playing.length > MAX_PLAYERS) return `At most ${MAX_PLAYERS} can play.`;
  const need = tableCards(settings.difficulty, playing.length);
  for (const pillar of PILLARS) {
    const kind = kindOf(pillar, settings.third);
    if (poolOf(settings.sets, kind, [], settings.extras).length < need)
      return kind === 'story'
        ? `Those card sets have too few story cards for ${playing.length} players on this difficulty: the stories come with the second expansion and the promos.`
        : `Those card sets have too few ${kind} cards for ${playing.length} players on this difficulty: add a set.`;
  }
  if (poolOf(settings.sets, 'vision', settings.pools).length < VISION_MIN)
    return 'Those card sets have too few vision cards: add a set.';
  switch (settings.ghostMode) {
    case 'host':
      return playing.some((s) => s.id === settings.ghostPick)
        ? null
        : 'The host picks who is the ghost.';
    case 'volunteers':
      return playing.some((s) => s.volunteer)
        ? null
        : 'Nobody has volunteered to be the ghost yet.';
    default:
      return null;
  }
}

/**
 * Seats the psychics' colours: everyone keeps the colour they chose if it is free, the rest take
 * the free colours in order.
 */
export function assignColors(
  ids: readonly PlayerId[],
  wanted: (id: PlayerId) => PsychicColor | null,
): Map<PlayerId, PsychicColor> {
  const out = new Map<PlayerId, PsychicColor>();
  const taken = new Set<PsychicColor>();
  for (const id of ids) {
    const c = wanted(id);
    if (c && !taken.has(c)) {
      out.set(id, c);
      taken.add(c);
    }
  }
  const free = COLORS.filter((c) => !taken.has(c));
  for (const id of ids) {
    if (!out.has(id)) out.set(id, free.shift()!);
  }
  return out;
}
