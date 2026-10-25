import { recapEventOf } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { CARD_SETS, PILLARS, poolOf } from './cards.ts';
import { seance, voteStage } from './game.ts';
import { insights } from './insights.ts';
import { levelThresholds, startProblem, tableCards, voteStageOf } from './setup.ts';
import {
  HOST,
  type Harness,
  colorOf,
  guessAll,
  harness,
  playHour,
  readyAll,
  readyOnly,
  sendAll,
  startedGame,
  toFinal,
} from './test-utils.ts';
import { HAND_SIZE, type SeanceState } from './types.ts';

describe('card sets', () => {
  it('cover every card exactly once', () => {
    for (const kind of ['vision', 'suspect', 'place', 'object'] as const) {
      const all = Object.values(CARD_SETS).flatMap((s) => [...s[kind]]);
      expect(new Set(all).size).toBe(all.length);
      expect(Math.min(...all)).toBe(1);
      expect(Math.max(...all)).toBe(all.length);
    }
    expect(poolOf(['base', 'exp1', 'exp2', 'promo'], 'vision')).toHaveLength(173);
    expect(poolOf(['exp1'], 'object')).toEqual([19, 20, 21, 22, 23, 24]);
  });
});

describe('the lobby', () => {
  it('needs the ghost and two psychics, and enough cards in the chosen sets', () => {
    const h = harness(2);
    expect(startProblem(h.state.settings, seatsOf(h.state))).toMatch(/3 players are needed/);
    const seven = harness(7);
    seven.act({ type: 'update-settings', difficulty: 'hard', sets: ['exp1'] });
    expect(startProblem(seven.state.settings, seatsOf(seven.state))).toMatch(/too few suspect/);
    seven.act({ type: 'update-settings', sets: ['base'] });
    expect(startProblem(seven.state.settings, seatsOf(seven.state))).toBeNull();
    expect(seven.reject({ type: 'update-settings', difficulty: 'easy' }, 'ana')).toBe('not-host');
  });

  it('keeps psychic colours unique and gives the free ones to the rest', () => {
    const h = harness(4);
    h.act({ type: 'pick-color', color: 'purple' }, 'ana');
    expect(h.reject({ type: 'pick-color', color: 'purple' }, 'ben')).toBe('taken');
    h.act({ type: 'update-settings', ghostMode: 'host', ghostPick: HOST });
    h.act({ type: 'start' });
    expect(h.game().psychics.map((p) => [p.id, p.color])).toEqual([
      ['ana', 'purple'],
      ['ben', 'blue'],
      ['cy', 'white'],
    ]);
  });

  it('picks a volunteer as the ghost in the volunteers mode', () => {
    const h = harness(4);
    h.act({ type: 'update-settings', ghostMode: 'volunteers' });
    expect(h.reject({ type: 'start' })).toBe('cannot-start');
    h.act({ type: 'volunteer', on: true }, 'cy');
    h.act({ type: 'start' });
    expect(h.game().ghost).toBe('cy');
  });
});

describe('the deal', () => {
  it.each([
    ['easy', 3, 5],
    ['easy', 7, 7],
    ['medium', 5, 7],
    ['hard', 6, 9],
  ] as const)('%s with %i players lays %i cards per kind', (difficulty, players, n) => {
    expect(tableCards(difficulty, players)).toBe(n);
    const h = startedGame(players, { difficulty });
    const g = h.game();
    for (const [i, pillar] of PILLARS.entries()) {
      expect(g.table[pillar]).toHaveLength(n);
      const targets = g.psychics.map((p) => p.targets[i]!);
      expect(new Set(targets).size).toBe(targets.length);
      for (const t of targets) expect(g.table[pillar]).toContain(t);
    }
    expect(g.hand).toHaveLength(HAND_SIZE);
    expect(g.psychics).toHaveLength(players - 1);
    expect(g.tokensEach).toBe(players <= 3 ? 0 : players <= 5 ? 4 : 6);
  });
});

