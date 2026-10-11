import { describe, expect, it } from 'vitest';
import { LOCATIONS } from '../content/locations.ts';
import { GENERIC_QUESTIONS } from '../content/questions.ts';
import { namedBy, scoreRound } from './game.ts';
import { masquerade } from './index.ts';
import {
  FOUR,
  HOST,
  NOW,
  SEVEN,
  allReady,
  deadline,
  harness,
  leave,
  rig,
  round,
  startedGame,
  twoEditions,
  votes,
} from './test-utils.ts';
import { GUESS_SECONDS, VOTE_SECONDS } from './types.ts';

/** A view as JSON, without the public Locations board (which lists every location). */
const secretJson = (v: object) => JSON.stringify({ ...v, locations: [] });

/** A four-player round: Cy is the spy at the swimming pool. */
function table(ids = FOUR) {
  return rig(startedGame(ids), { spies: ['cy'], location: 'swimming-pool' });
}

describe('content', () => {
  it('ships about 30 locations, each with an emoji, a tip and 6 to 8 questions', () => {
    expect(LOCATIONS.length).toBe(30);
    expect(new Set(LOCATIONS.map((l) => l.id)).size).toBe(30);
    for (const l of LOCATIONS) {
      expect(l.emoji).toBeTruthy();
      expect(l.tip.length).toBeGreaterThan(10);
      expect(l.questions.length).toBeGreaterThanOrEqual(6);
      expect(l.questions.length).toBeLessThanOrEqual(8);
    }
    expect(GENERIC_QUESTIONS.map((c) => c.id)).toEqual([
      'senses',
      'people',
      'clothing',
      'time',
      'money',
      'mood',
    ]);
    expect(GENERIC_QUESTIONS.flatMap((c) => c.questions).length).toBeGreaterThanOrEqual(60);
  });
});

describe('dealing', () => {
  it('deals one spy, one location for everyone else, and a 5-minute clock', () => {
    const h = startedGame();
    const r = round(h);
    expect(h.state.phase).toBe('playing');
    expect(r.players).toEqual(FOUR);
    expect(r.spies).toHaveLength(1);
    expect(FOUR).toContain(r.starter);
    expect(LOCATIONS.map((l) => l.id)).toContain(r.location);
    expect(r.stage).toBe('talk');
    expect(r.deadline).toBe(NOW + 300_000);
    expect(h.state.totalRounds).toBe(4);
  });

  it('needs three players', () => {
    const h = harness([HOST, 'ana']);
    expect(h.reject({ type: 'start' })).toBe('too-few');
    expect(h.reject({ type: 'start' }, 'ana')).toBe('not-host');
  });

  it('deals two spies only with the option on and 7 or more players', () => {
    expect(round(startedGame(SEVEN, { twoSpies: true })).spies).toHaveLength(2);
    expect(round(startedGame(SEVEN)).spies).toHaveLength(1);
    expect(round(startedGame(SEVEN.slice(0, 6), { twoSpies: true })).spies).toHaveLength(1);
  });

  it('rotates who starts and doesn’t repeat locations', () => {
    const h = startedGame();
    const starters = [round(h).starter];
    const places = [round(h).location];
    for (let i = 0; i < 3; i++) {
      allReady(h);
      deadline(h);
      h.act({ type: 'next-round' });
      starters.push(round(h).starter);
      places.push(round(h).location);
    }
    expect(new Set(starters).size).toBe(4);
    expect(new Set(places).size).toBe(4);
  });

  it('applies settings and checks editions', () => {
    const h = harness(FOUR, 7, twoEditions);
    expect(h.state.settings.editions).toEqual(['e1', 'e2']);
    h.act({ type: 'update-settings', editions: ['e2'], roundSeconds: 240, rounds: 2 });
    expect(h.reject({ type: 'update-settings', editions: ['nope'] })).toBe('bad-edition');
    expect(h.def.view(h.state, HOST).locations).toEqual(['x', 'y']);
    h.act({ type: 'start' });
    expect(['x', 'y']).toContain(round(h).location);
    expect(round(h).deadline).toBe(NOW + 240_000);
    expect(h.state.totalRounds).toBe(2);
    expect(h.reject({ type: 'update-settings', rounds: 3 })).toBe('in-progress');
  });
});

