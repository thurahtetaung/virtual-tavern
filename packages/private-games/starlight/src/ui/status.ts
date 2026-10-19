import { type GameRoomInfo, waitingFor, waitingForHost } from '@vt/game-sdk';
import { MAX_MARKS, MIN_MARKS, ROUNDS, type Shown, type StarlightView } from '../logic/types.ts';

export const ROMAN = ['I', 'II', 'III', 'IV'];
export const roundName = (no: number) => ROMAN[no - 1] ?? String(no);

export const nameOf = (view: StarlightView, id: string) =>
  view.seats.find((s) => s.id === id)?.name ?? 'Someone';

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function names(view: StarlightView, ids: readonly string[], you?: string): string {
  const list = ids.map((id) => (id === you ? 'you' : nameOf(view, id)));
  if (list.length <= 1) return list[0] ?? 'nobody';
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export interface Status {
  text: string;
  /** The viewer has something to do now (for the tab title and the hint's tone). */
  yourMove: boolean;
}

type Room = Pick<GameRoomInfo, 'you' | 'hostId' | 'isHost' | 'players'>;

/** Why the host can't start, from the view (the server checks again). */
export function startBlocker(view: StarlightView, cards: number, words: number): string | null {
  const n = view.seats.filter((s) => s.playing).length;
  if (n < 3) return `Waiting for ${3 - n} more ${3 - n === 1 ? 'player' : 'players'} to sit down.`;
  if (n > 6) return 'At most 6 can play.';
  if (cards < 30) return 'Pick card sets with at least 30 cards.';
  if (words < ROUNDS) return `Pick word lists with at least ${ROUNDS} words.`;
  return null;
}

/** The one line that tells the viewer what is happening and what to do. */
export function statusFor(view: StarlightView, room: Room, blocker: string | null): Status {
  const me = view.me;
  const r = view.round;
  if (view.phase === 'lobby') {
    if (room.isHost)
      return blocker
        ? { text: blocker, yourMove: false }
        : { text: 'Everyone’s here? Press Start game.', yourMove: true };
    return { text: me?.playing ? waitingForHost(room) : 'Take a seat to play.', yourMove: false };
  }
  if (view.phase === 'over' || !r) {
    const w = view.winners;
    const top = view.seats.find((s) => s.id === w[0])?.score ?? 0;
    if (view.endReason === 'too-few' && !w.length)
      return { text: 'Too few players were left, so the game ended.', yourMove: false };
    const who = w.includes(me?.id ?? '')
      ? w.length === 1
        ? 'You win'
        : `You share the win with ${names(
            view,
            w.filter((id) => id !== me?.id),
          )}`
      : `${names(view, w)} ${w.length === 1 ? 'wins' : 'share the win'}`;
    return {
      text: `${who} with ${top} ${top === 1 ? 'point' : 'points'}!${view.endReason === 'too-few' ? ' (Too few players were left to go on.)' : ''}`,
      yourMove: false,
    };
  }
  const playing = !!me && r.players.includes(me.id) && !r.gone.includes(me.id);
  if (r.stage === 'word') {
    if (me?.id === r.first)
      return {
        text: 'You’re the First Scout: this word card has two words. Pick the one the table plays.',
        yourMove: true,
      };
    return {
      text: `${nameOf(view, r.first)} (First Scout) is choosing the word…`,
      yourMove: false,
    };
  }
  if (r.stage === 'mark') {
    const waiting = r.players.filter((id) => !r.locked.includes(id));
    if (!playing) return { text: waitingFor(waiting, room.players), yourMove: false };
    if (r.locked.includes(me.id))
      return {
        text: `Slate locked. ${waitingFor(waiting, room.players, { you: me.id })}. You can still unlock it until the last one locks.`,
        yourMove: false,
      };
    const n = r.myMarks.length;
    return {
      text:
        n === 0
          ? `Tap every picture “${r.word}” brings to mind (${MIN_MARKS}–${MAX_MARKS}), then lock your slate. Nobody sees your marks.`
          : `${n} marked. Mark up to ${MAX_MARKS}, then lock your slate.`,
      yourMove: true,
    };
  }
  if (r.stage === 'reveal') {
    if (r.scout === me?.id)
      return {
        text: 'You’re the Scout: pick one of your marked cards to show. Your most obvious one is safest.',
        yourMove: true,
      };
    return {
      text: `${r.scout ? nameOf(view, r.scout) : 'Someone'} is the Scout and is choosing a card to show…`,
      yourMove: false,
    };
  }
  // The round is scored.
  const last = r.no >= ROUNDS;
  return room.isHost
    ? {
        text: last
          ? 'The last round is scored. Press See final scores.'
          : `Round ${roundName(r.no)} is scored. Talk it over, then press Next round.`,
        yourMove: true,
      }
    : {
        text: `Round ${roundName(r.no)} is scored. ${waitingForHost(room, last ? 'show the final scores' : 'start the next round')}`,
        yourMove: false,
      };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a shown card did, in a sentence: the Reveal's moment. */
export function showLine(view: StarlightView, s: Shown, you?: string): string {
  const scout = s.scout === you ? 'You' : nameOf(view, s.scout);
  const others = s.markers.slice(1);
  const fallen = others.filter((id) => s.stars[id] === 0);
  const fallenNote = fallen.length
    ? ` (${names(view, fallen, you)} ${fallen.length === 1 && fallen[0] !== you ? 'has' : 'have'} fallen, so no stars there)`
    : '';
  if (s.kind === 'fall')
    return `🌠 ${scout} ${s.scout === you ? 'fall' : 'falls'}: nobody else marked it. No more stars this round.`;
  if (s.kind === 'super')
    return `🌟 Super-Spark! Only ${names(view, others, you)} marked it too: 3 stars each${fallenNote}.`;
  return `✨ Spark! ${capital(names(view, others, you))} marked it too: 2 stars each${fallenNote}.`;
}
