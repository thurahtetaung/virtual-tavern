import type { PlayerId } from '@vt/game-sdk';
import type { RedHerringView } from '../logic/types.ts';

export type NameOf = (id: PlayerId | null | undefined) => string;

export interface Status {
  text: string;
  /** The viewer is expected to act now. */
  yourMove: boolean;
}

/** Who the table waits on now (as in the engine), from the view. */
export function waitingIds(view: RedHerringView): PlayerId[] {
  const r = view.game?.round;
  if (!r || view.phase !== 'playing') return [];
  switch (r.stage) {
    case 'card':
    case 'word':
    case 'play':
      return r.turn ? [r.turn] : [];
    case 'vote':
      return r.turn ? [r.turn] : r.order.slice(1).filter((id) => !r.voted.includes(id));
    default:
      return [];
  }
}

/**
 * The one line under the room header: what is happening and what the viewer should do. It never
 * gives a role away: the Conspirator's lines read exactly like a Detective's.
 */
export function statusFor(view: RedHerringView, you: PlayerId, name: NameOf): Status {
  const g = view.game;
  if (!g) return { text: '', yourMove: false };
  const r = g.round;
  if (view.phase === 'over') {
    if (view.settings.scoring === 'fun')
      return { text: 'Game over. Thanks for playing!', yourMove: false };
    const w = view.winners;
    if (!w.length) return { text: 'Game over: nobody scored.', yourMove: false };
    const names = w.map((id) => (id === you ? 'You' : name(id)));
    const text =
      w.length === 1
        ? `${names[0]} ${w[0] === you ? 'win' : 'wins'}!`
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} share the win!`;
    return { text, yourMove: false };
  }
  const inGame = r.order.includes(you);
  const picker = r.picker === you;
  const who = (id: PlayerId | null) => (id === you ? 'you' : name(id));
  switch (r.stage) {
    case 'card':
      return picker
        ? {
            text: 'You pick the word: first play a card that fits the word you have in mind.',
            yourMove: true,
          }
        : { text: `${name(r.picker)} is choosing a card for their word.`, yourMove: false };
    case 'word':
      return picker
        ? {
            text: 'Now write your word: it should fit that card and another in your hand.',
            yourMove: true,
          }
        : { text: `${name(r.picker)} is writing the word.`, yourMove: false };
    case 'play': {
      if (r.turn === you) {
        const lap = r.plays.filter((p) => p.by === you).length === 0 ? 'first' : 'second';
        return {
          text: `Your turn: play your ${lap} card. Tap a card in your hand.`,
          yourMove: true,
        };
      }
      const i = r.order.indexOf(you);
      const seq = [...r.order, ...r.order];
      const next = seq.indexOf(you, r.plays.length);
      const soon = inGame && i >= 0 && next === r.plays.length + 1;
      return {
        text: `${name(r.turn)} is playing a card.${soon ? ' You’re next.' : ''}`,
        yourMove: false,
      };
    }
    case 'discuss':
      return {
        text: inGame
          ? 'Talk it over: say why you played your cards, then who seems to be bluffing. The host starts the vote.'
          : 'The table is talking it over.',
        yourMove: false,
      };
    case 'vote': {
      if (!inGame || picker)
        return {
          text: picker
            ? 'The others are voting. You don’t vote this round.'
            : 'The table is voting.',
          yourMove: false,
        };
      if (r.myVote) return { text: 'Vote cast. Waiting for the others.', yourMove: false };
      if (r.turn && r.turn !== you) return { text: `${name(r.turn)} is voting.`, yourMove: false };
      return { text: 'Vote: who do you think had no word?', yourMove: true };
    }
    case 'reveal': {
      const res = r.result!;
      const c = res.conspirator === you ? 'You were' : `${name(res.conspirator)} was`;
      return {
        text: `${c} the Conspirator, and ${res.caught ? 'got caught' : 'got away'}. ${
          view.settings.scoring === 'fun'
            ? ''
            : `${who(r.picker) === 'you' ? 'You' : name(r.picker)} picked “${r.word ?? ''}”.`
        }`.trim(),
        yourMove: false,
      };
    }
  }
}
