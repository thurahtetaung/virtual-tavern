import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import type { RoyalPostAction, RoyalPostState } from './types.ts';

/**
 * Stats only: every card played, every knock-out and what caused it, Guard guesses, round
 * winners, the Spy bonus and the game's result. Read from the public log entries this change
 * added, so nothing private (hands, Priest peeks, Baron results) is ever reported.
 */
export function insights(
  before: RoyalPostState,
  after: RoyalPostState,
  _action: RoyalPostAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const edition = after.settings.edition;
  const events: InsightEvent[] = [];
  for (const entry of after.log) {
    if (entry.id <= before.seq) continue;
    switch (entry.kind) {
      case 'play':
        events.push({
          type: 'play',
          playerId: entry.by,
          props: { card: entry.card, edition, noEffect: entry.noEffect },
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
          },
        });
        break;
      case 'round-end':
        events.push({
          type: 'round',
          props: {
            edition,
            round: entry.round,
            reason: entry.reason,
            roundWinners: entry.winners,
            spy: entry.spy,
          },
        });
        if (entry.spy) events.push({ type: 'spy', playerId: entry.spy, props: { edition } });
        break;
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    events.push({
      type: 'outcome',
      winners: after.winners,
      props: {
        edition,
        rounds: after.round?.number ?? 0,
        target: after.target,
        endReason: after.endReason,
      },
    });
  }
  return events;
}
