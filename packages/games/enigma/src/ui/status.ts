import { type PresencePlayer, namesWithPresence, waitingFor, waitingForHost } from '@vt/game-sdk';
import type { EnigmaView, Team, TransmissionView } from '../logic/types.ts';
import { TEAM_LABEL, formatCode } from './theme.ts';

const MIN_TEAM_SIZE = 2;

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: EnigmaView, wordCount: number): string | null {
  for (const team of ['red', 'blue'] as const) {
    const n = view.seats.filter((s) => s.team === team).length;
    if (n < MIN_TEAM_SIZE) return `${TEAM_LABEL[team]} needs at least ${MIN_TEAM_SIZE} players.`;
  }
  if (wordCount < 8) return 'The chosen word lists need at least 8 words.';
  return null;
}

export interface Status {
  text: string;
  yourMove: boolean;
}

/** Who is in the room and who hosts it, so waiting texts can name people (and flag offline ones). */
export interface RoomPeople {
  hostId: string;
  players: readonly PresencePlayer[];
}

/** Players as named in waiting texts: the room's list when we have it, else the seats. */
const people = (view: EnigmaView, room?: RoomPeople): readonly PresencePlayer[] =>
  room?.players ?? view.seats;

/** Teammates who still have to lock in on this transmission. */
export const holdouts = (tx: TransmissionView) =>
  tx.voters.filter((id) => !tx.teamVotes[id]?.locked);

function myTask(view: EnigmaView, tx: TransmissionView, room?: RoomPeople): Status | null {
  const sender = TEAM_LABEL[tx.team];
  if (view.stage === 'clue') {
    if (tx.role === 'encryptor' && !tx.clues) {
      return {
        text: `You're the Encryptor! Write 3 clues for your code ${formatCode(tx.code)}.`,
        yourMove: true,
      };
    }
    return null;
  }
  if (view.stage !== 'guess' || tx.settled) return null;
  // Locked in: no longer your move, but say who the team is waiting on.
  const me = view.me?.id;
  if ((tx.role === 'decoder' || tx.role === 'interceptor') && me && tx.teamVotes[me]?.locked) {
    const left = holdouts(tx);
    return left.length > 0
      ? {
          text: `Locked in! ${waitingFor(left, people(view, room), { you: me })}.`,
          yourMove: false,
        }
      : {
          text: 'Everyone locked in, but on different codes. Compare picks and agree!',
          yourMove: true,
        };
  }
  if (tx.role === 'decoder') {
    return {
      text: `Decode your team's code: match each clue to a keyword, then Lock in.`,
      yourMove: true,
    };
  }
  if (tx.role === 'interceptor') {
    return {
      text: `Intercept ${sender}'s code: use their clue history, then Lock in.`,
      yourMove: true,
    };
  }
  return null;
}

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(
  view: EnigmaView,
  isHost: boolean,
  blocker: string | null,
  room?: RoomPeople,
): Status {
  const me = view.me;
  const waitHost = (what: string) =>
    room ? waitingForHost(room, what) : `Waiting for the host to ${what}…`;
  if (view.phase === 'lobby') {
    if (!me?.team)
      return { text: 'Pick a team below. Each team needs at least 2 players.', yourMove: true };
    if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? { text: 'Everyone is in. Press Start game when your friends are ready!', yourMove: true }
      : { text: `All set. ${waitHost('start the game')}`, yourMove: false };
  }
  if (view.phase === 'over') {
    return {
      text:
        view.winner === 'draw' ? "It's a draw!" : `${TEAM_LABEL[view.winner as Team]} team wins!`,
      yourMove: false,
    };
  }
  const active = view.transmissions.filter((t) => t.active);
  for (const tx of active) {
    const task = myTask(view, tx, room);
    if (task) return task;
  }
  if (view.stage === 'clue') {
    const writers = active.filter((t) => !t.clues && !t.expired).map((t) => t.encryptor);
    return {
      text: `Waiting for ${namesWithPresence(writers, people(view, room)) || 'the Encryptors'} to write clues…`,
      yourMove: false,
    };
  }
  if (view.stage === 'guess') {
    const mine = active.find((t) => t.settled && t.voters.length > 0);
    return {
      text: mine ? 'Locked in! Waiting for the other team…' : 'Teams are working out the codes…',
      yourMove: false,
    };
  }
  return {
    text: isHost
      ? 'Codes revealed! Press Next when everyone has had a look.'
      : `Codes revealed! ${waitHost('continue')}`,
    yourMove: isHost,
  };
}

/** The viewer is an Encryptor whose team is still decoding: the engine refuses their chat. */
export function chatMuted(view: EnigmaView): boolean {
  return (
    view.phase === 'playing' &&
    view.stage === 'guess' &&
    view.transmissions.some((t) => t.active && t.role === 'encryptor' && !t.settled)
  );
}

/** Clues filed under keyword numbers 1–4, oldest first, from a team's public history. */
export function cluesByKeyword(view: EnigmaView, team: Team): { round: number; clue: string }[][] {
  const columns: { round: number; clue: string }[][] = [[], [], [], []];
  for (const entry of view.teams[team].history) {
    entry.clues?.forEach((clue, i) => {
      const digit = entry.code[i];
      if (digit) columns[digit - 1]!.push({ round: entry.round, clue });
    });
  }
  return columns;
}
