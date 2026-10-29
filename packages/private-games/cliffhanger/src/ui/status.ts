import { type PresencePlayer, waitingFor, waitingForHost } from '@vt/game-sdk';
import { KINDS } from '../logic/content.ts';
import { nounOf, progress } from '../logic/genres.ts';
import {
  type CliffhangerView,
  MAX_PLAYERS,
  MIN_TEAM,
  type RoundView,
  TEAM_NAMES,
  type TeamId,
  other,
} from '../logic/types.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

/** The room as the status line needs it. */
export interface StatusRoom {
  you: string;
  hostId: string;
  isHost: boolean;
  players: readonly PresencePlayer[];
}

const nameOf = (view: CliffhangerView, id: string | null | undefined) =>
  view.seats.find((s) => s.id === id)?.name ?? 'Someone';
const whoIs = (view: CliffhangerView, id: string | null | undefined) =>
  id && id === view.me?.id ? 'You' : nameOf(view, id);

/** Cards in the chosen packs of the deck in play. */
export const countOf = (view: CliffhangerView, role: 'cards' | 'categories') =>
  view.packs
    .filter(
      (p) => view.settings.packIds.includes(p.id) && p.kind === KINDS[view.settings.deck][role],
    )
    .reduce((n, p) => n + p.count, 0);

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: CliffhangerView): string | null {
  const team = (t: TeamId) => view.seats.filter((s) => s.team === t).length;
  const playing = team('a') + team('b');
  if (playing > MAX_PLAYERS) return `At most ${MAX_PLAYERS} players can play.`;
  if (team('a') < MIN_TEAM || team('b') < MIN_TEAM) {
    return `Each team needs at least ${MIN_TEAM} players (${TEAM_NAMES.a} ${team('a')}, ${TEAM_NAMES.b} ${team('b')}).`;
  }
  const noun = nounOf(view.settings.deck, true);
  if (countOf(view, 'cards') === 0) {
    return view.packs.some((p) => p.kind === KINDS[view.settings.deck].cards)
      ? `Pick at least one pack of ${noun}.`
      : `No ${noun} yet. Ask an admin to add a pack.`;
  }
  if (countOf(view, 'categories') === 0) return 'Pick at least one pack of face-off categories.';
  return null;
}

