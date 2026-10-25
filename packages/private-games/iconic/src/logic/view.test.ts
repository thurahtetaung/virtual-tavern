import { type Rng, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { iconic, team } from './game.ts';
import { HOST, chooseWord, harness, round, started } from './test-utils.ts';
import { type IconicAction, type IconicState, SETS } from './types.ts';

/**
 * The same state with every secret changed: the card, the answer, the pair's proposal and vetoes,
 * the reroll, a pending award, the decks and the hidden seed. A viewer who may not see them must
 * get exactly the same view.
 */
function swapped(state: IconicState): IconicState {
  const s = JSON.parse(JSON.stringify(state)) as IconicState;
  s.seed = (s.seed + 12345) >>> 0;
  const g = s.game;
  if (!g) return s;
  for (const level of ['easy', 'hard', 'challenging'] as const) {
    g.deck[level] = g.deck[level].map((w) => `${w}?`);
    g.spent[level] = [`zz ${level}`];
  }
  const r = g.round;
  r.card = r.card.map((w) => ({ ...w, word: `other ${w.word}` }));
  if (r.answer) r.answer = { word: `secret ${r.answer.word}`, level: r.answer.level };
  r.rerolled = !r.rerolled;
  r.vetoes = r.vetoes ? 0 : 1;
  r.picker = r.picker ? null : (r.givers[0] ?? null);
  r.proposal = r.proposal ? null : r.givers[0] ? { by: r.givers[0], index: 5 } : null;
  r.award = r.award ? null : r.guesses[0] ? { guess: r.guesses[0].id, by: 'x', until: 1 } : null;
  return s;
}

/** Everyone who might look: players, a watcher and nobody. */
const viewers = (s: IconicState) => [...Object.keys(s.seats), 'watcher', null];

/**
 * Checks that nobody sees a secret they shouldn't, at this moment: every viewer, or (in the
 * fuzz, to keep it quick) a few picked at random plus nobody.
 */
function checkViews(state: IconicState, rng?: Rng) {
  const g = state.game;
  const open = !g || g.round.stage === 'reveal' || state.phase !== 'playing';
  if (open) return;
  const other = swapped(state);
  const r = g.round;
  const secrets = [...r.card.map((w) => w.word), ...(r.answer ? [r.answer.word] : [])];
  // Words a guesser typed, or an earlier round's word, are public: check only the others.
  const unspoken = secrets.filter(
    (w) =>
      !r.guesses.some((x) => x.text.toLowerCase().includes(w.toLowerCase())) &&
      !g.history.some((x) => x.word === w),
  );
  const all = viewers(state);
  const some = rng ? [null, ...[0, 1, 2].map(() => all[rng.int(all.length)]!)] : all;
  for (const v of some) {
    const inTeam = v !== null && team(r).includes(v);
    if (inTeam) continue;
    const a = JSON.stringify(iconic.view(state, v));
    // Plain checks: an expect() per word would make the fuzz crawl.
    const b = JSON.stringify(iconic.view(other, v));
    if (a !== b) expect(a, `viewer ${v}`).toBe(b);
    const seen = unspoken.find((w) => a.includes(`"${w}"`));
    if (seen) expect.fail(`${v} sees ${seen}`);
  }
  // A helper sees the word but not the choosing.
  if (r.helper) {
    const hv = iconic.view(state, r.helper).game!.round.secret!;
    expect(hv.proposal).toBeNull();
    expect(hv.looksRight).toEqual([]);
  }
}

describe('view', () => {
  it('hides the card, the word and the choosing at every stage', () => {
    const h = started(5, { first: 'p1' });
    checkViews(h.state);
    // The pair sees the card; nobody else does.
    expect(iconic.view(h.state, 'p1').game!.round.card).toHaveLength(9);
    expect(iconic.view(h.state, 'p3').game!.round.card).toBeNull();
    h.act('p1', { type: 'pick', index: 2 });
    checkViews(h.state);
    expect(iconic.view(h.state, 'p2').game!.round.secret!.proposal).toEqual({
      by: 'p1',
      index: 2,
    });
    h.act('p2', { type: 'veto' });
    checkViews(h.state);
    h.act('p2', { type: 'pick', index: 4 });
    h.act('p1', { type: 'agree' });
    checkViews(h.state);
    // Placing: the card goes away for the givers too, the word stays.
    const giverView = iconic.view(h.state, 'p1').game!.round;
    expect(giverView.card).toBeNull();
    expect(giverView.secret!.answer).toEqual(round(h).answer);
    h.act('p1', { type: 'place', set: 'main', icon: 3 });
    h.act('p3', { type: 'guess', text: 'castle' });
    h.act('p1', { type: 'mark', guess: round(h).guesses[0]!.id, mark: 'close' });
    checkViews(h.state);
    h.act('p4', { type: 'guess', text: round(h).answer!.word });
    h.act('p2', { type: 'award', guess: round(h).guesses[1]!.id });
    checkViews(h.state);
    // The pending award stays with the clue team.
    expect(iconic.view(h.state, 'p4').game!.round.secret).toBeNull();
    h.tick();
    // The reveal shows everyone the word and the card.
    for (const v of viewers(h.state)) {
      const rv = iconic.view(h.state, v).game!.round;
      expect(rv.result!.word).toBe(round(h).answer!.word);
      expect(rv.card).toHaveLength(9);
    }
  });

  it('never sends the decks or the seed', () => {
    const h = started(4);
    const text = JSON.stringify(iconic.view(h.state, 'p1'));
    expect(text).not.toContain('"deck"');
    expect(text).not.toContain('"spent"');
    expect(text).not.toContain('"seed"');
    // Words still in the deck appear nowhere.
    for (const w of h.state.game!.deck.easy) expect(text.includes(`"${w}"`)).toBe(false);
  });

  it('a helper sees the word once invited', () => {
    const h = started(4, { first: 'p1', settings: { roundMinutes: null } });
    chooseWord(h);
    expect(iconic.view(h.state, 'p2').game!.round.secret).toBeNull();
    h.act('p1', { type: 'invite', player: 'p2' });
    expect(iconic.view(h.state, 'p2').game!.round.secret!.answer).toEqual(round(h).answer);
    checkViews(h.state);
  });
});

/** A move that moves the game on: choose, guess the word, award it. */
function progressMove(s: IconicState, rng: Rng): { by: string; action: IconicAction } | null {
  const g = s.game;
  const r = g?.round;
  if (!g || !r) return null;
  const others = g.order.filter((id) => !team(r).includes(id));
  if (r.stage === 'choose')
    return r.proposal
      ? { by: r.givers.find((id) => id !== r.proposal!.by)!, action: { type: 'agree' } }
      : { by: r.picker ?? r.givers[0]!, action: { type: 'pick', index: rng.int(9) } };
  if (r.stage === 'clue' && !r.award) {
    const last = r.guesses.at(-1);
    if (last && rng.next() < 0.5)
      return { by: r.givers[0]!, action: { type: 'award', guess: last.id } };
    const by = others[rng.int(others.length)];
    return by && r.answer ? { by, action: { type: 'guess', text: r.answer.word } } : null;
  }
  return null;
}

/** A random move by a random player: legal or not, the engine decides. */
function randomMove(s: IconicState, rng: Rng): { by: string; action: IconicAction } {
  const seats = Object.keys(s.seats);
  const r = s.game?.round;
  if (rng.next() < 0.5) {
    const move = progressMove(s, rng);
    if (move) return move;
  }
  const giver = r?.givers[rng.int(r.givers.length)];
  const pickBy = () =>
    giver && rng.next() < 0.75 ? giver : (seats[rng.int(seats.length)] ?? HOST);
  const anyone = () => seats[rng.int(seats.length)] ?? HOST;
  const guessId = () => r?.guesses[rng.int(Math.max(1, r.guesses.length))]?.id ?? 1;
  const roll = rng.int(16);
  switch (roll) {
    case 0:
      return { by: pickBy(), action: { type: 'pick', index: rng.int(9) } };
    case 1:
      return { by: pickBy(), action: { type: rng.next() < 0.6 ? 'agree' : 'veto' } };
    case 2:
      return { by: pickBy(), action: { type: 'reroll' } };
    case 3:
    case 4:
    case 5:
      return {
        by: pickBy(),
        action: { type: 'place', set: SETS[rng.int(SETS.length)]!, icon: 1 + rng.int(118) },
      };
    case 6:
      return {
        by: pickBy(),
        action: { type: 'remove', set: SETS[rng.int(SETS.length)]!, icon: 1 + rng.int(118) },
      };
    case 7:
    case 8: {
      // Now and then the right word, so games end.
      const text = rng.next() < 0.3 && r?.answer ? r.answer.word : `guess ${rng.int(40)}`;
      return { by: anyone(), action: { type: 'guess', text } };
    }
    case 9:
      return {
        by: pickBy(),
        action: { type: 'mark', guess: guessId(), mark: rng.next() < 0.5 ? 'close' : 'wrong' },
      };
    case 10:
      return { by: pickBy(), action: { type: 'award', guess: guessId() } };
    case 11:
      return { by: pickBy(), action: { type: rng.next() < 0.5 ? 'undo' : 'wipe' } };
    case 12:
      return { by: anyone(), action: { type: 'give-up', on: rng.next() < 0.8 } };
    case 13:
      return {
        by: pickBy(),
        action: rng.next() < 0.3 ? { type: 'pass' } : { type: 'invite', player: anyone() },
      };
    case 14:
      return { by: HOST, action: { type: 'act-for' } };
    default:
      return { by: anyone(), action: { type: 'guess', text: `idea ${rng.int(9)}` } };
  }
}

describe('view fuzz', () => {
  it('500 seeded games leak nothing to anyone', () => {
    let finished = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const rng = createRng(seed * 7919);
      const n = 3 + (seed % 6);
      const h = harness(n, seed, {
        givers: (['auto', 1, 2] as const)[seed % 3]!,
        length: seed % 4 === 0 ? 'each' : 'twelve',
        bonus: seed % 2 === 0,
        roundMinutes: seed % 5 === 0 ? null : 3,
        timerMode: seed % 3 === 0 ? 'strict' : 'soft',
      });
      h.act(HOST, { type: 'start' });
      let last = '';
      for (let step = 0; step < 150 && h.state.phase === 'playing'; step++) {
        if (rng.next() < 0.08 && iconic.nextDeadline!(h.state) !== null) h.tick();
        else {
          const { by, action } = randomMove(h.state, rng);
          const parsed = iconic.actionSchema.safeParse(action);
          if (!parsed.success) continue;
          const next = iconic.reduce(h.state, parsed.data, {
            by,
            isHost: by === HOST,
            now: h.now,
            rng,
            content: { wordLists: () => [], words: () => [] },
          });
          if (!('code' in next)) h.state = next;
          h.wait(500);
        }
        const r = h.state.game?.round;
        const key = `${r?.no}:${r?.stage}:${r?.proposal ? 1 : 0}:${r?.award ? 1 : 0}:${r?.helper}`;
        // Every change of step, and now and then within one.
        if (key !== last || step % 10 === 0) checkViews(h.state, rng);
        last = key;
      }
      checkViews(h.state);
      expect(JSON.stringify(h.state).length).toBeLessThan(256_000);
      if (h.state.phase === 'over') finished++;
    }
    expect(finished).toBeGreaterThan(50);
  }, 120_000);
});
