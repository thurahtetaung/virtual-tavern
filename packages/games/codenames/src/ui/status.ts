import { type PresencePlayer, namesWithPresence, waitingForHost } from '@vt/game-sdk';
import type { CodenamesView, Team } from '../logic/types.ts';
import { TEAM_LABEL } from './theme.ts';

/** Guesses the current team may still make for this clue (the clue number plus one). */
export function guessesLeft(view: CodenamesView): number {
  const count = view.turn?.clue?.count ?? 1;
  return Math.max(0, count + 1 - (view.turn?.guessesMade ?? 0));
}

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: CodenamesView, wordCount: number): string | null {
  for (const team of ['red', 'blue'] as const) {
    const members = view.seats.filter((s) => s.team === team);
    if (!members.some((s) => s.role === 'spymaster'))
      return `${TEAM_LABEL[team]} needs a Spymaster.`;
    if (!members.some((s) => s.role === 'operative')) {
      return `${TEAM_LABEL[team]} needs at least one Operative.`;
    }
  }
  if (view.settings.wordListIds.length === 0) return 'Pick at least one word list.';
  if (wordCount < 25) return `The chosen word lists have ${wordCount} words; 25 are needed.`;
  return null;
}

/**
 * Whether the viewer may take `team`'s empty Spymaster seat. Mirrors the engine's mid-game seat
 * lock: seated players stay put, except to fill their own team's vacant spymaster seat;
 * newcomers may join unless they have already seen the key, in which case only their old
 * spymaster seat will do.
 */
export function canTakeSpymaster(view: CodenamesView, team: Team): boolean {
  const me = view.me;
  if (!me || view.seats.some((s) => s.team === team && s.role === 'spymaster')) return false;
  if (view.phase !== 'playing') return true;
  const keyHeld = view.keyHolders[me.id];
  return me.team === null ? (keyHeld ?? team) === team : me.team === team && keyHeld === undefined;
}

export interface SpymasterAlert {
  team: Team;
  text: string;
  /** The viewer is on that team. */
  mine: boolean;
  /** The viewer can take the empty seat right now. */
  canTake: boolean;
}

/**
 * Mid-game, a team without a Spymaster has its turns skipped until someone takes the seat. Says
 * so to everyone (so the table knows why), and offers the seat to whoever may take it.
 */
export function spymasterAlerts(view: CodenamesView): SpymasterAlert[] {
  if (view.phase !== 'playing') return [];
  return (['red', 'blue'] as const).flatMap((t) => {
    if (view.seats.some((s) => s.team === t && s.role === 'spymaster')) return [];
    const mine = view.me?.team === t;
    const canTake = canTakeSpymaster(view, t);
    const text = mine
      ? `Your team has no Spymaster, so your turns are skipped.${canTake ? ' Take the seat?' : ''}`
      : `${team(t)} has no Spymaster, so ${team(t)}'s turns are skipped.${canTake ? ' Take the seat?' : ' One of them can take the seat.'}`;
    return [{ team: t, text, mine, canTake }];
  });
}

export interface Status {
  text: string;
  /** True when the viewer is expected to act now. */
  yourMove: boolean;
}

const team = (t: Team) => TEAM_LABEL[t];

/** Who is in the room and who hosts it, so waiting texts can name people (and flag offline ones). */
export interface RoomPeople {
  hostId: string;
  players: readonly PresencePlayer[];
}

/** Why the game ended, e.g. "Blue found the assassin". */
export function winHow(view: CodenamesView): string {
  const winner = view.winner!;
  return view.winReason === 'assassin'
    ? `${team(winner === 'red' ? 'blue' : 'red')} found the assassin`
    : `${team(winner)} found all their agents`;
}

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(
  view: CodenamesView,
  isHost: boolean,
  blocker: string | null,
  room?: RoomPeople,
): Status {
  const me = view.me;
  const waitHost = (what: string) =>
    room ? waitingForHost(room, what) : `Waiting for the host to ${what}…`;
  if (view.phase === 'lobby') {
    if (!me || me.team === null) {
      return {
        text: 'Pick a team below. Each team needs one Spymaster and at least one Operative.',
        yourMove: true,
      };
    }
    if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? {
          text: 'Everyone is seated. Press Start game when your friends are ready!',
          yourMove: true,
        }
      : { text: `All set. ${waitHost('start the game')}`, yourMove: false };
  }

  if (view.phase === 'over') {
    return { text: `${team(view.winner!)} team wins! ${winHow(view)}.`, yourMove: false };
  }

  const turn = view.turn!;
  const mine = me?.team === turn.team;
  if (turn.stage === 'clue') {
    if (mine && me?.role === 'spymaster') {
      return {
        text: 'Your turn! Give your team a one-word clue and a number of cards it relates to.',
        yourMove: true,
      };
    }
    // Name an offline Spymaster, so nobody waits on someone who has gone.
    const spymaster = view.seats.find((s) => s.team === turn.team && s.role === 'spymaster');
    const away = spymaster && room?.players.find((p) => p.id === spymaster.id)?.connected === false;
    if (spymaster && room && away) {
      return {
        text: `Waiting for ${namesWithPresence([spymaster.id], room.players)}, ${team(turn.team)}'s Spymaster, to give a clue.`,
        yourMove: false,
      };
    }
    return {
      text: mine
        ? 'Your Spymaster is thinking of a clue…'
        : `${team(turn.team)} Spymaster is thinking of a clue…`,
      yourMove: false,
    };
  }

  const left = guessesLeft(view);
  const leftText = `${left} guess${left === 1 ? '' : 'es'} left`;
  if (mine && me?.role === 'operative') {
    return {
      text: `Your turn to guess (${leftText}). Tap a card to suggest it to your team, then press Guess.`,
      yourMove: true,
    };
  }
  if (mine) return { text: 'Your team is guessing. Stay poker-faced!', yourMove: false };
  return { text: `${team(turn.team)} team is guessing (${leftText}).`, yourMove: false };
}
