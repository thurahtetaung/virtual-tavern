import { type PresencePlayer, waitingForHost } from '@vt/game-sdk';
import { startProblem } from '../logic/setup.ts';
import type { GameView, InquestView, MyRole } from '../logic/types.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

/** Who is in the room (and online), so texts can name the host. */
export interface People {
  hostId: string;
  players: readonly PresencePlayer[];
}

export const nameOf = (view: InquestView, id: string | null | undefined) =>
  view.game?.players.find((p) => p.id === id)?.name ??
  view.seats.find((s) => s.id === id)?.name ??
  'Someone';

/** Who the table waits on: named players, or a secret role ("the Murderer"). */
export interface Waiting {
  ids: string[];
  label?: string;
}

export function waitingOn(view: InquestView): Waiting | null {
  const g = view.game;
  if (view.phase !== 'playing' || !g) return null;
  switch (g.stage) {
    case 'night':
      return { ids: [], label: 'the Murderer' };
    case 'reversal':
      return { ids: [], label: 'the Murderer and the Accomplice' };
    case 'present':
      return g.present ? { ids: [g.present.order[g.present.index]!] } : null;
    case 'collect': {
      const ev = g.event;
      if (ev?.kind === 'ruled-out') return ev.current ? { ids: [ev.current] } : null;
      if (ev?.kind === 'testimony') return { ids: [], label: 'the Witness' };
      return { ids: [g.fs] };
    }
    default:
      return null;
  }
}

/**
 * The status line's brief while play goes on. It is on screen all the time, so it never gives a
 * secret role away: the Murderer, Accomplice, Witness and Investigators all read the same line
 * (their own guidance sits behind the tap-to-reveal role card on the Me tab).
 */
export function roleLine(role: MyRole, g: GameView, view: InquestView): string {
  switch (role) {
    case 'forensic':
      return 'You’re the Forensic Scientist: only your bullets may speak.';
    case 'former-forensic':
      return 'You’re watching and you know the answer, so keep it to yourself.';
    case null:
      return 'You’re watching this case.';
    default: {
      const me = g.players.find((p) => p.id === view.me?.id);
      return me && me.badges <= 0
        ? 'You’ve used your attempt: keep listening and presenting.'
        : 'Listen, study the suspects, and tap Solve when you’re sure.';
    }
  }
}

const clockText = (s: number | null) =>
  s === null ? '' : ` (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`;

