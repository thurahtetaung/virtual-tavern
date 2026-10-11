import { MAX_SEATS, MIN_PLAYERS, type MasqueradeView } from '../logic/types.ts';

export interface Status {
  text: string;
  yourMove: boolean;
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
export function statusFor(view: MasqueradeView, isHost: boolean): Status {
  const me = view.me;
  if (view.phase === 'lobby') {
    const back =
      view.notice === 'too-few' ? 'Too few players were left, so you’re back in the lobby. ' : '';
    if (!me?.playing)
      return { text: `${back}The table is full: you’re watching.`, yourMove: false };
    const blocker = startBlocker(view);
    if (blocker) return { text: `${back}Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? { text: `${back}Everyone is in. Press Start game when you’re ready!`, yourMove: true }
      : { text: `${back}All set. Waiting for the host to start…`, yourMove: false };
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
  switch (round.stage) {
    case 'talk': {
      if (role === 'watching')
        return {
          text: 'You’re watching this round. You’ll be dealt in next round.',
          yourMove: false,
        };
      const starter = round.starter === me?.id ? 'You ask' : `${nameOf(view, round.starter)} asks`;
      const lead =
        role === 'spy'
          ? 'You’re the spy! Blend in and work out the location.'
          : 'Find the spy without giving the location away.';
      return {
        text: round.meReady
          ? `You’re ready to vote (${round.readyCount} of ${total}). Keep talking until everyone is.`
          : `${lead} ${starter} first.`,
        yourMove: false,
      };
    }
    case 'vote':
      if (role === 'watching') return { text: 'The table is voting for the spy…', yourMove: false };
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
      return {
        text: `${listNames(guessing.map((id) => nameOf(view, id)))} ${guessing.length > 1 ? 'were' : 'was'} caught as the spy and ${guessing.length > 1 ? 'are' : 'is'} guessing the location…`,
        yourMove: false,
      };
    }
    case 'reveal':
      return isHost
        ? { text: 'Round over! Press Next round when everyone has had a look.', yourMove: false }
        : { text: 'Round over! Waiting for the host to deal the next round…', yourMove: false };
  }
}

/** The table nudge for the moment, from the clock and the vote. */
export function nudgeFor(view: MasqueradeView, secondsLeft: number | null): string | null {
  const round = view.round;
  if (view.phase !== 'playing' || !round) return null;
  const total = round.players.length;
  if (round.stage === 'vote') return `🗳️ ${round.votedCount} of ${total} voted`;
  if (round.stage === 'guess') return '🎯 The caught spy is guessing the location';
  if (round.stage !== 'talk' || secondsLeft === null) return null;
  const ready = round.readyCount > 0 ? ` · ${round.readyCount} of ${total} ready to vote` : '';
  if (secondsLeft <= 30) return `⏰ 30 seconds left!${ready}`;
  if (secondsLeft <= 60) return `🤔 Last minute: think about who you’ll vote for${ready}`;
  if (secondsLeft <= 120) return `⏳ 2 minutes left${ready}`;
  return ready ? `✋ ${round.readyCount} of ${total} ready to vote` : null;
}
