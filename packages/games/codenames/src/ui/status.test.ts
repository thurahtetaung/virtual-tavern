import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { codenames } from '../logic/game.ts';
import {
  HOST,
  OP,
  SPY,
  cardsOf,
  clue,
  content,
  harness,
  startedGame,
} from '../logic/test-utils.ts';
import { guessesLeft, myRoleLabel, spymasterAlerts, startBlocker, statusFor } from './status.ts';

/** The room, with the given players offline. */
const room = (offline: string[] = []) => ({
  hostId: HOST,
  players: [HOST, 'p2', 'p3', 'p4'].map((id) => ({
    id,
    name: id.toUpperCase(),
    connected: !offline.includes(id),
  })),
});

describe('statusFor', () => {
  it('guides spectators in the lobby to pick a team', () => {
    const state = codenames.create({ now: 0, rng: createRng(1), content: content() }, [
      { id: 'x', name: 'X' },
    ]);
    const view = codenames.view(state, 'x');
    expect(statusFor(view, false, startBlocker(view, 30))).toMatchObject({ yourMove: true });
  });

  it('tells each role what to do during a turn', () => {
    const h = startedGame();
    expect(statusFor(codenames.view(h.state, SPY.red), false, null)).toMatchObject({
      yourMove: true,
    });
    expect(statusFor(codenames.view(h.state, OP.red), false, null).yourMove).toBe(false);
    clue(h, 'red', 2);
    const op = statusFor(codenames.view(h.state, OP.red), false, null);
    expect(op).toMatchObject({ yourMove: true });
    expect(op.text).toContain('3 guesses left');
    expect(statusFor(codenames.view(h.state, OP.blue), false, null).text).toContain(
      'Red team is guessing',
    );
  });
});

describe('statusFor names people', () => {
  it('names the host in waiting texts', () => {
    const h = startedGame();
    const lobby = { ...codenames.view(h.state, OP.red), phase: 'lobby' as const };
    expect(statusFor(lobby, false, null, room()).text).toBe(
      'All set. Waiting for HOST (host) to start the game…',
    );
  });

  it('names an offline Spymaster instead of "thinking…"', () => {
    const h = startedGame();
    const view = codenames.view(h.state, OP.red);
    expect(statusFor(view, false, null, room()).text).toContain('is thinking of a clue');
    expect(statusFor(view, false, null, room([SPY.red])).text).toBe(
      'HOST (Red Spymaster) seems to be offline. The host can skip their turn.',
    );
  });
});

describe('statusFor with someone offline', () => {
  it('names an offline Spymaster and offers the host a skip', () => {
    const h = startedGame();
    const forOp = statusFor(codenames.view(h.state, OP.red), false, null, room([SPY.red]));
    expect(forOp).toMatchObject({
      text: 'HOST (Red Spymaster) seems to be offline. The host can skip their turn.',
      stalled: true,
      yourMove: false,
    });
    const forHost = statusFor(codenames.view(h.state, OP.blue), true, null, room([SPY.red]));
    expect(forHost.text).toContain('You can skip their turn.');
  });

  it('names offline Operatives during the guess', () => {
    const h = startedGame();
    clue(h, 'red', 1);
    const s = statusFor(codenames.view(h.state, OP.blue), true, null, room([OP.red]));
    expect(s).toMatchObject({
      text: 'P2 (Red Operative) seems to be offline. You can skip their turn.',
      stalled: true,
    });
    expect(statusFor(codenames.view(h.state, OP.blue), true, null).stalled).toBeUndefined();
  });
});

describe('myRoleLabel', () => {
  it('names the viewer team and role, and nothing for spectators', () => {
    const h = startedGame();
    expect(myRoleLabel(codenames.view(h.state, OP.blue))).toBe('Blue Operative');
    expect(myRoleLabel(codenames.view(h.state, SPY.red))).toBe('Red Spymaster');
    expect(myRoleLabel(codenames.view(h.state, null))).toBeNull();
  });
});

describe('guessesLeft', () => {
  it('counts down from the clue number plus one', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    expect(guessesLeft(codenames.view(h.state, null))).toBe(3);
    h.act({ type: 'guess', card: cardsOf(h.state, 'red')[0]! }, OP.red);
    expect(guessesLeft(codenames.view(h.state, null))).toBe(2);
  });
});

describe('startBlocker', () => {
  it('explains missing seats and words', () => {
    const h = startedGame();
    const view = codenames.view(h.state, null);
    expect(startBlocker(view, 30)).toBeNull();
    expect(startBlocker(view, 10)).toContain('25 are needed');
    expect(startBlocker({ ...view, seats: [] }, 30)).toBe('Red needs a Spymaster.');
  });
});

describe('spymasterAlerts', () => {
  it('says nothing while both teams have a Spymaster', () => {
    const h = startedGame();
    expect(spymasterAlerts(codenames.view(h.state, OP.red))).toEqual([]);
  });

  it('tells the team without a Spymaster why its turns are skipped, and offers the seat', () => {
    const h = startedGame();
    h.state = codenames.playerLeft(h.state, SPY.blue, 0);
    const mine = spymasterAlerts(codenames.view(h.state, OP.blue));
    expect(mine).toEqual([
      {
        team: 'blue',
        mine: true,
        canTake: true,
        text: 'Your team has no Spymaster, so your turns are skipped. Take the seat?',
      },
    ]);
    // The other team is told too, so the table knows why Blue never plays; it can't take it.
    const other = spymasterAlerts(codenames.view(h.state, OP.red));
    expect(other).toMatchObject([{ team: 'blue', mine: false, canTake: false }]);
    expect(other[0]!.text).toBe(
      "Blue has no Spymaster, so Blue's turns are skipped. One of them can take the seat.",
    );
    // A newcomer who never saw the key may sit down in the empty seat.
    h.state = codenames.playerJoined(h.state, { id: 'new', name: 'NEW' });
    expect(spymasterAlerts(codenames.view(h.state, 'new'))).toMatchObject([
      { team: 'blue', canTake: true },
    ]);
    // Once someone takes it, the alert is gone.
    h.act({ type: 'join-team', team: 'blue', role: 'spymaster' }, OP.blue);
    expect(spymasterAlerts(codenames.view(h.state, OP.red))).toEqual([]);
  });

  it('never alerts in the lobby', () => {
    const h = harness();
    expect(spymasterAlerts(codenames.view(h.state, HOST))).toEqual([]);
  });
});
