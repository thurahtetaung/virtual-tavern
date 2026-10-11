import { EDITIONS, type RoyalPostView } from '../logic/types.ts';
import { listNames, nameOf } from './text.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: RoyalPostView): string | null {
  const edition = EDITIONS[view.settings.edition];
  const seated = view.seats.filter((s) => s.playing).length;
  if (seated < edition.minPlayers)
    return `${edition.minPlayers} players are needed (${seated} seated).`;
  if (seated > edition.maxPlayers)
    return `This edition seats at most ${edition.maxPlayers} (${seated} seated).`;
  return null;
}

const mustPlayCountess = (hand: readonly string[]) =>
  hand.includes('countess') && (hand.includes('king') || hand.includes('prince'));

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(view: RoyalPostView, isHost: boolean, hostName = 'the host'): Status {
  const me = view.me;
  if (view.phase === 'lobby') {
    if (!me?.playing) {
      const full =
        view.seats.filter((s) => s.playing).length >= EDITIONS[view.settings.edition].maxPlayers;
      return {
        text: full
          ? 'The table is full, so you’re watching. You’ll get the next free seat.'
          : 'Take a seat to play, or just watch.',
        yourMove: !!me && !full,
      };
    }
    const blocker = startBlocker(view);
    if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
    // Never "everyone is seated" while friends are left watching.
    const watching = view.seats.filter((s) => !s.playing).map((s) => s.name);
    const also = watching.length
      ? ` ${listNames(watching)} ${watching.length === 1 ? 'is' : 'are'} watching.`
      : '';
    return isHost
      ? {
          text: watching.length
            ? `Ready to start.${also} Press Start when your friends are ready!`
            : 'Everyone is seated. Press Start when your friends are ready!',
          yourMove: true,
        }
      : { text: `All set. Waiting for ${hostName} to start…`, yourMove: false };
  }
  if (view.phase === 'over') {
    const names = view.winners.map((id) => (id === me?.id ? 'You' : nameOf(view, id)));
    const result =
      names.length === 0
        ? 'Nobody won.'
        : `${listNames(names)} ${names.length > 1 || names[0] === 'You' ? 'win' : 'wins'} the game!`;
    return {
      text: view.endReason === 'too-few' ? `Not enough players to go on. ${result}` : result,
      yourMove: false,
    };
  }
  const round = view.round!;
  if (round.stage === 'over') {
    return isHost
      ? { text: 'Round over! Press Next round when everyone has had a look.', yourMove: true }
      : { text: `Round over! Waiting for ${hostName} to deal the next round…`, yourMove: false };
  }
  const mine = round.players.find((p) => p.id === me?.id);
  const turn = nameOf(view, round.current);
  if (round.current === me?.id) {
    if (round.stage === 'chancellor')
      return { text: 'Your turn: keep one card and put the others on the bottom.', yourMove: true };
    if (mustPlayCountess(view.hand))
      return { text: 'Your turn: you must play the Countess.', yourMove: true };
    return { text: 'Your turn: tap a card to play it.', yourMove: true };
  }
  if (!mine) {
    const next = me?.waiting ? ' You’re dealt in at the next game.' : '';
    return { text: `Watching: ${turn} is playing.${next}`, yourMove: false };
  }
  if (mine.out) return { text: `You’re out this round. ${turn} is playing…`, yourMove: false };
  return {
    text:
      round.stage === 'chancellor'
        ? `${turn} is choosing which card to keep…`
        : `${turn} is playing…`,
    yourMove: false,
  };
}
