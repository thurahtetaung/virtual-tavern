import { type GameRoomInfo, waitingFor, waitingForHost } from '@vt/game-sdk';
import { setupProblem } from '../logic/game.ts';
import { ARTIFACTS, hostileGroupsIn } from '../logic/roles.ts';
import { type NightfallView, VOTE_APP } from '../logic/types.ts';
import { listNames, nameOfView } from './text.ts';

export interface Status {
  text: string;
  /** The viewer must do something now (marks the tab "● Your turn"). */
  yourMove: boolean;
}

export function startBlocker(view: NightfallView): string | null {
  return setupProblem(view.settings.roles, view.seats.filter((s) => s.playing).length);
}

/**
 * What the viewer's pick does in the vote: a Bodyguard's pick protects instead of voting.
 * `protect`: an artifact made them the Bodyguard (it travels with their final card, so it holds).
 * `protect-if-kept`: they were dealt the Bodyguard, so it holds unless their card was moved.
 */
export type VotePower = 'vote' | 'protect' | 'protect-if-kept';

export function votePower(view: NightfallView): VotePower {
  const artifact = view.notes.find((n) => n.kind === 'artifact');
  const becomes = artifact?.kind === 'artifact' ? ARTIFACTS[artifact.artifact].becomes : undefined;
  if (becomes) return becomes === 'bodyguard' ? 'protect' : 'vote';
  return view.myRole === 'bodyguard' ? 'protect-if-kept' : 'vote';
}

type Room = Pick<GameRoomInfo, 'isHost' | 'hostId' | 'players' | 'you'>;

/** "a werewolf", "a werewolf, who is a vampire", "an alien"… for the day's prompt. */
function evilWords(groups: readonly string[]): string {
  const words = groups.map((g) => (g === 'alien' ? 'an alien' : `a ${g}`));
  if (!words.length) return 'a werewolf';
  return words.join(', who is ');
}

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
      if (blocker)
        return {
          text: isHost
            ? `Almost ready: ${blocker}`
            : `The host is picking the cards. Almost ready: ${blocker}`,
          yourMove: false,
        };
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
        : {
            text: 'You’re watching: the players have their eyes closed while the roles are called.',
            yourMove: false,
          };
    }
    case 'day':
      if (!playing) return { text: 'The village is talking it over.', yourMove: false };
      return view.day?.meReady
        ? {
            text: `You’re ready to vote. Keep talking until everyone is.${tail}`,
            yourMove: false,
          }
        : {
            text: `Daybreak! Talk it over: who is ${evilWords(hostileGroupsIn(view.settings.roles))}? Press Ready to vote when you’re done.`,
            yourMove: false,
          };
    case 'vote': {
      if (!playing) return { text: `Everyone is voting…${tail}`, yourMove: false };
      const nameOf = nameOfView(view);
      const power = votePower(view);
      const caveat =
        power === 'protect-if-kept'
          ? ' (You were dealt the Bodyguard: if your card was moved in the night, this counts as a vote instead.)'
          : '';
      if (view.vote?.hands === 2 && view.vote.myVote && !view.vote.mySecond)
        return {
          text: 'You vote with both hands: choose your second vote too (it may be the same player).',
          yourMove: true,
        };
      if (view.vote?.myVote)
        return {
          text:
            power === 'vote'
              ? `You voted for ${view.vote.myVote === VOTE_APP ? 'the app' : nameOf(view.vote.myVote)}${view.vote.mySecond ? ` and ${view.vote.mySecond === VOTE_APP ? 'the app' : nameOf(view.vote.mySecond)}` : ''}. Tap someone else to change.${tail}`
              : `You’re protecting ${nameOf(view.vote.myVote)}. Tap someone else to change.${caveat}${tail}`,
          yourMove: false,
        };
      return power === 'vote'
        ? {
            text: 'Vote! Tap the player you want to die. Nobody sees it until everyone has voted.',
            yourMove: true,
          }
        : {
            text: `Your vote PROTECTS: tap the player who must not die. It isn’t a vote against them.${caveat}`,
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
      // Guests are told who deals again once, at the foot of the reveal (`waiting-host`).
      return { text: isHost ? `${text} Play again when you’re ready.` : text, yourMove: false };
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
  // A short heads-up as the clock passes 2:00, only when the day was longer than that.
  if (secondsLeft <= 120 && secondsLeft > 105 && view.settings.daySeconds > 120)
    return `⏳ 2 minutes left${ready}`;
  return n > 0 ? `✋ ${n} of ${total} ready to vote` : null;
}
