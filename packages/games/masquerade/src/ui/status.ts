import { type PresencePlayer, namesWithPresence, waitingFor, waitingForHost } from '@vt/game-sdk';
import { MAX_SEATS, MIN_PLAYERS, type MasqueradeView, type RoundResult } from '../logic/types.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

/** Who is in the room (and online), so waiting texts can name people and the host. */
export interface People {
  hostId: string;
  players: readonly PresencePlayer[];
}

export const nameOf = (view: MasqueradeView, id: string | null | undefined) =>
  view.round?.players.find((p) => p.id === id)?.name ??
  view.seats.find((s) => s.id === id)?.name ??
  'Someone';

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: MasqueradeView): string | null {
  const seated = view.seats.filter((s) => s.playing).length;
  if (seated < MIN_PLAYERS) return `${MIN_PLAYERS} players are needed (${seated} so far).`;
  if (seated > MAX_SEATS) return `At most ${MAX_SEATS} can play.`;
  if (view.locations.length === 0) return 'Pick at least one edition.';
  return null;
}

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(view: MasqueradeView, isHost: boolean, people?: People): Status {
  const me = view.me;
  const host = (what: string) =>
    people ? waitingForHost(people, what) : `Waiting for the host to ${what}…`;
  if (view.phase === 'lobby') {
    const back =
      view.notice === 'too-few' ? 'Too few players were left, so you’re back in the lobby. ' : '';
    if (!me?.playing)
      return { text: `${back}The table is full: you’re watching.`, yourMove: false };
    const blocker = startBlocker(view);
    if (blocker) return { text: `${back}Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? { text: `${back}Everyone is in. Press Start game when you’re ready!`, yourMove: true }
      : { text: `${back}All set. ${host('start')}`, yourMove: false };
  }
  if (view.phase === 'over') {
    const names = view.winners.map((id) => (id === me?.id ? 'You' : nameOf(view, id)));
    return {
      text: names.length
        ? `${listNames(names)} ${names.length > 1 || names[0] === 'You' ? 'win' : 'wins'} the game!`
        : 'Game over: nobody scored.',
      yourMove: false,
    };
  }
  const round = view.round!;
  const role = round.role;
  const total = round.players.length;
  /** " Waiting for: Ana, Ben (offline).": for watchers, who don't see the vote panel. */
  const holdouts = (done: readonly string[]) => {
    if (!people) return '';
    const left = round.players.map((p) => p.id).filter((id) => !done.includes(id));
    const names = waitingFor(left, people.players, { you: me?.id });
    return names ? ` ${names}.` : '';
  };
  switch (round.stage) {
    case 'talk': {
      if (role === 'watching')
        return {
          text: 'You’re watching this round. You’ll be dealt in next round.',
          yourMove: false,
        };
      const starter =
        round.starter === me?.id ? 'You start' : `${nameOf(view, round.starter)} starts`;
      const lead =
        role === 'spy'
          ? 'You’re the spy! Blend in and work out the location.'
          : 'Find the spy without giving the location away.';
      return {
        text: round.meReady
          ? `You’re ready to vote (${round.readyCount} of ${total}). Keep talking until everyone is.`
          : `${lead} ${starter}: ask anyone a question about the location, out loud. Need ideas? See the Ideas tab.`,
        yourMove: false,
      };
    }
    case 'vote':
      if (role === 'watching')
        return {
          text: `The table is voting for the spy…${holdouts(round.votedIds)}`,
          yourMove: false,
        };
      if (!round.myVote)
        return { text: 'Vote time! Who is the spy? Your vote is secret.', yourMove: true };
      return {
        text: `You voted for ${nameOf(view, round.myVote)}. ${round.votedCount} of ${total} have voted; tap another player to change.`,
        yourMove: false,
      };
    case 'guess': {
      if (round.canGuess)
        return {
          text: 'You were caught! Pick the location on the Locations board to steal the round.',
          yourMove: true,
        };
      const guessing = (round.caught ?? []).filter((id) => !round.guessed.includes(id));
      // Each caught spy, marked "(offline)" while away so nobody waits in the dark.
      const names = guessing.map((id) =>
        id === me?.id
          ? 'You'
          : (people && namesWithPresence([id], people.players)) || nameOf(view, id),
      );
      const plural = names.length > 1 || names[0] === 'You';
      const youGuessed =
        !!me && round.guessed.includes(me.id) ? 'You were caught and made your guess. ' : '';
      return {
        text: `${youGuessed}${listNames(names)} ${plural ? 'were' : 'was'} caught as the spy and ${plural ? 'are' : 'is'} guessing the location…`,
        yourMove: false,
      };
    }
    case 'reveal':
      return isHost
        ? { text: 'Round over! Press Next round when everyone has had a look.', yourMove: false }
        : { text: `Round over! ${host('deal the next round')}`, yourMove: false };
  }
}

/** The table nudge for the moment, from the clock and the vote. */
export function nudgeFor(view: MasqueradeView, secondsLeft: number | null): string | null {
  const round = view.round;
  if (view.phase !== 'playing' || !round) return null;
  const total = round.players.length;
  if (round.stage === 'vote') return `🗳️ ${round.votedCount} of ${total} voted`;
  if (round.stage === 'guess')
    return round.canGuess
      ? '🎯 You were caught! One guess at the location'
      : '🎯 The caught spy is guessing the location';
  if (round.stage !== 'talk' || secondsLeft === null) return null;
  const ready = round.readyCount > 0 ? ` · ${round.readyCount} of ${total} ready to vote` : '';
  if (secondsLeft <= 30) return `⏰ 30 seconds left!${ready}`;
  if (secondsLeft <= 60) return `🤔 Last minute: think about who you’ll vote for${ready}`;
  if (secondsLeft <= 120) return `⏳ 2 minutes left${ready}`;
  return ready ? `✋ ${round.readyCount} of ${total} ready to vote` : null;
}

/** Votes per player, most first (ties keep seat order); players nobody voted for are left out. */
export function voteTally(
  votes: Record<string, string>,
  players: readonly { id: string }[],
): { id: string; votes: number }[] {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) counts.set(target, (counts.get(target) ?? 0) + 1);
  return players
    .map((p) => ({ id: p.id, votes: counts.get(p.id) ?? 0 }))
    .filter((t) => t.votes > 0)
    .sort((a, b) => b.votes - a.votes);
}

/** Why the vote named nobody, or null when it named someone. */
export function noNameReason(result: Pick<RoundResult, 'votes' | 'named'>): string | null {
  if (result.named.length > 0) return null;
  return Object.keys(result.votes).length === 0
    ? 'Nobody voted, so nobody was named and the spy escapes.'
    : 'A tie at the top, so nobody was named and the spy escapes.';
}

/** How this round's points came about, one line per spy outcome. */
export function pointsRule(result: Pick<RoundResult, 'spyResults'>): string {
  const caught = result.spyResults.some((s) => s.outcome === 'caught');
  const spyScored = result.spyResults.some((s) => s.outcome !== 'caught');
  const parts: string[] = [];
  if (spyScored) parts.push('A spy who escapes the vote, or names the location, scores 2.');
  if (caught)
    parts.push(
      'When a caught spy guesses wrong, every local scores 1, and 1 more for voting for that spy.',
    );
  return parts.join(' ');
}