describe('what each player sees', () => {
  it('shows the location only to locals and the spy to nobody', () => {
    const h = table();
    h.state = masquerade.playerJoined(h.state, { id: 'late', name: 'Late' });
    for (const viewer of [...FOUR, 'late', null]) {
      const v = masquerade.view(h.state, viewer);
      const json = secretJson(v);
      expect(json).not.toContain('"spies"');
      expect(json).not.toContain('seed');
      expect(json).not.toContain('"cy"]');
      if (viewer === 'cy') {
        expect(v.round!.role).toBe('spy');
        expect(v.round!.location).toBeNull();
        expect(json).not.toContain('"swimming-pool"');
      } else if (viewer === null || viewer === 'late') {
        expect(v.round!.role).toBe('watching');
        expect(json).not.toContain('"swimming-pool"');
      } else {
        expect(v.round!.role).toBe('local');
        expect(v.round!.location).toBe('swimming-pool');
      }
    }
  });

  it('keeps votes secret until the vote resolves, showing only the count', () => {
    const h = table();
    allReady(h);
    votes(h, { host: 'cy', ana: 'cy' });
    for (const viewer of [...FOUR, null]) {
      const v = masquerade.view(h.state, viewer);
      const json = secretJson(v);
      expect(v.round!.votedCount).toBe(2);
      // Who has voted is public (so the table can name the holdouts); whom they chose is not.
      expect(v.round!.votedIds).toEqual(['host', 'ana']);
      expect(v.round!.votes).toBeNull();
      expect(v.round!.myVote).toBe(viewer === 'host' || viewer === 'ana' ? 'cy' : null);
      // Nobody's vote but your own appears anywhere.
      expect(json).not.toMatch(/"(host|ana|ben|cy)":"cy"/);
      if (viewer !== 'host' && viewer !== 'ana') expect(json).not.toContain('"myVote":"cy"');
      expect(JSON.stringify(v.round!.votedIds)).not.toContain('cy');
    }
    votes(h, { ben: 'cy', cy: 'ana' });
    const v = masquerade.view(h.state, 'ben');
    expect(v.round!.votes).toEqual({ host: 'cy', ana: 'cy', ben: 'cy', cy: 'ana' });
    expect(v.round!.caught).toEqual(['cy']);
    expect(v.round!.location).toBe('swimming-pool');
    expect(masquerade.view(h.state, 'cy').round!.location).toBeNull();
    expect(masquerade.view(h.state, 'cy').round!.canGuess).toBe(true);
  });

  it('reveals everything at the end of the round', () => {
    const h = table();
    allReady(h);
    votes(h, { host: 'ana', ana: 'ben', ben: 'ana', cy: 'ana' });
    const v = masquerade.view(h.state, 'cy');
    expect(v.round!.stage).toBe('reveal');
    expect(v.round!.result).toMatchObject({
      location: 'swimming-pool',
      spies: ['cy'],
      named: ['ana'],
    });
  });
});

describe('the vote', () => {
  it('starts when the clock runs out, or once everyone is ready', () => {
    const h = table();
    h.act({ type: 'ready-to-vote', ready: true }, 'ana');
    h.act({ type: 'ready-to-vote', ready: true }, 'ben');
    h.act({ type: 'ready-to-vote', ready: false }, 'ben');
    expect(masquerade.view(h.state, HOST).round!.readyCount).toBe(1);
    expect(masquerade.view(h.state, 'cy').round!.readyIds).toEqual(['ana']);
    expect(round(h).stage).toBe('talk');
    expect(h.reject({ type: 'vote', target: 'cy' })).toBe('wrong-stage');
    allReady(h);
    expect(round(h).stage).toBe('vote');
    expect(round(h).deadline).toBe(NOW + VOTE_SECONDS * 1000);

    const t = table();
    deadline(t);
    expect(round(t).stage).toBe('vote');
  });

  it('refuses self-votes and strangers, and lets you change your vote', () => {
    const h = allReady(table());
    expect(h.reject({ type: 'vote', target: HOST })).toBe('self-vote');
    expect(h.reject({ type: 'vote', target: 'nobody' })).toBe('bad-target');
    h.act({ type: 'vote', target: 'ana' });
    h.act({ type: 'vote', target: 'cy' });
    expect(round(h).votes).toEqual({ host: 'cy' });
  });

  it('catches the spy only when they alone have the most votes', () => {
    expect(namedBy({ a: 'c', b: 'c', c: 'a' }, ['a', 'b', 'c'], 1)).toEqual(['c']);
    expect(namedBy({ a: 'c', b: 'a' }, ['a', 'b', 'c'], 1)).toEqual([]);
    expect(namedBy({}, ['a', 'b', 'c'], 1)).toEqual([]);
  });

  it('names the top two with two spies, settling ties as the guide says', () => {
    const p = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    // 3-2-1: the top two.
    expect(namedBy({ a: 'b', c: 'b', d: 'b', e: 'c', f: 'c', g: 'd' }, p, 2)).toEqual(['b', 'c']);
    // 3-3-1: both leaders.
    expect(namedBy({ a: 'b', c: 'b', d: 'b', e: 'c', f: 'c', g: 'c', b: 'd' }, p, 2)).toEqual([
      'b',
      'c',
    ]);
    // 3-2-2: only the leader.
    expect(namedBy({ a: 'b', c: 'b', d: 'b', e: 'c', f: 'c', g: 'd', b: 'd' }, p, 2)).toEqual([
      'b',
    ]);
    // 2-2-2: nobody.
    expect(namedBy({ a: 'b', c: 'b', d: 'c', e: 'c', f: 'd', g: 'd' }, p, 2)).toEqual([]);
  });

  it('lets the strict timer resolve the vote, with non-voters abstaining', () => {
    const h = allReady(table());
    votes(h, { host: 'cy', ana: 'cy' });
    deadline(h);
    expect(round(h).stage).toBe('guess');
    expect(round(h).caught).toEqual(['cy']);
    expect(round(h).deadline).toBe(NOW + VOTE_SECONDS * 1000 + GUESS_SECONDS * 1000);
  });

  it('lets the spy escape on a tie at the top', () => {
    const h = allReady(table());
    votes(h, { host: 'cy', ana: 'ben', ben: 'cy', cy: 'ben' });
    expect(round(h).stage).toBe('reveal');
    expect(round(h).result!.spyResults).toEqual([{ id: 'cy', outcome: 'escaped', guess: null }]);
    expect(round(h).result!.points).toEqual({ host: 0, ana: 0, ben: 0, cy: 2 });
    expect(h.state.seats.cy!.score).toBe(2);
  });
});

