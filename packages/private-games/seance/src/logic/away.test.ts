import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { seance } from './game.ts';
import { guide } from './guide.ts';
import {
  HOST,
  colorOf,
  guessAll,
  playHour,
  readyAll,
  readyOnly,
  sendAll,
  startedGame,
  toFinal,
} from './test-utils.ts';
import { AWAY_SECONDS, REVEAL_SECONDS } from './types.ts';

const AWAY_MS = AWAY_SECONDS * 1000;

describe('an away psychic', () => {
  it('is waited on for 3 minutes, then their seat counts as empty', () => {
    const h = startedGame(4);
    h.presence('ben', false);
    expect(h.psychic('ben').awaySince).toBe(h.now);
    expect(seance.nextDeadline!(h.state)).toBe(h.now + AWAY_MS);
    expect(seance.view(h.state, 'ana').game!.psychics.find((p) => p.id === 'ben')).toMatchObject({
      absent: false,
      awayUntil: h.now + AWAY_MS,
    });
    // Before the 3 minutes, the ghost must send ben a vision and he must be Ready.
    for (const id of ['ana', 'cy'])
      h.act({ type: 'send', to: colorOf(h, id), cards: [h.game().hand[0]!] }, HOST);
    expect(h.reject({ type: 'reveal' }, HOST)).toBe('not-yet');
    h.tick(AWAY_MS - 1);
    expect(h.psychic('ben').absent).toBeFalsy();
    h.tick(1);
    expect(h.psychic('ben').absent).toBe(true);
    expect(h.game().notices.at(-1)!.text).toMatch(/Ben has been away 3 minutes/);
    // No vision needed, not waited on for Ready, not judged.
    guessAll(h);
    readyOnly(h);
    h.act({ type: 'reveal' }, HOST);
    expect(h.game().verdicts.map((v) => v.color)).not.toContain(colorOf(h, 'ben'));
    expect(h.game().verdicts).toHaveLength(2);
    expect(h.psychic('ben').step).toBe(0);
    expect(seance.view(h.state, 'ana').game!.psychics.find((p) => p.id === 'ben')).toMatchObject({
      absent: true,
      awayUntil: null,
    });
  });

  it('starts the sand once only the empty seat lacks a vision', () => {
    const h = startedGame(4, { timerSeconds: 60 });
    h.presence('ben', false);
    for (const id of ['ana', 'cy'])
      h.act({ type: 'send', to: colorOf(h, id), cards: [h.game().hand[0]!] }, HOST);
    expect(h.game().deadline).toBeNull();
    h.tick(AWAY_MS);
    expect(h.game().deadline).toBe(h.now + 60_000);
  });

  it('comes back to their seat as it was', () => {
    const h = startedGame(4);
    playHour(h);
    const found = [...h.psychic('ben').found];
    expect(found).toHaveLength(1);
    h.presence('ben', false);
    h.tick(AWAY_MS);
    expect(h.psychic('ben').absent).toBe(true);
    h.presence('ben', true);
    expect(h.psychic('ben')).toMatchObject({ absent: false, awaySince: null, found, step: 1 });
    expect(h.game().notices.at(-1)!.text).toBe('Ben is back in their seat.');
    expect(seance.nextDeadline!(h.state)).toBeNull();
    // He is waited on again.
    sendAll(h);
    guessAll(h);
    readyOnly(h);
    h.act({ type: 'reveal' }, HOST);
    expect(
      h
        .game()
        .verdicts.filter((v) => v.hour === 2)
        .map((v) => v.color),
    ).toContain(colorOf(h, 'ben'));
  });

  it('back within the 3 minutes: nothing changes and the clock stops', () => {
    const h = startedGame(4);
    const before = h.state;
    h.presence('ben', false);
    h.tick(60_000);
    h.presence('ben', true);
    expect(h.psychic('ben')).toMatchObject({ awaySince: null, absent: false });
    expect(seance.nextDeadline!(h.state)).toBeNull();
    expect(h.game().notices).toEqual(before.game!.notices);
    // Coming back when never away changes nothing at all.
    expect(seance.playerPresence!(h.state, 'ben', true, h.now)).toBe(h.state);
  });

  it('keeps the first away time when told again (a room reloading after a restart)', () => {
    const h = startedGame(4);
    h.presence('ben', false);
    const since = h.now;
    h.tick(120_000);
    expect(seance.playerPresence!(h.state, 'ben', false, h.now)).toBe(h.state);
    h.tick(60_000);
    expect(h.psychic('ben')).toMatchObject({ awaySince: since, absent: true });
  });

  it('ignores the ghost, watchers and the lobby', () => {
    const h = startedGame(4);
    expect(seance.playerPresence!(h.state, HOST, false, h.now)).toBe(h.state);
    expect(seance.playerPresence!(h.state, 'nobody', false, h.now)).toBe(h.state);
    const lobby = startedGame(4);
    lobby.state = { ...lobby.state, phase: 'lobby', game: null };
    expect(seance.playerPresence!(lobby.state, 'ana', false, lobby.now)).toBe(lobby.state);
  });

  it('starts the away clock with the game for a psychic already offline', () => {
    const h = startedGame(4);
    const fresh = startedGame(4);
    fresh.state = { ...fresh.state, phase: 'lobby', game: null };
    const started = seance.reduce(
      fresh.state,
      { type: 'start' },
      {
        by: HOST,
        isHost: true,
        now: h.now,
        rng: createRng(1),
        content: { wordLists: () => [], words: () => [] },
        connected: (id) => id !== 'cy',
      },
    );
    if (!('game' in started)) throw new Error('start refused');
    expect(started.game!.psychics.find((p) => p.id === 'cy')!.awaySince).toBe(h.now);
    expect(started.game!.psychics.find((p) => p.id === 'ana')!.awaySince).toBeNull();
  });

  it('still away at hour VII: the clock runs out without them', () => {
    const h = startedGame(4);
    h.presence('ben', false);
    h.tick(AWAY_MS);
    // Hours run past while he is away (ana and cy keep guessing wrong).
    while (h.state.phase === 'playing') {
      sendAll(h);
      guessAll(h, []);
      readyAll(h);
      if (h.game().stage === 'reveal') h.act({ type: 'continue' }, HOST);
    }
    expect(h.game().result).toMatchObject({ how: 'clock' });
    expect(h.game().verdicts.filter((v) => v.color === colorOf(h, 'ben'))).toEqual([]);
    expect(h.psychic('ben').absent).toBe(true);
  });

  it('does not vote in the final while their seat counts as empty', () => {
    const h = startedGame(4);
    toFinal(h);
    // Everyone sees all three cards before voting, so the one stage waits on all three.
    h.state = {
      ...h.state,
      game: { ...h.game(), psychics: h.game().psychics.map((p) => ({ ...p, level: 9 })) },
    };
    h.presence('ben', false);
    h.act({ type: 'shared', group: 0, cards: h.game().hand.slice(0, 3) }, HOST);
    expect(h.game().final!.revealed).toBe(3);
    h.act({ type: 'vote', group: 0 }, 'ana');
    h.act({ type: 'vote', group: 0 }, 'cy');
    expect(h.game().stage).toBe('vote');
    h.tick(AWAY_MS);
    expect(h.game().stage).toBe('done');
    expect(h.game().result).toMatchObject({ win: true, how: 'culprit' });
    expect(h.game().result!.tally).toEqual([2, 0, 0]);
  });
});

describe('the verdicts', () => {
  it(`hold for ${REVEAL_SECONDS} seconds`, () => {
    expect(REVEAL_SECONDS).toBe(12);
    const h = startedGame(4);
    sendAll(h);
    guessAll(h);
    readyAll(h);
    expect(h.game().deadline).toBe(h.now + 12_000);
    h.tick(11_999);
    expect(h.game().stage).toBe('reveal');
    h.tick(1);
    expect(h.game().hour).toBe(2);
  });
});

describe('the guide', () => {
  const text = (title: string) => JSON.stringify(guide.sections.find((s) => s.title === title));

  it('states the 3 minutes for an away psychic', () => {
    expect(text('If someone drops out')).toMatch(/3 minutes/);
    expect(text('If someone drops out')).toMatch(/counts as empty/);
  });

  it('holds the verdicts for 12 seconds', () => {
    expect(text('An hour: the verdicts')).toMatch(/12 seconds/);
  });

  it('says the ghost chooses the culprit’s group', () => {
    expect(text('The final: the culprit')).toMatch(/The ghost chooses which one is the culprit’s/);
  });
});
