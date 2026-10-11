import { type InsightEvent, type PlayerId, sameClue } from '@vt/game-sdk';
import type { EchoAction, EchoState, ResolvedCard } from './types.ts';

/** Cards this change resolved (none when a game started). */
function newCards(before: EchoState, after: EchoState): ResolvedCard[] {
  if (after.gamesPlayed !== before.gamesPlayed) return [];
  return after.history.length > before.history.length
    ? after.history.slice(before.history.length)
    : [];
}

function cardEvent(card: ResolvedCard, auto: boolean): InsightEvent {
  const cancelled = card.clues.filter((c) => c.cancelled);
  const survivors = card.clues.filter((c) => !c.cancelled);
  return {
    type: 'card',
    playerId: card.guesser,
    words: [
      ...card.clues.map((c) => ({ kind: 'clue' as const, word: c.text })),
      ...cancelled.map((c) => ({ kind: 'cancelled' as const, word: c.text })),
      ...(card.guess === null ? [] : [{ kind: 'guess' as const, word: card.guess }]),
    ],
    props: {
      word: card.word,
      outcome: card.outcome,
      countedBy: card.countedBy,
      clueCount: card.clues.length,
      cancelledCount: cancelled.length,
      // For the night recap: whose clues survived (aligned with their words), and who wrote any.
      survivors: survivors.map((c) => c.by),
      survivorWords: survivors.map((c) => c.text),
      givers: [...new Set(card.clues.map((c) => c.by))],
      // Resolved by the timer rather than a player.
      auto,
    },
  };
}

/** One event per pair of players whose clues cancelled each other on this card. */
function matchEvents(card: ResolvedCard): InsightEvent[] {
  const groups: { word: string; by: Set<PlayerId> }[] = [];
  for (const clue of card.clues) {
    if (!clue.cancelled) continue;
    let group = groups.find((g) => sameClue(g.word, clue.text));
    if (!group) {
      group = { word: clue.text, by: new Set<PlayerId>() };
      groups.push(group);
    }
    group.by.add(clue.by);
  }
  const events: InsightEvent[] = [];
  for (const { word, by } of groups) {
    const ids = [...by].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        events.push({ type: 'match', props: { a: ids[i]!, b: ids[j]!, word } });
      }
    }
  }
  return events;
}

/**
 * Stats only: each resolved card with its clues, which players' clues cancelled each other, and
 * the final score. Echo is cooperative, so a finished game credits everyone still playing.
 */
export function insights(
  before: EchoState,
  after: EchoState,
  _action: EchoAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const events = newCards(before, after).flatMap((card) => [
    cardEvent(card, by === null),
    ...matchEvents(card),
  ]);
  if (before.phase !== 'over' && after.phase === 'over') {
    events.push({
      type: 'outcome',
      winners:
        after.endReason === 'finished'
          ? Object.entries(after.seats).flatMap(([id, s]) => (s.playing ? [id] : []))
          : [],
      props: {
        score: after.score,
        deckSize: after.settings.deckSize,
        endReason: after.endReason,
      },
    });
  }
  return events;
}