describe('the caught spy’s guess', () => {
  it('is refused during the round and from anyone but the caught spy', () => {
    const h = table();
    expect(h.reject({ type: 'spy-guess', location: 'bakery' }, 'cy')).toBe('no-guess');
    allReady(h);
    expect(h.reject({ type: 'spy-guess', location: 'bakery' }, 'cy')).toBe('no-guess');
    votes(h, { host: 'cy', ana: 'cy', ben: 'cy', cy: 'ana' });
    expect(round(h).stage).toBe('guess');
    expect(h.reject({ type: 'spy-guess', location: 'bakery' }, 'ana')).toBe('no-guess');
    expect(h.reject({ type: 'spy-guess', location: 'moon' }, 'cy')).toBe('bad-location');
  });

  it('steals the round with a right guess', () => {
    const h = allReady(table());
    votes(h, { host: 'cy', ana: 'cy', ben: 'cy', cy: 'ana' });
    h.act({ type: 'spy-guess', location: 'swimming-pool' }, 'cy');
    expect(round(h).stage).toBe('reveal');
    expect(round(h).result!.spyResults).toEqual([
      { id: 'cy', outcome: 'stole', guess: 'swimming-pool' },
    ]);
    expect(round(h).result!.points).toEqual({ host: 0, ana: 0, ben: 0, cy: 2 });
    expect(h.reject({ type: 'spy-guess', location: 'bakery' }, 'cy')).toBe('no-guess');
  });

  it('gives the locals the round on a wrong guess, with a bonus for those who voted right', () => {
    const g = allReady(table());
    votes(g, { host: 'cy', ana: 'cy', ben: 'ana', cy: 'ben' });
    g.act({ type: 'spy-guess', location: 'bakery' }, 'cy');
    expect(round(g).result!.spyResults).toEqual([{ id: 'cy', outcome: 'caught', guess: 'bakery' }]);
    expect(round(g).result!.points).toEqual({ host: 2, ana: 2, ben: 1, cy: 0 });
  });

  it('counts no guess in time as wrong', () => {
    const h = allReady(table());
    votes(h, { host: 'cy', ana: 'cy', ben: 'cy', cy: 'ana' });
    deadline(h);
    expect(round(h).result!.spyResults).toEqual([{ id: 'cy', outcome: 'caught', guess: null }]);
    expect(round(h).result!.points).toEqual({ host: 2, ana: 2, ben: 2, cy: 0 });
  });
});