describe('an hour', () => {
  it('sends one vision per psychic per hour, from the hand, and refills it', () => {
    const h = startedGame(4);
    const ana = colorOf(h, 'ana');
    const [a, b] = h.game().hand;
    expect(h.reject({ type: 'send', to: ana, cards: [999 % 173] }, HOST)).toBe('not-in-hand');
    expect(h.reject({ type: 'send', to: ana, cards: [a!] }, 'ana')).toBe('not-ghost');
    h.act({ type: 'send', to: ana, cards: [a!, b!] }, HOST);
    expect(h.game().hand).toHaveLength(HAND_SIZE);
    expect(h.game().hand).not.toContain(a);
    expect(h.psychic('ana').visions.map((v) => v.card)).toEqual([a, b]);
    expect(h.reject({ type: 'send', to: ana, cards: [h.game().hand[0]!] }, HOST)).toBe(
      'already-sent',
    );
  });

  it('starts the timer once every vision is out; the ghost reveals once everyone is ready', () => {
    const h = startedGame(4);
    sendAll(h);
    expect(h.game().deadline).toBe(h.now + 120_000);
    guessAll(h);
    readyOnly(h);
    // Everyone is Ready, but nothing is judged until the ghost reveals.
    expect(h.game().stage).toBe('visions');
    expect(seance.view(h.state, 'ana').game!.canReveal).toBe(true);
    expect(h.reject({ type: 'reveal' }, 'ana')).toBe('not-ghost');
    h.act({ type: 'reveal' }, HOST);
    expect(h.game().stage).toBe('reveal');
    expect(h.game().lockedHow).toBe('ghost');
    expect(h.game().notices.at(-1)!.text).toBe('👻 The ghost revealed the verdicts.');
    expect(h.game().psychics.every((p) => p.step === 1)).toBe(true);
    expect(h.game().verdicts).toHaveLength(3);
  });

  it('refuses the reveal until every vision is out and every psychic still searching is Ready', () => {
    const h = startedGame(4);
    expect(h.reject({ type: 'reveal' }, HOST)).toBe('not-yet');
    guessAll(h);
    h.act({ type: 'send', to: colorOf(h, 'ana'), cards: [h.game().hand[0]!] }, HOST);
    h.act({ type: 'ready', on: true }, 'ana');
    expect(h.reject({ type: 'reveal' }, HOST)).toBe('not-yet');
    sendAll(h);
    guessAll(h);
    h.act({ type: 'ready', on: true }, 'ana');
    h.act({ type: 'ready', on: true }, 'ben');
    expect(h.reject({ type: 'reveal' }, HOST)).toBe('not-ready');
    expect(seance.view(h.state, 'ana').game!.canReveal).toBe(false);
  });

  it('lets a psychic change their mind after everyone was Ready, which holds the reveal', () => {
    const h = startedGame(4);
    sendAll(h);
    guessAll(h);
    readyOnly(h);
    // Ben moves his guess: he is no longer Ready, so the ghost has to wait.
    const other = h.game().table.suspect.find((c) => c !== h.psychic('ben').intuition)!;
    h.act({ type: 'intuition', card: other }, 'ben');
    expect(h.psychic('ben').ready).toBe(false);
    expect(h.reject({ type: 'reveal' }, HOST)).toBe('not-ready');
    // Ana takes her Ready back too, then both are Ready again.
    h.act({ type: 'ready', on: false }, 'ana');
    expect(h.game().stage).toBe('visions');
    h.act({ type: 'ready', on: true }, 'ana');
    h.act({ type: 'ready', on: true }, 'ben');
    expect(h.game().stage).toBe('visions');
    h.act({ type: 'reveal' }, HOST);
    expect(h.game().verdicts.find((v) => v.color === colorOf(h, 'ben'))!.guess).toBe(other);
  });

  it('the host still locks the guesses in without the ghost', () => {
    const h = startedGame(4);
    sendAll(h);
    guessAll(h);
    // The ghost's seat empties (the host keeps hosting): nobody can reveal, the host locks.
    h.state = seance.playerLeft(h.state, HOST, h.now);
    expect(h.game().ghost).toBeNull();
    h.act({ type: 'lock-now' }, HOST);
    expect(h.game().stage).toBe('reveal');
    expect(h.game().lockedHow).toBe('host');
  });

  it('refuses Ready without a guess, and a new vision clears Ready', () => {
    const h = startedGame(4);
    expect(h.reject({ type: 'ready', on: true }, 'ana')).toBe('no-intuition');
    const pillar = 'suspect';
    h.act({ type: 'intuition', card: h.game().table[pillar][0]! }, 'ana');
    h.act({ type: 'ready', on: true }, 'ana');
    h.act({ type: 'send', to: colorOf(h, 'ana'), cards: [h.game().hand[0]!] }, HOST);
    expect(h.psychic('ana').ready).toBe(false);
  });

  it('only accepts a guess among the table cards of the current pillar', () => {
    const h = startedGame(4);
    const placeCard = h.game().table.place.find((c) => !h.game().table.suspect.includes(c))!;
    expect(h.reject({ type: 'intuition', card: placeCard }, 'ana')).toBe('not-on-table');
  });

  it('strict mode locks at 0:00 (no guess counts as wrong); soft mode only reminds', () => {
    const strict = startedGame(4, { timerMode: 'strict', timerSeconds: 60 });
    sendAll(strict);
    guessAll(strict, ['ana']);
    strict.act({ type: 'intuition', card: null }, 'ben');
    strict.tick(60_000);
    expect(strict.game().stage).toBe('reveal');
    expect(strict.game().verdicts.map((v) => v.correct)).toEqual([true, false, false]);
    expect(strict.game().notices.at(-1)!.text).toMatch(/Time ran out: guesses were locked in \(1/);
    expect(strict.game().lockedHow).toBe('timer');

    const soft = startedGame(4);
    sendAll(soft);
    soft.tick(200_000);
    expect(soft.game().stage).toBe('visions');
    expect(soft.reject({ type: 'lock-now' }, 'ana')).toBe('not-host');
    soft.act({ type: 'lock-now' }, HOST);
    expect(soft.game().stage).toBe('reveal');
  });

  it('wrong guesses keep their visions; right ones discard them and move on', () => {
    const h = startedGame(4);
    sendAll(h);
    guessAll(h, ['ana']);
    readyAll(h);
    expect(h.psychic('ana').visions).toEqual([]);
    expect(h.psychic('ana').found).toHaveLength(1);
    expect(h.game().table.suspect).not.toContain(h.psychic('ana').found[0]);
    expect(h.psychic('ben').visions).toHaveLength(1);
    expect(h.psychic('ben').step).toBe(0);
    h.act({ type: 'continue' }, HOST);
    expect(h.game().hour).toBe(2);
    expect(h.game().stage).toBe('visions');
  });

  it('moves on by itself after the verdicts are shown', () => {
    const h = startedGame(4);
    sendAll(h);
    guessAll(h);
    readyAll(h);
    expect(h.reject({ type: 'continue' }, 'ana')).toBe('not-host');
    h.tick(8_000);
    expect(h.game().stage).toBe('reveal');
    h.tick(4_000);
    expect(h.game().hour).toBe(2);
  });

  it('loses when the clock runs out', () => {
    const h = startedGame(4);
    for (let i = 0; i < 7; i++) playHour(h, []);
    expect(h.state.phase).toBe('over');
    expect(h.game().result).toMatchObject({ win: false, how: 'clock', winners: [] });
  });
});

describe('ravens', () => {
  it('Easy: once per hour', () => {
    const h = startedGame(4);
    h.act({ type: 'raven', cards: h.game().hand.slice(0, 3) }, HOST);
    expect(h.game().hand).toHaveLength(HAND_SIZE);
    expect(h.reject({ type: 'raven', cards: [h.game().hand[0]!] }, HOST)).toBe('no-ravens');
    playHour(h);
    h.act({ type: 'raven', cards: [h.game().hand[0]!] }, HOST);
  });

  it('Medium: three a game; Hard: one', () => {
    const m = startedGame(4, { difficulty: 'medium' });
    for (let i = 0; i < 3; i++) m.act({ type: 'raven', cards: [m.game().hand[0]!] }, HOST);
    expect(m.reject({ type: 'raven', cards: [m.game().hand[0]!] }, HOST)).toBe('no-ravens');
    const hard = startedGame(4, { difficulty: 'hard' });
    hard.act({ type: 'raven', cards: [hard.game().hand[0]!] }, HOST);
    playHour(hard);
    expect(hard.reject({ type: 'raven', cards: [hard.game().hand[0]!] }, HOST)).toBe('no-ravens');
  });
});

describe('clairvoyance', () => {
  it('scores ✓ on right guesses and ✗ on wrong ones; tokens are spent until hour IV', () => {
    const h = startedGame(5);
    sendAll(h);
    guessAll(h, ['ana', 'ben']);
    const [ana, ben, cy, dee] = ['ana', 'ben', 'cy', 'dee'].map((id) => colorOf(h, id));
    expect(h.reject({ type: 'mark', target: ana!, kind: 'yes' }, 'ana')).toBe('own');
    h.act({ type: 'mark', target: ana!, kind: 'yes' }, 'ben'); // right
    h.act({ type: 'mark', target: cy!, kind: 'yes' }, 'ben'); // wrong
    h.act({ type: 'mark', target: cy!, kind: 'no' }, 'dee'); // right
    h.act({ type: 'mark', target: ben!, kind: 'no' }, 'dee'); // wrong
    h.act({ type: 'mark', target: dee!, kind: 'no' }, 'ana');
    h.act({ type: 'mark', target: dee!, kind: null }, 'ana'); // taken back
    expect(h.psychic('ana').tokens).toBe(4);
    expect(h.psychic('ben').tokens).toBe(2);
    readyAll(h);
    expect(h.psychic('ben').level).toBe(1);
    expect(h.psychic('dee').level).toBe(1);
    expect(h.psychic('ana').level).toBe(0);
    h.act({ type: 'continue' }, HOST);
    expect(h.psychic('ben').tokens).toBe(2);
    playHour(h, []);
    playHour(h, []);
    expect(h.game().hour).toBe(4);
    expect(h.psychic('ben').tokens).toBe(4);
  });

  it('a psychic who finds all three gains a level per hour left', () => {
    const h = startedGame(4);
    playHour(h);
    playHour(h);
    sendAll(h);
    guessAll(h);
    readyAll(h);
    // Found in hour III: four hours were left.
    expect(h.game().psychics.map((p) => [p.finishedHour, p.level])).toEqual([
      [3, 4],
      [3, 4],
      [3, 4],
    ]);
  });

  it('has no tokens and no track with 3 players', () => {
    const h = startedGame(3);
    expect(h.game().clairvoyance).toBe(false);
    sendAll(h);
    guessAll(h);
    expect(h.reject({ type: 'mark', target: colorOf(h, 'ben'), kind: 'yes' }, 'ana')).toBe(
      'no-tokens',
    );
  });
});

describe('levels and vote stages', () => {
  it('reads the thresholds off the track', () => {
    expect(levelThresholds(4)).toEqual([5, 7]);
    expect(levelThresholds(7)).toEqual([7, 10]);
    expect([4, 5, 6, 7].map((l) => voteStageOf(l, 5, true))).toEqual([1, 2, 2, 3]);
    expect([6, 7, 9, 10].map((l) => voteStageOf(l, 6, true))).toEqual([1, 2, 2, 3]);
    expect(voteStageOf(0, 3, false)).toBe(3);
  });
});

function finalWithLevels(levels: Record<string, number>, count = 5) {
  const h = startedGame(count);
  toFinal(h);
  h.state = {
    ...h.state,
    game: {
      ...h.game(),
      psychics: h.game().psychics.map((p) => ({ ...p, level: levels[p.id] ?? p.level })),
    },
  };
  return h;
}

describe('the final', () => {
  it('stages the shared vision by clairvoyance level, then the culprit wins', () => {
    // 5 players: ana low (1 card), ben and cy intermediate (2), dee high (3).
    const h = finalWithLevels({ ana: 4, ben: 5, cy: 6, dee: 9 });
    expect(h.game().final!.groups).toHaveLength(4);
    const cards = h.game().hand.slice(0, 3);
    expect(h.reject({ type: 'vote', group: 0 }, 'ana')).toBe('wrong-stage');
    h.act({ type: 'shared', group: 2, cards, tags: ['suspect', 'place', 'object'] }, HOST);
    expect(h.game().final!.revealed).toBe(1);
    expect(h.reject({ type: 'vote', group: 2 }, 'ben')).toBe('not-your-turn');
    h.act({ type: 'vote', group: 1 }, 'ana');
    expect(h.game().final!.revealed).toBe(2);
    h.act({ type: 'vote', group: 2 }, 'ben');
    h.act({ type: 'vote', group: 2 }, 'cy');
    expect(h.game().final!.revealed).toBe(3);
    h.act({ type: 'vote', group: 2 }, 'dee');
    expect(h.game().result).toMatchObject({ win: true, how: 'culprit', chosen: 2, culprit: 2 });
    expect(h.game().result!.winners).toHaveLength(5);
    expect(h.game().result!.tally).toEqual([0, 1, 3, 0]);
  });

  it('skips stages nobody votes in', () => {
    const h = finalWithLevels({ ana: 9, ben: 9, cy: 9, dee: 9 });
    h.act({ type: 'shared', group: 0, cards: h.game().hand.slice(0, 3) }, HOST);
    expect(h.game().final!.revealed).toBe(3);
  });

  it('breaks a tie by the track, then the earliest finish, then the seat', () => {
    const h = finalWithLevels({ ana: 6, ben: 9, cy: 9, dee: 2 });
    h.act({ type: 'shared', group: 0, cards: h.game().hand.slice(0, 3) }, HOST);
    h.act({ type: 'vote', group: 3 }, 'dee');
    h.act({ type: 'vote', group: 0 }, 'ana');
    h.act({ type: 'vote', group: 1 }, 'ben');
    h.act({ type: 'vote', group: 0 }, 'cy');
    // 2 votes for group 0 (ana, cy), 1 each for 1 and 3: no tie.
    expect(h.game().result).toMatchObject({ chosen: 0, tieBreaker: null, win: true });

    const t = finalWithLevels({ ana: 9, ben: 9, cy: 2, dee: 2 });
    t.state = {
      ...t.state,
      game: {
        ...t.game(),
        psychics: t.game().psychics.map((p) => (p.id === 'ben' ? { ...p, finishedHour: 2 } : p)),
      },
    };
    t.act({ type: 'shared', group: 0, cards: t.game().hand.slice(0, 3) }, HOST);
    t.act({ type: 'vote', group: 3 }, 'cy');
    t.act({ type: 'vote', group: 2 }, 'dee');
    t.act({ type: 'vote', group: 0 }, 'ana');
    t.act({ type: 'vote', group: 1 }, 'ben');
    // Four-way tie, ana and ben furthest along; ben finished first.
    expect(t.game().result).toMatchObject({ chosen: 1, tieBreaker: t.psychic('ben').color });
    expect(t.game().result!.win).toBe(false);
  });

  it('lets the host close a vote stage (abstentions) and loses with no votes', () => {
    const h = finalWithLevels({ ana: 0, ben: 0, cy: 0, dee: 0 });
    h.act({ type: 'shared', group: 0, cards: h.game().hand.slice(0, 3) }, HOST);
    h.act({ type: 'lock-now' }, HOST);
    expect(h.game().result).toMatchObject({ win: false, how: 'no-votes' });
  });

  it('strict timers count missing votes as abstaining', () => {
    const h = startedGame(4, { timerMode: 'strict' });
    toFinal(h);
    h.act({ type: 'shared', group: 1, cards: h.game().hand.slice(0, 3) }, HOST);
    // Everyone finished in hour III (level 4 of 4–5 players' 5 and 7): they all vote on card 1.
    expect(h.game().final!.revealed).toBe(1);
    h.act({ type: 'vote', group: 1 }, 'ana');
    h.tick(60_000);
    expect(h.game().result).toMatchObject({ win: true, tally: [0, 1, 0] });
    expect(h.game().final!.votes).toEqual({
      [colorOf(h, 'ana')]: 1,
      [colorOf(h, 'ben')]: null,
      [colorOf(h, 'cy')]: null,
    });
  });

  it('shows everything at 3 players at once', () => {
    const h = startedGame(3);
    toFinal(h);
    h.act({ type: 'shared', group: 0, cards: h.game().hand.slice(0, 3) }, HOST);
    expect(h.game().final!.revealed).toBe(3);
    h.act({ type: 'vote', group: 0 }, 'ana');
    h.act({ type: 'vote', group: 1 }, 'ben');
    // A tie with no track and the same finish hour: the earlier seat (ana) decides.
    expect(h.game().result).toMatchObject({ chosen: 0, win: true });
  });
});

describe('seats changing hands', () => {
  it('the ghost goes only to someone watching, never a psychic', () => {
    const h = startedGame(4);
    h.state = seance.playerJoined(h.state, { id: 'zed', name: 'Zed' });
    expect(h.state.seats.zed!.playing).toBe(false);
    expect(h.reject({ type: 'hand-ghost', to: 'ana' }, HOST)).toBe('bad-ghost');
    h.act({ type: 'hand-ghost', to: 'zed' }, HOST);
    expect(h.game().ghost).toBe('zed');
    expect(h.game().formerGhosts).toEqual([HOST]);
    sendAll2(h, 'zed');
    expect(h.game().sent).toHaveLength(3);
  });

  it('a ghost who leaves frees the seat for someone watching', () => {
    const h = startedGame(4);
    h.state = seance.playerLeft(h.state, HOST, h.now);
    expect(h.game().ghost).toBeNull();
    h.state = seance.playerJoined(h.state, { id: 'zed', name: 'Zed' });
    expect(h.reject({ type: 'claim-ghost' }, 'ana')).toBe('bad-ghost');
    h.act({ type: 'claim-ghost' }, 'zed');
    expect(h.game().ghost).toBe('zed');
  });

  it('a psychic who leaves keeps the seat for someone watching to take', () => {
    const h = startedGame(4);
    sendAll(h);
    guessAll(h);
    h.state = seance.playerLeft(h.state, 'cy', h.now);
    const cy = h.game().psychics[2]!;
    expect(cy.gone).toBe(true);
    // The hour no longer waits for them.
    h.act({ type: 'ready', on: true }, 'ana');
    h.act({ type: 'ready', on: true }, 'ben');
    h.act({ type: 'reveal' }, HOST);
    expect(h.game().stage).toBe('reveal');
    h.state = seance.playerJoined(h.state, { id: 'zed', name: 'Zed' });
    expect(h.reject({ type: 'take-seat', color: h.psychic('ana').color }, 'zed')).toBe('taken');
    h.act({ type: 'take-seat', color: cy.color }, 'zed');
    expect(h.psychic('zed').targets).toEqual(cy.targets);
  });
});

describe('an empty psychic seat', () => {
  it('is neither sent a vision nor judged, and the sand runs without it', () => {
    const h = startedGame(4, { timerSeconds: 60 });
    h.state = seance.playerLeft(h.state, 'cy', h.now);
    sendAll(h);
    expect(h.game().sent).not.toContain(colorOf(h, 'cy'));
    expect(h.game().deadline).toBe(h.now + 60_000);
    guessAll(h);
    readyAll(h);
    expect(h.game().stage).toBe('reveal');
    expect(h.game().verdicts.map((v) => v.color)).toEqual([colorOf(h, 'ana'), colorOf(h, 'ben')]);
    expect(h.psychic('cy').step).toBe(0);
  });

  it('starts the sand when the last psychic still waiting for a vision leaves', () => {
    const h = startedGame(4, { timerSeconds: 60 });
    h.act({ type: 'send', to: colorOf(h, 'ana'), cards: [h.game().hand[0]!] });
    h.act({ type: 'send', to: colorOf(h, 'ben'), cards: [h.game().hand[0]!] });
    expect(h.game().deadline).toBeNull();
    h.state = seance.playerLeft(h.state, 'cy', h.now);
    expect(h.game().deadline).toBe(h.now + 60_000);
  });

  it('gives back tokens played on a guess that is not judged', () => {
    const h = startedGame(4);
    sendAll(h);
    guessAll(h);
    h.act({ type: 'mark', target: colorOf(h, 'cy'), kind: 'yes' }, 'ana');
    expect(h.psychic('ana').tokens).toBe(h.game().tokensEach - 1);
    h.state = seance.playerLeft(h.state, 'cy', h.now);
    expect(h.reject({ type: 'mark', target: colorOf(h, 'cy'), kind: 'no' }, 'ben')).toBe(
      'bad-target',
    );
    readyAll(h);
    expect(h.psychic('ana').tokens).toBe(h.game().tokensEach);
  });

  it('the host can retire it: its cards go back and the game goes on without it', () => {
    const h = startedGame(4);
    playHour(h, ['cy']);
    const cy = h.psychic('cy');
    const found = cy.found[0]!;
    expect(h.game().table.suspect).not.toContain(found);
    h.reject({ type: 'retire-seat', color: cy.color }); // still here
    h.state = seance.playerLeft(h.state, 'cy', h.now);
    expect(h.reject({ type: 'retire-seat', color: cy.color }, 'ana')).toBe('not-host');
    h.act({ type: 'retire-seat', color: cy.color });
    expect(h.psychic('cy').retired).toBe(true);
    expect(h.game().table.suspect).toContain(found);
    // Nobody can take it over, and the player coming back only watches.
    h.state = seance.playerJoined(h.state, { id: 'zed', name: 'Zed' });
    expect(h.reject({ type: 'take-seat', color: cy.color }, 'zed')).toBe('retired');
    h.state = seance.playerJoined(h.state, { id: 'cy', name: 'Cy' });
    expect(h.psychic('cy').gone).toBe(true);
    expect(seance.view(h.state, 'cy').game!.myRole).toBeNull();
    expect(h.reject({ type: 'intuition', card: h.game().table.suspect[0]! }, 'cy')).toBe(
      'not-psychic',
    );
    // The others finish, and the line-up and vote leave the seat out.
    toFinal(h);
    expect(h.game().final!.groups).toEqual([colorOf(h, 'ana'), colorOf(h, 'ben')]);
    const hand = h.game().hand;
    h.act({ type: 'shared', group: 0, cards: [hand[0]!, hand[1]!, hand[2]!] });
    for (const id of ['ana', 'ben'])
      if (h.game().stage === 'vote') h.act({ type: 'vote', group: 0 }, id);
    expect(h.game().result!.win).toBe(true);
    expect(h.game().result!.winners).not.toContain('cy');
  });

  it('retiring the last psychic still searching goes straight to the line-up', () => {
    const h = startedGame(4);
    h.state = seance.playerLeft(h.state, 'cy', h.now);
    toFinalExcept(h);
    expect(h.game().stage).toBe('visions');
    h.act({ type: 'retire-seat', color: colorOf(h, 'cy') });
    expect(h.game().stage).toBe('shared');
  });

  it('keeps at least one psychic, and only before the line-up', () => {
    const h = startedGame(3);
    h.state = seance.playerLeft(h.state, 'ana', h.now);
    h.state = seance.playerLeft(h.state, 'ben', h.now);
    h.act({ type: 'retire-seat', color: colorOf(h, 'ana') });
    expect(h.reject({ type: 'retire-seat', color: colorOf(h, 'ben') })).toBe('last-seat');
    const g = startedGame(4);
    toFinal(g);
    g.state = seance.playerLeft(g.state, 'cy', g.now);
    expect(g.reject({ type: 'retire-seat', color: colorOf(g, 'cy') })).toBe('wrong-stage');
  });
});

/** Plays right guesses until everyone at the table has found all three (a gone seat stays). */
function toFinalExcept(h: Harness) {
  for (let i = 0; i < 3; i++) playHour(h);
}

function sendAll2(h: Harness, ghost: string) {
  for (const p of h.game().psychics)
    h.act({ type: 'send', to: p.color, cards: [h.game().hand[0]!] }, ghost);
}

describe('insights', () => {
  it('report visions, guesses, tokens, finishes, votes and the outcome', () => {
    const h = startedGame(4);
    const events: ReturnType<typeof recapEventOf>[] = [];
    let before: SeanceState = h.state;
    const step = (fn: () => void) => {
      fn();
      events.push(...insights(before, h.state, null, null).map((e) => recapEventOf(e)));
      before = h.state;
    };
    step(() => sendAll(h));
    step(() => guessAll(h));
    step(() => h.act({ type: 'mark', target: colorOf(h, 'ben'), kind: 'yes' }, 'ana'));
    step(() => readyAll(h));
    step(() => h.act({ type: 'raven', cards: [h.game().hand[0]!] }, HOST));
    step(() => h.act({ type: 'continue' }, HOST));
    step(() => toFinal(h));
    step(() => h.act({ type: 'shared', group: 0, cards: h.game().hand.slice(0, 3) }, HOST));
    while (h.state.phase !== 'over') step(() => voteInTurn(h));
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'vision')).toHaveLength(9);
    expect(types.filter((t) => t === 'guess')).toHaveLength(9);
    expect(types.filter((t) => t === 'finish')).toHaveLength(3);
    expect(types).toContain('raven');
    expect(events.find((e) => e.type === 'clairvoyance')!.props).toMatchObject({ hit: true });
    expect(events.at(-1)).toMatchObject({ type: 'outcome', props: { how: 'culprit', win: true } });
    // Nothing secret before the end: guesses name only what was guessed.
    expect(events.find((e) => e.type === 'guess')!.props.card).toMatch(/^suspect-\d+$/);
  });
});

/** The next psychic whose turn it is votes for group 0 (the culprit in these tests). */
function voteInTurn(h: Harness) {
  const g = h.game();
  const p = g.psychics.find(
    (x) => voteStage(g, x) === g.final!.revealed && !(x.color in g.final!.votes),
  )!;
  h.act({ type: 'vote', group: 0 }, p.id);
}

function seatsOf(state: SeanceState) {
  return Object.entries(state.seats).map(([id, s]) => ({ id, ...s }));
}