function roundStatus(view: CliffhangerView, r: RoundView, room: StatusRoom): Status {
  const me = view.me?.id ?? '';
  const mine = view.myTeam;
  const noun = nounOf(view.settings.deck);
  const nouns = nounOf(view.settings.deck, true);
  const inPair = r.pair.a === me || r.pair.b === me;
  switch (r.stage) {
    case 'pick-category': {
      if (r.pick?.by === me)
        return { text: 'You’re behind: pick the face-off category.', yourMove: true };
      return {
        text: `${nameOf(view, r.pick?.by)} is picking the face-off category…`,
        yourMove: false,
      };
    }
    case 'countdown':
      if (r.after === 'faceoff') {
        return {
          text: inPair
            ? 'Face-off! Get ready to name one that fits the category.'
            : `${nameOf(view, r.pair.a)} and ${nameOf(view, r.pair.b)} face off. Get ready…`,
          yourMove: inPair,
        };
      }
      return turnSoon(view, r, me);
    case 'faceoff': {
      const fo = r.faceoff!;
      if (fo.paused) {
        const doubter = nameOf(view, fo.paused.by);
        if (me === fo.last)
          return {
            text: `${doubter} doubts your answer. Let it stand or give it up.`,
            yourMove: true,
          };
        if (inPair && me !== fo.last)
          return {
            text: `Paused. Let ${nameOf(view, fo.last)}’s answer stand, or talk it out.`,
            yourMove: true,
          };
        return {
          text: `Paused: is ${nameOf(view, fo.last)}’s answer right? ${room.isHost ? 'You can settle it.' : 'The table decides.'}`,
          yourMove: room.isHost,
        };
      }
      if (fo.on === me || (fo.on === null && inPair)) {
        return {
          text: `Name a ${noun} that fits, out loud, then press Said it!`,
          yourMove: true,
        };
      }
      if (inPair)
        return {
          text: `${nameOf(view, fo.on)} is on the clock. Listen for a wrong one.`,
          yourMove: false,
        };
      return {
        text:
          fo.on === null
            ? `${nameOf(view, r.pair.a)} and ${nameOf(view, r.pair.b)}: first to name one…`
            : `${nameOf(view, fo.on)} is on the clock.`,
        yourMove: false,
      };
    }
    case 'keep': {
      if (r.myHand) {
        return {
          text: r.myHand.choose
            ? `Keep 3 ${nouns} and put each on a square, then lock in.`
            : `Put your 3 ${nouns} on the squares, then lock in.`,
          yourMove: true,
        };
      }
      const still = waitingFor(r.placing, room.players, { you: me });
      return { text: `${still || 'Someone'} is choosing ${nouns}…`, yourMove: false };
    }
    case 'turn': {
      const t = r.turn!;
      if (r.myHand)
        return { text: `Place your 3 ${nouns} while they describe, then lock in.`, yourMove: true };
      if (t.describer === me) {
        return {
          text: t.stealOpen
            ? 'All three got! Now describe theirs to steal them.'
            : `Describe your ${nouns}; tap Got it when your team says it.`,
          yourMove: true,
        };
      }
      if (mine === t.team)
        return {
          text: `${nameOf(view, t.describer)} is describing: shout your guesses!`,
          yourMove: true,
        };
      if (mine)
        return {
          text: `${nameOf(view, t.describer)} describes to ${TEAM_NAMES[t.team]}. Watch for fouls.`,
          yourMove: false,
        };
      return {
        text: `${nameOf(view, t.describer)} describes to ${TEAM_NAMES[t.team]}.`,
        yourMove: false,
      };
    }
    case 'recap':
      return turnSoon(view, r, me);
    case 'steal': {
      const s = r.steal!;
      if (s.team === mine)
        return { text: 'Trade three of a genre for one of theirs, or pass.', yourMove: true };
      return {
        text: `${TEAM_NAMES[s.team]} may trade three of a genre for one of yours…`,
        yourMove: false,
      };
    }
  }
}

/** Before a team's turn: who describes next. */
function turnSoon(view: CliffhangerView, r: RoundView, me: string): Status {
  const next = r.order[r.stage === 'recap' ? r.turnNo : r.turnNo];
  if (!next) return { text: 'Next round…', yourMove: false };
  const describer = r.pair[next];
  if (describer === me) return { text: 'Your turn to describe. Get ready…', yourMove: true };
  return {
    text: `${nameOf(view, describer)} describes to ${TEAM_NAMES[next]} next.`,
    yourMove: false,
  };
}

export function statusFor(view: CliffhangerView, room: StatusRoom): Status {
  if (view.phase === 'lobby') {
    if (room.isHost) {
      const blocker = startBlocker(view);
      return blocker
        ? { text: blocker, yourMove: false }
        : { text: 'Teams set? Start the game.', yourMove: true };
    }
    if (!view.myTeam) return { text: 'Join a team to play.', yourMove: true };
    return { text: waitingForHost(room, 'start'), yourMove: false };
  }
  if (view.phase === 'over') {
    const w = view.winner;
    if (w) {
      const goal = view.target;
      const p = progress(
        view.collections[w].map((c) => c.genre),
        goal,
      );
      const tail =
        view.endReason === 'sudden-death' ? ' in sudden death' : ` with ${p.have}/${p.need}`;
      return {
        text: w === view.myTeam ? `🏆 Your team wins${tail}!` : `🏆 ${TEAM_NAMES[w]} win${tail}.`,
        yourMove: false,
      };
    }
    switch (view.endReason) {
      case 'too-few':
        return {
          text: 'A team fell below two players, so the game ended with no winner.',
          yourMove: false,
        };
      case 'no-cards':
        return {
          text: `The packs ran out of ${nounOf(view.settings.deck, true)}, so the game ended.`,
          yourMove: false,
        };
      default:
        return { text: 'The game ended.', yourMove: false };
    }
  }
  const r = view.round;
  if (!r) return { text: 'Next round…', yourMove: false };
  return roundStatus(view, r, room);
}

/** The other team, for screens that need it. */
export const rival = (t: TeamId) => other(t);
export { whoIs };