/** Plain-language guidance for whoever is looking. `secondsLeft` is the current clock, if any. */
export function statusFor(
  view: InquestView,
  isHost: boolean,
  people?: People,
  secondsLeft: number | null = null,
): Status {
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
  if (view.phase === 'over') return { text: resultLine(view), yourMove: false };
  const role = g.myRole;
  const fs = role === 'forensic';
  const lead = roleLine(role, g, view);
  const fsName = nameOf(view, g.fs);
  switch (g.stage) {
    case 'night':
      return role === 'murderer'
        ? { text: 'Murderer: pick 1 Clue + 1 Means from your own cards.', yourMove: true }
        : { text: `${lead} Night falls: the Murderer is choosing the crime…`, yourMove: false };
    case 'reversal':
      if (role === 'murderer')
        return {
          text: 'Caught! Name the Witness: tap who it is, then confirm. Your Accomplice sees your taps.',
          yourMove: true,
        };
      if (role === 'accomplice')
        return {
          text: 'Caught! Help the Murderer name the Witness: your taps show on their screen.',
          yourMove: true,
        };
      return {
        text: 'Solved! But the culprits get one last chance: if they find the Witness, they win.',
        yourMove: false,
      };
    case 'present': {
      const p = g.present!;
      const speaker = p.order[p.index]!;
      const next = p.order.slice(p.index + 1)[0];
      const left = p.order.length - p.index - 1;
      const last = g.round >= g.finalRound ? ' Last chance!' : '';
      if (speaker === me?.id)
        return { text: `Your turn to present${clockText(secondsLeft)}.${last}`, yourMove: true };
      const up = next ? ` Up next: ${next === me?.id ? 'you' : nameOf(view, next)}.` : '';
      const tail = g.round >= g.finalRound ? ` ${left} speaker${left === 1 ? '' : 's'} left.` : '';
      return {
        text: `${nameOf(view, speaker)} is presenting.${up}${tail}${fs ? '' : ` ${lead}`}`,
        yourMove: false,
      };
    }
    case 'collect': {
      const ev = g.event;
      if (ev?.kind === 'ruled-out') {
        if (ev.current === me?.id)
          return { text: 'Your turn: flip one of your own Clue cards face down.', yourMove: true };
        return {
          text: `Everyone flips one of their own Clue cards. ${nameOf(view, ev.current)} is choosing…`,
          yourMove: false,
        };
      }
      if (ev?.kind === 'testimony')
        return role === 'witness'
          ? { text: 'Secret: pick a scene tile to have replaced.', yourMove: true }
          : { text: 'The Witness is quietly choosing a tile to replace…', yourMove: false };
      if (ev?.kind === 'useful-clue')
        return fs
          ? {
              text: 'Pick one of the drawn tiles, then the scene tile it replaces.',
              yourMove: true,
            }
          : { text: `${fsName} is choosing a fresh tile…`, yourMove: false };
      if (ev?.kind === 'erroneous')
        return fs
          ? { text: 'Move one bullet to another item on the same tile.', yourMove: true }
          : { text: `${fsName} is moving one bullet…`, yourMove: false };
      if (ev?.kind === 'countdown')
        return fs
          ? {
              text: `Swap in the new tiles: tap a scene tile to replace (${ev.left} left).`,
              yourMove: true,
            }
          : { text: `${fsName} is swapping in new tiles…`, yourMove: false };
      const step = g.step?.kind;
      if (step === 'pick-location')
        return fs
          ? { text: 'Pick the Location tile for this crime.', yourMove: true }
          : { text: `${lead} ${fsName} is picking the Location…`, yourMove: false };
      if (step === 'replace')
        return fs
          ? { text: 'A new tile: tap the scene tile it replaces.', yourMove: true }
          : { text: `${lead} ${fsName} is swapping in a new tile…`, yourMove: false };
      if (fs) {
        const missing = g.slots.filter((s) => s.bullet === null).length;
        const placed = g.slots.length - missing;
        return g.round === 1
          ? { text: `Place bullet ${placed + 1} of ${g.slots.length}.`, yourMove: true }
          : { text: 'Place a bullet on the new tile.', yourMove: true };
      }
      return { text: lead, yourMove: false };
    }
    default:
      return { text: lead, yourMove: false };
  }
}

/** The end in one line: who won and how. */
export function resultLine(view: InquestView): string {
  const r = view.game?.result;
  if (!r) return 'Game over.';
  const solver = r.solvedBy ? nameOf(view, r.solvedBy) : 'Someone';
  switch (r.how) {
    case 'solved':
      return `Case closed! ${solver} named the crime: the Investigators win.`;
    case 'reversal':
      return r.witnessFound
        ? `${solver} solved it, but the culprits found the Witness (${nameOf(view, r.reversalPick)}): the Murderer’s side wins.`
        : `${solver} solved it, and the Witness stayed hidden: the Investigators win.`;
    case 'badges':
      return 'Every attempt is spent: the Murderer’s side wins.';
    case 'time':
      return 'Time’s up: nobody named the crime, so the Murderer’s side wins.';
  }
}

/** Whether the viewer may solve now, and why not. */
export function solveBlocker(view: InquestView): string | null {
  const g = view.game;
  if (view.phase !== 'playing' || !g) return 'No game in progress.';
  const me = g.players.find((p) => p.id === view.me?.id);
  if (!me || me.isFs || me.formerFs) return 'Only players at the table can solve.';
  if (me.badges <= 0) return 'You’ve used your attempt.';
  if (g.stage === 'night' || g.stage === 'reversal') return 'You can’t solve right now.';
  if (g.stage === 'collect' && g.bullets.length === 0)
    return 'You can solve once the first bullet is down.';
  return null;
}
