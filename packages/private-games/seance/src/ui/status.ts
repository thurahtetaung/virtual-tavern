import { type PresencePlayer, namesWithPresence, waitingForHost } from '@vt/game-sdk';
import { PILLARS, type Pillar } from '../logic/cards.ts';
import { startProblem } from '../logic/setup.ts';
import type { GameView, PsychicColor, PsychicView, SeanceView } from '../logic/types.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

/** Who is in the room (and online), so texts can name people. */
export interface People {
  hostId: string;
  players: readonly PresencePlayer[];
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
export const roman = (hour: number) => ROMAN[hour] ?? String(hour);

export interface Step {
  id: 'visions' | 'discussion' | 'verdicts' | 'lineup' | 'vote' | 'done';
  title: string;
  text: string;
}

/**
 * The step of the hour (or of the final) everyone is in, named and explained: the ghost sends
 * visions, the psychics discuss them out loud against the timer, the verdicts, then the line-up
 * while the ghost picks the shared vision, and the silent vote.
 */
export function stepOf(g: GameView): Step {
  switch (g.stage) {
    case 'visions':
      return waitingForVision(g).length
        ? {
            id: 'visions',
            title: 'Visions',
            text: 'The ghost sends each psychic a vision, one at a time. Start reading yours as soon as it arrives.',
          }
        : {
            id: 'discussion',
            title: 'Discussion',
            text: 'Every vision is out. Psychics: talk them all over out loud, move your guesses and tokens, then tap Ready. The ghost listens in silence and reveals the verdicts once everyone is Ready.',
          };
    case 'reveal':
      return {
        id: 'verdicts',
        title: 'Verdicts',
        text: 'The ghost answers every guess at once.',
      };
    case 'shared':
      return {
        id: 'lineup',
        title: 'Line-up',
        text: 'Each psychic’s three cards are a group, and one is the culprit’s. Study them and talk freely while the ghost picks a shared vision: once it is out, the vote is silent.',
      };
    case 'vote':
      return {
        id: 'vote',
        title: 'Silent vote',
        text: 'The shared vision turns over card by card. No talking, no signs, until every vote is in.',
      };
    default:
      return { id: 'done', title: 'The end', text: '' };
  }
}

export const pillarAt = (step: number): Pillar | null => PILLARS[step] ?? null;

export const nameOf = (view: SeanceView, id: string | null | undefined) =>
  view.game?.psychics.find((p) => p.id === id)?.name ??
  view.seats.find((s) => s.id === id)?.name ??
  'Someone';

export const psychicByColor = (g: GameView, c: PsychicColor | null | undefined) =>
  g.psychics.find((p) => p.color === c) ?? null;

export const myPsychic = (view: SeanceView): PsychicView | null =>
  view.game ? psychicByColor(view.game, view.game.me) : null;

/** Psychics still in the game: a seat the host retired is out. */
export const atTable = (g: GameView) => g.psychics.filter((p) => !p.retired);

/** Psychics still searching (and in their seat) who haven't had this hour's vision. */
export const waitingForVision = (g: GameView) =>
  atTable(g).filter((p) => !p.gone && p.step < 3 && !g.sent.includes(p.color));

/** Psychics the hour still waits on (not ready yet). */
export function notReady(g: GameView): PsychicView[] {
  return atTable(g).filter((p) => !p.gone && !p.ready && p.step < 3);
}

/** Psychics who vote now but haven't. */
export function votersNow(g: GameView): PsychicView[] {
  const f = g.final;
  if (g.stage !== 'vote' || !f) return [];
  return atTable(g).filter(
    (p) => !p.gone && p.voteStage === f.revealed && !f.voted.includes(p.color),
  );
}

const pillarWord = (step: number) => pillarAt(step) ?? 'card';

/** Plain-language guidance for whoever is looking. */
export function statusFor(view: SeanceView, isHost: boolean, people?: People): Status {
  const me = view.me;
  const g = view.game;
  if (view.phase === 'lobby' || !g) {
    if (!me?.playing)
      return { text: 'You’re watching. Take a seat to play in the next game.', yourMove: false };
    const problem = startProblem(view.settings, view.seats);
    if (problem) return { text: `Almost ready: ${problem}`, yourMove: false };
    if (isHost) return { text: 'Everyone is in. Press Start when you’re ready!', yourMove: true };
    return {
      text: `All set. ${people ? waitingForHost(people, 'start') : 'Waiting for the host to start…'}`,
      yourMove: false,
    };
  }
  if (view.phase === 'over') return { text: resultLine(g), yourMove: false };
  const names = (list: readonly PsychicView[]) =>
    people
      ? namesWithPresence(
          list.map((p) => p.id),
          people.players,
          { you: me?.id },
        )
      : '';
  const role = g.myRole;
  const hour = `Hour ${roman(g.hour)}`;
  if (g.ghost === null)
    return {
      text: '⏸ The ghost’s seat is empty. Someone watching can take it, and the game carries on.',
      yourMove: false,
    };
  if (role === 'ghost') {
    switch (g.stage) {
      case 'visions': {
        const waiting = waitingForVision(g);
        if (waiting.length)
          return {
            text: `${hour}: send a vision to ${waiting.length === 1 ? names(waiting) || 'the last psychic' : `each psychic (${waiting.length} waiting)`}. Tap a psychic to compare their card with your hand.`,
            yourMove: true,
          };
        if (g.canReveal)
          return {
            text: `${hour}: everyone is Ready. Reveal the verdicts when you are.`,
            yourMove: true,
          };
        return {
          text: `${hour}: every vision is out. Listen in silence while they decide; once everyone is Ready, you reveal the verdicts.`,
          yourMove: false,
        };
      }
      case 'reveal':
        return { text: `${hour}: the verdicts are in.`, yourMove: false };
      case 'shared':
        return {
          text: 'Everyone found their cards! Pick the culprit’s group, then 3 cards from your hand: one for its suspect, place and object.',
          yourMove: true,
        };
      case 'vote':
        return { text: 'The psychics are voting. Stay perfectly still…', yourMove: false };
      default:
        return { text: '', yourMove: false };
    }
  }
  const mine = myPsychic(view);
  if (!mine) {
    const lead = role === 'former-ghost' ? 'You’re watching (you know the answers). ' : '';
    switch (g.stage) {
      case 'visions':
        return { text: `${lead}${hour}: the psychics are reading their visions.`, yourMove: false };
      case 'reveal':
        return { text: `${lead}${hour}: the verdicts are in.`, yourMove: false };
      case 'shared':
        return { text: `${lead}The ghost is choosing a last, shared vision…`, yourMove: false };
      default:
        return { text: `${lead}The psychics are voting in silence.`, yourMove: false };
    }
  }
  switch (g.stage) {
    case 'visions': {
      if (mine.step >= 3) {
        if (g.clairvoyance && mine.tokens > 0)
          return {
            text: 'You found all three! Help the others: put ✓ or ✗ on their guesses before they lock in.',
            yourMove: false,
          };
        return {
          text: `You found all three. ${g.canReveal ? 'Everyone’s ready: waiting for the ghost to reveal.' : notReady(g).length ? `Waiting for: ${names(notReady(g))}.` : ''}`.trim(),
          yourMove: false,
        };
      }
      const what = pillarWord(mine.step);
      if (!g.sent.includes(mine.color))
        return {
          text: mine.visions.length
            ? `${hour}: the ghost will add to your vision. Meanwhile, look again: which ${what} could it be?`
            : `${hour}: waiting for your vision from the ghost…`,
          yourMove: false,
        };
      if (mine.intuition === null)
        return { text: `Your vision is here: which ${what} does it point to?`, yourMove: true };
      if (!mine.ready)
        return {
          text: waitingForVision(g).length
            ? 'Guess placed. Talk the visions over out loud; tap Ready when you’re sure.'
            : 'Discussion time: talk the visions over out loud, then tap Ready.',
          yourMove: true,
        };
      if (g.canReveal)
        return {
          text: 'Everyone’s ready: waiting for the ghost to reveal. You can still change your mind.',
          yourMove: false,
        };
      const waiting = waitingForVision(g).length
        ? 'Waiting for the ghost to finish the visions.'
        : notReady(g).length
          ? `Waiting for: ${names(notReady(g))}.`
          : '';
      return { text: `You’re ready. ${waiting}`.trim(), yourMove: false };
    }
    case 'reveal': {
      const v = g.verdicts.findLast((x) => x.color === mine.color && x.hour === g.hour);
      if (!v) return { text: `${hour}: the verdicts are in.`, yourMove: false };
      return v.correct
        ? {
            text:
              mine.step >= 3
                ? 'Right! You have found all three.'
                : `Right! Next, your ${pillarWord(mine.step)}.`,
            yourMove: false,
          }
        : {
            text: 'Not that one. You keep your vision, and the ghost will add more.',
            yourMove: false,
          };
    }
    case 'shared':
      return {
        text: 'Everyone found their cards! The ghost is choosing a last vision of the culprit…',
        yourMove: false,
      };
    case 'vote': {
      const f = g.final!;
      if (f.myVote !== undefined)
        return { text: 'Your vote is in. Stay silent until everyone has voted.', yourMove: false };
      if (mine.voteStage === f.revealed)
        return {
          text: `Vote now, in silence: which group holds the culprit? (${f.revealed} of 3 cards seen)`,
          yourMove: true,
        };
      return {
        text: `You see more: you vote once ${mine.voteStage} cards are face up.`,
        yourMove: false,
      };
    }
    default:
      return { text: '', yourMove: false };
  }
}

/** The end in one line. */
export function resultLine(g: GameView): string {
  const r = g.result;
  if (!r) return 'Game over.';
  switch (r.how) {
    case 'culprit':
      return 'The vote found the culprit: the ghost can rest in peace. Everyone wins!';
    case 'wrong':
      return 'The vote picked the wrong group: the ghost wanders on. Everyone loses.';
    case 'no-votes':
      return 'Nobody voted: the ghost wanders on. Everyone loses.';
    case 'clock':
      return 'The seventh hour has passed and the connection is lost. Everyone loses.';
  }
}
