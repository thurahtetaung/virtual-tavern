import { type GameRoomInfo, waitingFor, waitingForHost } from '@vt/game-sdk';
import { setupProblem } from '../logic/game.ts';
import { hostileGroupsIn } from '../logic/roles.ts';
import type { NightfallView } from '../logic/types.ts';
import { listNames, nameOfView } from './text.ts';

export interface Status {
  text: string;
  /** The viewer must do something now (marks the tab "● Your turn"). */
  yourMove: boolean;
}

export function startBlocker(view: NightfallView): string | null {
  return setupProblem(view.settings.roles, view.seats.filter((s) => s.playing).length);
}

type Room = Pick<GameRoomInfo, 'isHost' | 'hostId' | 'players' | 'you'>;

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(view: NightfallView, room: Room): Status {
  const { isHost } = room;
  const playing = view.myRole !== null;
  // Who the table still waits on, by name (offline marked), e.g. "Waiting for: Ana, Ben (offline)".
  const waiting = waitingFor(view.waitingOn, room.players, { you: room.you });
  const tail = waiting ? ` ${waiting}.` : '';
  switch (view.phase) {
    case 'lobby': {
      if (!view.me?.playing) return { text: 'You’re watching this game.', yourMove: false };
      const blocker = startBlocker(view);
      if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
      return isHost
        ? { text: 'Everyone is in. Press Deal the cards when you’re ready!', yourMove: true }
        : { text: `All set. ${waitingForHost(room, 'deal')}`, yourMove: false };
    }
    case 'ready':
      if (!playing)
        return { text: `The players are looking at their cards…${tail}`, yourMove: false };
      return view.meReady
        ? {
            text: `You’re ready. The night starts when everyone is.${tail}`,
            yourMove: false,
          }
        : { text: 'Cover your screen, look at your card, then press Ready.', yourMove: true };
    case 'night': {
      const acting = view.night?.acting;
      if (acting?.prompt) return { text: 'Your turn: you’re awake!', yourMove: true };
      if (acting) return { text: 'You’re awake: see what you learned.', yourMove: false };
      return playing
        ? {
            text: 'Eyes closed. Keep your phone face up — it lights up when it’s your turn.',
            yourMove: false,
          }
        : { text: 'You’re watching. The players’ phones light up in turn.', yourMove: false };
    }
    case 'day':
      if (!playing) return { text: 'The village is talking it over.', yourMove: false };
      return view.day?.meReady
        ? {
            text: `You’re ready to vote. Keep talking until everyone is.${tail}`,
            yourMove: false,
          }
        : {
            text: `Daybreak! Talk it over: who is a ${hostileGroupsIn(view.settings.roles).includes('vampire') ? 'werewolf, who is a vampire' : 'werewolf'}? Press Ready to vote when you’re done.`,
            yourMove: false,
          };
    case 'vote': {
      if (!playing) return { text: `Everyone is voting…${tail}`, yourMove: false };
      const nameOf = nameOfView(view);
      return view.vote?.myVote
        ? {
            text: `You voted for ${nameOf(view.vote.myVote)}. Tap someone else to change.${tail}`,
            yourMove: false,
          }
        : {
            text: 'Vote! Tap the player you want to die. Nobody sees it until everyone has voted.',
            yourMove: true,
          };
    }
    case 'reveal': {
      const result = view.reveal?.result;
      const nameOf = nameOfView(view);
      const names = (result?.winners ?? []).map((id) => (id === view.me?.id ? 'You' : nameOf(id)));
      const text = names.length
        ? `${listNames(names)} ${names.length > 1 || names[0] === 'You' ? 'win' : 'wins'}!`
        : 'Nobody wins this time.';
      return {
        text: isHost
          ? `${text} Play again when you’re ready.`
          : `${text} ${waitingForHost(room, 'deal again')}`,
        yourMove: false,
      };
    }
  }
}

/** The table nudge for the day, from the clock and how many are ready. */
export function nudgeFor(view: NightfallView, secondsLeft: number | null): string | null {
  const total = view.table?.filter((p) => !p.left).length ?? 0;
  if (view.phase === 'vote') return `🗳️ ${view.vote?.votedCount ?? 0} of ${total} voted`;
  if (view.phase !== 'day' || secondsLeft === null) return null;
  const n = view.day?.readyCount ?? 0;
  const ready = n > 0 ? ` · ${n} of ${total} ready to vote` : '';
  if (secondsLeft <= 30) return `⏰ 30 seconds left!${ready}`;
  if (secondsLeft <= 60) return `🤔 Last minute: decide who you’ll vote for${ready}`;
  if (secondsLeft <= 120) return `⏳ 2 minutes left${ready}`;
  return n > 0 ? `✋ ${n} of ${total} ready to vote` : null;
}
