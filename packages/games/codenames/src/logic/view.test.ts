import { describe, expect, it } from 'vitest';
import { codenames } from './game.ts';
import { HOST, NOW, OP, SPY, cardsOf, clue, startedGame } from './test-utils.ts';
import type { CodenamesState } from './types.ts';

const WATCHER = 'p5';

/**
 * The same table with the face-down cards' kinds moved round by `shift` places (the public
 * counts of agents left stay the same; only which word is which changes).
 */
function rekeyed(state: CodenamesState, shift: number): CodenamesState {
  const hidden = state.board.flatMap((c, i) => (c.revealed ? [] : [i]));
  const kinds = hidden.map((i) => state.board[i]!.kind);
  const board = state.board.map((c) => ({ ...c }));
  hidden.forEach((i, n) => {
    board[i]!.kind = kinds[(n + shift) % kinds.length]!;
  });
  return { ...state, board };
}

/** Viewers who must never learn the key: operatives, a watcher and a signed-out viewer. */
const blind = [OP.red, OP.blue, WATCHER, null];

/**
 * Checks the view for every viewer: operatives and watchers get byte-for-byte the same JSON
 * whatever the face-down cards are, so no field (board, log, turn…) can carry the key.
 */
function checkViews(state: CodenamesState) {
  for (const viewer of blind) {
    const seen = JSON.stringify(codenames.view(state, viewer));
    for (let shift = 1; shift < 25; shift++) {
      expect(JSON.stringify(codenames.view(rekeyed(state, shift), viewer)), `${viewer}`).toBe(seen);
    }
    for (const card of codenames.view(state, viewer).board) {
      if (!card.revealed) expect(card.kind).toBeNull();
    }
  }
  const spymasters = Object.entries(state.seats).filter(
    ([, s]) => s.team !== null && s.role === 'spymaster',
  );
  for (const [viewer] of spymasters) {
    const view = codenames.view(state, viewer);
    expect(view.board.map((c) => c.kind)).toEqual(state.board.map((c) => c.kind));
  }
}

function table() {
  const h = startedGame();
  h.state = codenames.playerJoined(h.state, { id: WATCHER, name: 'Watcher' });
  return h;
}

describe('view hides the key', () => {
  it('at every stage of a turn, for every viewer', () => {
    const h = table();
    checkViews(h.state); // clue stage
    clue(h, 'red', 2);
    checkViews(h.state); // guess stage
    h.act({ type: 'toggle-suggestion', card: cardsOf(h.state, 'red')[0]! }, OP.red);
    checkViews(h.state); // with a teammate's mark
    h.act({ type: 'guess', card: cardsOf(h.state, 'red')[0]! }, OP.red);
    checkViews(h.state); // after a right guess
    h.act({ type: 'guess', card: cardsOf(h.state, 'bystander')[0]! }, OP.red);
    checkViews(h.state); // after a wrong guess ended the turn
    clue(h, 'blue', 1);
    h.act({ type: 'guess', card: cardsOf(h.state, 'red')[0]! }, OP.blue);
    checkViews(h.state); // after a guess of the other team's agent
    h.act({ type: 'end-turn' }, HOST, { connected: [] });
    checkViews(h.state); // after a host skip
  });

  it('after a spymaster leaves and a timer ends a turn', () => {
    const h = startedGame({ clueSeconds: 30, guessSeconds: 30, timerMode: 'strict' });
    h.state = codenames.playerJoined(h.state, { id: WATCHER, name: 'Watcher' });
    h.state = codenames.onDeadline!(h.state, NOW + 31_000);
    checkViews(h.state);
    h.state = codenames.playerLeft(h.state, SPY.blue, NOW);
    checkViews(h.state);
  });

  it('shows everyone the whole key once the game is over', () => {
    const h = table();
    clue(h, 'red');
    h.act({ type: 'guess', card: cardsOf(h.state, 'assassin')[0]! }, OP.red);
    for (const viewer of [...blind, SPY.red, SPY.blue]) {
      const view = codenames.view(h.state, viewer);
      expect(view.board.map((c) => c.kind)).toEqual(h.state.board.map((c) => c.kind));
    }
  });
});
