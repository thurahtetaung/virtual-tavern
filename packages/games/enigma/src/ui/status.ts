import { type PresencePlayer, listNames, namesWithPresence, waitingForHost } from '@vt/game-sdk';
import { winReason, winnerFrom } from '../logic/outcome.ts';
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
  if (tx.role !== 'decoder' && tx.role !== 'interceptor') return null;
  const mine = view.me ? tx.teamVotes[view.me.id] : undefined;
  if (mine?.locked && !tx.disagree) {
    // Locked in: nothing more to do here, so it is no longer "your move". Name who is holding out.
    const what = tx.role === 'decoder' ? 'your code' : `${sender}'s code`;
    const holdouts = waitingOn(view, tx, room);
    return {
      text: holdouts.length
        ? `Locked in on ${what}. Waiting for: ${listNames(holdouts)}.`
        : `Locked in on ${what}.`,
      yourMove: false,
    };
  }
  if (tx.role === 'decoder') {
    return {
      text: tx.disagree
        ? 'Your team locked in different codes. Compare picks and agree on one.'
        : `Decode your team's code: match each clue to a keyword, then Lock in.`,
      yourMove: true,
    };
  }
  return {
    text: tx.disagree
      ? `Your team locked in different guesses for ${sender}'s code. Compare picks and agree on one.`
      : `Intercept ${sender}'s code: their past clues are under each number. Pick, then Lock in.`,
    yourMove: true,
  };
}

/**
 * Teammates who still have to lock in on this transmission, marked "(offline)" while away, with
 * what they've picked so far.
 */
export function waitingOn(view: EnigmaView, tx: TransmissionView, room?: RoomPeople): string[] {
  return holdouts(tx).map((id) => {
    const draft = tx.teamVotes[id]?.draft;
    const picked = draft?.every((d) => d > 0) ? ` (has ${formatCode(draft)} picked)` : '';
    return `${namesWithPresence([id], people(view, room)) || 'Someone'}${picked}`;
  });
}

/** At the end of a round's reveal: the winner and why, if this round decides the game. */
export function revealOutcome(view: EnigmaView): { winner: Team | 'draw'; reason: string } | null {
  if (view.phase !== 'playing' || view.stage !== 'reveal') return null;
  const roundOver =
    view.settings.flow === 'simultaneous' || view.transmissions[1]?.revealed === true;
  if (!roundOver) return null;
  const winner = winnerFrom(view.teams, view.round);
  const reason = winReason(view.teams, view.round);
  return winner && reason ? { winner, reason } : null;
}

const winsLine = (winner: Team | 'draw') =>
  winner === 'draw' ? "It's a draw!" : `${TEAM_LABEL[winner]} wins!`;

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
    // The result panel names the winner; the hint says why, so the two never repeat each other.
    const reason = winReason(view.teams, view.round);
    return { text: `Game over. ${reason ?? ''}`.trim(), yourMove: false };
  }
  const active = view.transmissions.filter((t) => t.active);
  let waiting: Status | null = null;
  for (const tx of active) {
    const task = myTask(view, tx, room);
    if (task?.yourMove) return task;
    waiting ??= task;
  }
  if (waiting) return waiting;
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
  const outcome = revealOutcome(view);
  if (outcome) {
    return {
      text: `${winsLine(outcome.winner)} ${outcome.reason} ${
        isHost ? 'Press See results.' : waitHost('show the results')
      }`,
      yourMove: isHost,
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
/** Mirrors the engine: an Encryptor can't chat or edit notes from the deal until their team decodes. */
export function chatMuted(view: EnigmaView): boolean {
  return (
    view.phase === 'playing' &&
    view.stage !== 'reveal' &&
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