describe('two spies', () => {
  it('scores each spy on their own', () => {
    expect(
      scoreRound({
        players: ['a', 'b', 'c', 'd'],
        spies: ['c', 'd'],
        caught: ['c'],
        guesses: { c: 'wrong' },
        votes: { a: 'c', b: 'd', c: 'a', d: 'c' },
        location: 'here',
      }),
    ).toEqual({
      points: { a: 2, b: 1, c: 0, d: 2 },
      spyResults: [
        { id: 'c', outcome: 'caught', guess: 'wrong' },
        { id: 'd', outcome: 'escaped', guess: null },
      ],
    });
  });

  it('waits for every caught spy to guess', () => {
    const h = rig(startedGame(SEVEN, { twoSpies: true }), {
      spies: ['eve', 'fin'],
      location: 'bakery',
    });
    allReady(h);
    votes(h, {
      host: 'eve',
      ana: 'eve',
      ben: 'eve',
      cy: 'fin',
      dee: 'fin',
      eve: 'fin',
      fin: 'host',
    });
    expect(round(h).caught).toEqual(['eve', 'fin']);
    // A caught spy sees the other caught spy now, but never the location.
    const eve = masquerade.view(h.state, 'eve');
    expect(eve.round!.caught).toEqual(['eve', 'fin']);
    expect(secretJson(eve)).not.toContain('"bakery"');
    h.act({ type: 'spy-guess', location: 'bakery' }, 'eve');
    expect(round(h).stage).toBe('guess');
    h.act({ type: 'spy-guess', location: 'gym' }, 'fin');
    expect(round(h).result!.spyResults.map((s) => s.outcome)).toEqual(['stole', 'caught']);
    // Locals: +1 for fin's miss, +1 more for those who voted for fin.
    expect(round(h).result!.points).toEqual({
      host: 1,
      ana: 1,
      ben: 1,
      cy: 2,
      dee: 2,
      eve: 2,
      fin: 0,
    });
  });
});

describe('a whole game', () => {
  it('ends after the set rounds with the top scorers winning', () => {
    const h = startedGame(FOUR, { rounds: 2 });
    rig(h, { spies: ['cy'] });
    allReady(h);
    votes(h, { host: 'ana', ana: 'ben', ben: 'ana', cy: 'ana' });
    expect(h.state.phase).toBe('playing');
    h.act({ type: 'next-round' });
    expect(round(h).number).toBe(2);
    rig(h, { spies: ['cy'] });
    allReady(h);
    votes(h, { host: 'ana', ana: 'ben', ben: 'ana', cy: 'ana' });
    expect(h.state.phase).toBe('over');
    expect(h.state.winners).toEqual(['cy']);
    expect(h.reject({ type: 'next-round' })).toBe('wrong-stage');
    h.act({ type: 'start' });
    expect(h.state.seats.cy!.score).toBe(0);
  });

  it('only lets the host move on, and only after the reveal', () => {
    const h = table();
    expect(h.reject({ type: 'next-round' })).toBe('wrong-stage');
    allReady(h);
    votes(h, { host: 'ana', ana: 'ben', ben: 'ana', cy: 'ana' });
    expect(h.reject({ type: 'next-round' }, 'ana')).toBe('not-host');
    h.act({ type: 'back-to-lobby' });
    expect(h.state.phase).toBe('lobby');
  });
});

describe('leavers and late joiners', () => {
  it('redeals the round when the spy leaves', () => {
    const h = table([...FOUR, 'dee']);
    const deal = round(h).deal;
    leave(h, 'cy');
    expect(round(h).number).toBe(1);
    expect(round(h).deal).toBe(deal + 1);
    expect(round(h).players).toEqual([HOST, 'ana', 'ben', 'dee']);
    expect(round(h).redealtAfter).toBe('CY');
    expect(round(h).stage).toBe('talk');
  });

  it('drops a local, their vote and the votes for them', () => {
    const h = allReady(table([...FOUR, 'dee']));
    votes(h, { host: 'dee', ana: 'cy', dee: 'cy' });
    leave(h, 'dee');
    expect(round(h).players).toEqual(FOUR);
    expect(round(h).votes).toEqual({ ana: 'cy' });
    votes(h, { host: 'cy', ben: 'cy' });
    expect(round(h).stage).toBe('vote');
    votes(h, { cy: 'ana' });
    expect(round(h).stage).toBe('guess');
  });

  it('starts the vote if the leaver was the last one not ready', () => {
    const h = table([...FOUR, 'dee']);
    for (const p of FOUR) h.act({ type: 'ready-to-vote', ready: true }, p);
    leave(h, 'dee');
    expect(round(h).stage).toBe('vote');
  });

  it('goes back to the lobby under three players', () => {
    const h = table();
    leave(h, 'ben');
    expect(h.state.phase).toBe('playing');
    leave(h, 'ana');
    expect(h.state.phase).toBe('lobby');
    expect(h.state.notice).toBe('too-few');
    expect(masquerade.view(h.state, HOST).notice).toBe('too-few');
  });

  it('lets late joiners watch until the next round', () => {
    const h = table();
    h.state = masquerade.playerJoined(h.state, { id: 'late', name: 'Late' });
    expect(h.state.seats.late!.playing).toBe(true);
    expect(round(h).players).not.toContain('late');
    expect(h.reject({ type: 'ready-to-vote', ready: true }, 'late')).toBe('watching');
    allReady(h);
    deadline(h);
    h.act({ type: 'next-round' });
    expect(round(h).players).toContain('late');
  });
});
