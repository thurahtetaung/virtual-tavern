import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import type { RoyalPostAction, RoyalPostState } from './types.ts';

/**
 * Stats only: every card played, every knock-out and what caused it, Guard guesses, round
 * winners, the Spy bonus and the game's result. Round ends add the survivors' final cards, which
 * the round's result shows everyone. Read from the public log entries this change
 * added, so nothing private (hands, Priest peeks, Baron results) is ever reported.
 */
export function insights(
  before: RoyalPostState,
  after: RoyalPostState,
  _action: RoyalPostAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const edition = after.settings.edition;
  // The round's result (with every survivor's last card) is shown to everyone once it ends.
  const resultOf = (round: number) =>
    after.round?.number === round ? (after.round.result ?? null) : null;
  const events: InsightEvent[] = [];
  for (const entry of after.log) {
    if (entry.id <= before.seq) continue;
    switch (entry.kind) {
      case 'play':
        events.push({
          type: 'play',
          playerId: entry.by,
          props: {
            card: entry.card,
            edition,
            noEffect: entry.noEffect,
            target: entry.target,
            tie: entry.tie === true,
            // Played by the strict timer (a deadline), not by the player.
            auto: entry.timedOut === true || by === null,
          },
        });
        if (entry.card === 'guard' && entry.guess) {
          events.push({
            type: 'guard',
            playerId: entry.by,
            props: { hit: entry.hit === true, guess: entry.guess, edition },
          });
        }
        break;
      case 'out':
        if (entry.cause === 'left') break;
        events.push({
          type: 'elimination',
          playerId: entry.player,
          props: {
            cause: entry.cause,
            by: entry.by,
            lostPrincess: entry.cards.includes('princess') || entry.cause === 'princess',
            edition,
            cards: [...entry.cards],
          },
        });
        break;
      case 'round-end': {
        const result = resultOf(entry.round);
        const survivors = result ? Object.keys(result.hands) : [];
        events.push({
          type: 'round',
          props: {
            edition,
            round: entry.round,
            reason: entry.reason,
            roundWinners: entry.winners,
            spy: entry.spy,
            survivors,
            finalCards: survivors.map((id) => result!.hands[id]!),
            tokensTo: [...entry.winners, ...(entry.spy ? [entry.spy] : [])],
          },
        });
        if (entry.spy) events.push({ type: 'spy', playerId: entry.spy, props: { edition } });
        break;
      }
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    const ranking = Object.entries(after.seats)
      .filter(([, seat]) => seat.playing)
      .sort(([, a], [, b]) => b.tokens - a.tokens)
      .map(([id]) => id);
    events.push({
      type: 'outcome',
      winners: after.winners,
      props: {
        edition,
        rounds: after.round?.number ?? 0,
        target: after.target,
        endReason: after.endReason,
        ranking,
        tokens: ranking.map((id) => after.seats[id]!.tokens),
      },
    });
  }
  return events;
}
