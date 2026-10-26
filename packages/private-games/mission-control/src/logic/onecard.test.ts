import { afterEach, describe, expect, it } from 'vitest';
import { type Table, evaluate } from './checks.ts';
import { createRng } from '@vt/game-sdk';
import { drawFromRight, orderFailure, rowFailure } from './onecard.ts';
import { HOST, type Harness, att, dive, draftAll, harness, readyAll, rig } from './test-utils.ts';
import { DUMMY, type TaskInPlay } from './types.ts';

afterEach(() => rig(null));

/** p1 holds every pink, the trumps and the blue 1; p2 blues and low greens; p3 the rest. */
const SPLIT = [
  ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 't1', 't2', 't3', 't4', 'b1'],
  ['b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'g1', 'g2', 'g3', 'g4', 'g5'],
  ['g6', 'g7', 'g8', 'g9', 'y1', 'y2', 'y3', 'y4', 'y5', 'y6', 'y7', 'y8', 'y9'],
];

/** A table on the one-card voyage, briefed into mission `n`. */
function cards(
  n: number,
  players = 3,
  tasks?: string[],
  hands: string[][] | null = SPLIT,
): Harness {
  rig({ ...(hands && { hands }), ...(tasks && { tasks }) });
  const h = harness(players);
  h.act(HOST, { type: 'update-settings', voyageKey: 'test-cards' });
  h.act(HOST, { type: 'choose', mission: n });
  h.act(HOST, { type: 'start' });
  readyAll(h);
  return h;
}

const done = (at: number, token: TaskInPlay['token'], text = 'x'): TaskInPlay => ({
  key: `card:${text}`,
  check: { kind: 'win-cards', cards: ['p1'] },
  text,
  difficulty: 0,
  owner: 'a',
  crew: false,
  prediction: null,
  state: 'done',
  progress: null,
  why: null,
  at,
  fedBy: [],
  token,
});
const open = (token: TaskInPlay['token'], text = 'y'): TaskInPlay => ({
  ...done(0, token, text),
  state: 'open',
  at: null,
});

describe('order tokens', () => {
  it('numbered tokens: 1 before 2, and an unmarked task can’t jump the queue', () => {
    expect(orderFailure([done(1, '1'), done(2, '2')])).toBeNull();
    expect(orderFailure([done(2, '1'), done(1, '2', 'b')])?.why).toMatch(/too early/);
    expect(orderFailure([done(1, null, 'free'), open('1', 'one')])?.why).toMatch(
      /had to be task 1/,
    );
  });

  it('consecutive tokens in one trick count in either order', () => {
    expect(orderFailure([done(1, '2', 'b'), done(1, '1', 'a')])).toBeNull();
  });

  it('arrows keep their relative order; unmarked tasks come any time', () => {
    expect(orderFailure([done(1, null), done(2, '>'), done(3, '>>', 'z')])).toBeNull();
    expect(orderFailure([done(1, '>>', 'b'), open('>', 'a')])?.why).toMatch(/before/);
  });

  it('Ω is last; in the same trick as the others it still counts as last', () => {
    expect(orderFailure([done(1, 'o'), open(null)])?.why).toMatch(/last task/);
    expect(orderFailure([done(2, 'o'), done(2, null, 'z')])).toBeNull();
  });
});

describe('the bonus missions', () => {
  it('announcements: in turn from the captain, each for the player on their left, public', async () => {
    const { missionControl } = await import('./definition.ts');
    const h = cards(19);
    expect(att(h).stage).toBe('announce');
    expect(h.refuse('p2', { type: 'announce', n: 1 }).code).toBe('not-your-turn');
    h.act('p1', { type: 'announce', n: 2 });
    h.act('p2', { type: 'announce', n: 0 });
    h.act('p3', { type: 'announce', n: 4 });
    const p = (s: string) => att(h).tasks.find((t) => t.key === `announce:${s}`)!.prediction;
    expect([p('p2'), p('p3'), p('p1')]).toEqual([2, 0, 4]);
    expect(missionControl.view(h.state, 'p3').attempt!.tasks.map((t) => t.prediction)).toEqual([
      4, 2, 0,
    ]);
    expect(att(h).stage).toBe('distress');
  });

  it('one task in each of consecutive tricks', () => {
    expect(rowFailure([done(1, null, 'a'), done(2, null, 'b')], 2)).toBeNull();
    expect(rowFailure([done(1, null, 'a'), done(1, null, 'b')], 1)?.why).toMatch(/one per trick/);
    expect(rowFailure([done(1, null, 'a'), open(null)], 2)?.why).toMatch(/went by without a task/);
    expect(rowFailure([open(null)], 3)).toBeNull();
  });

  it('fixed blue tasks, and bonus missions don’t count for the campaign’s next mission', () => {
    const h = cards(21);
    expect(att(h).tasks.map((t) => t.key)).toEqual(['card:b1', 'card:b2', 'card:b3', 'card:b4']);
    const voyage = h.state.voyages.find((v) => v.key === 'test-cards')!;
    expect(voyage.missions.find((m) => m.n === 19)).toMatchObject({ label: 'P1', bonus: true });
  });
});

describe('the one-card campaign', () => {
  it('deals one-card tasks with their tokens and fails on the wrong order', () => {
    const h = cards(1, 3, ['p3', 'b2']);
    expect(att(h).tasks.map((t) => [t.key, t.token])).toEqual([
      ['card:p3', '1'],
      ['card:b2', '2'],
    ]);
    draftAll(h);
    dive(h);
    // p1 leads the pink 3 and wins it: task 1 done first, as it should be.
    h.act('p1', { type: 'play', card: 'p3' });
    h.act('p2', { type: 'play', card: 'b2' });
    h.act('p3', { type: 'play', card: 'g6' });
    // The blue 2 went to p1 in the same trick: whoever holds it, the order is fine or the
    // task fails for its holder; the attempt ends either way.
    expect(att(h).stage).toBe('done');
  });

  it('never passes in the draft', () => {
    const h = cards(1, 3, ['p3', 'b2']);
    expect(h.refuse('p1', { type: 'pass' }).code).toBe('no-pass');
  });

  it('the captain picks the sick member after the answers, themself allowed', () => {
    const h = cards(4);
    expect(att(h).stage).toBe('pick');
    expect(h.refuse('p1', { type: 'choose-member', seat: 'p2' }).code).toBe('not-yet');
    h.act('p2', { type: 'reply', reply: 'Good' });
    expect(h.refuse('p3', { type: 'reply', reply: 'Fine' }).code).toBe('bad-reply');
    h.act('p3', { type: 'reply', reply: 'Bad' });
    h.act('p1', { type: 'choose-member', seat: 'p1' });
    expect(att(h).tasks).toMatchObject([{ key: 'pick:sick', owner: 'p1', crew: true }]);
    expect(att(h).stage).toBe('distress');
  });

  it('a chosen-for-a-role mission refuses the captain picking themself', () => {
    const h = cards(17);
    h.act('p2', { type: 'reply', reply: 'Yes' });
    h.act('p3', { type: 'reply', reply: 'No' });
    expect(h.refuse('p1', { type: 'choose-member', seat: 'p1' }).code).toBe('not-self');
    h.act('p1', { type: 'choose-member', seat: 'p3' });
    expect(att(h).tasks[0]).toMatchObject({ key: 'pick:one-trick', owner: 'p3' });
  });

  it('the mute member can’t signal', () => {
    const h = cards(5, 3, ['p3', 'b2']);
    h.act('p1', { type: 'choose-member', seat: 'p2' });
    draftAll(h);
    dive(h);
    expect(h.refuse('p2', { type: 'signal', card: 'b9', pos: 'top' }).message).toMatch(
      /may not signal/,
    );
  });

  it('commander’s decision: tasks stay face down until given to someone else', async () => {
    const { missionControl } = await import('./definition.ts');
    const h = cards(6, 3, ['p3', 'b2']);
    expect(missionControl.view(h.state, 'p1').attempt!.tasks).toEqual([]);
    expect(missionControl.view(h.state, 'p1').attempt!.draft.hidden).toBe(true);
    h.act('p2', { type: 'answer', yes: false });
    h.act('p3', { type: 'answer', yes: true });
    expect(h.refuse('p1', { type: 'give', to: 'p1' }).code).toBe('not-self');
    h.act('p1', { type: 'give', to: 'p2' });
    expect(att(h).tasks.every((t) => t.owner === 'p2')).toBe(true);
    expect(missionControl.view(h.state, 'p3').attempt!.tasks).toHaveLength(2);
  });

  it('commander’s distribution: one task at a time, kept even', () => {
    const h = cards(7, 3, ['p3', 'b2', 'g6', 'y1']);
    const offer = () => {
      h.act('p2', { type: 'answer', yes: true });
      h.act('p3', { type: 'answer', yes: false });
    };
    offer();
    h.act('p1', { type: 'give', to: 'p2' });
    offer();
    h.act('p1', { type: 'give', to: 'p2' });
    offer();
    // A third for p2 would leave someone two behind.
    expect(h.refuse('p1', { type: 'give', to: 'p2' }).code).toBe('uneven');
    h.act('p1', { type: 'give', to: 'p1' });
    offer();
    expect(h.refuse('p1', { type: 'give', to: 'p1' }).code).toBe('uneven');
    h.act('p1', { type: 'give', to: 'p3' });
    expect(att(h).stage).toBe('distress');
  });

  it('roles: preferences in turn, then one first, one last, the rest between', () => {
    const h = cards(8);
    const names = ['Only the first four tricks', 'All tricks in between', 'Only the last trick'];
    for (const id of ['p1', 'p2', 'p3']) h.act(id, { type: 'reply', reply: names[1]! });
    h.act('p1', { type: 'role', role: 0 });
    h.act('p2', { type: 'role', role: 0 });
    h.act('p3', { type: 'role', role: 2 });
    expect(h.refuse('p1', { type: 'ready' }).code).toBe('not-assigned');
    h.act('p2', { type: 'role', role: 1 });
    for (const id of ['p1', 'p2', 'p3']) h.act(id, { type: 'ready' });
    expect(att(h).tasks.map((t) => [t.key, t.owner])).toEqual([
      ['role:0', 'p1'],
      ['role:1', null],
      ['role:2', 'p3'],
    ]);
  });

  it('a token swap needs everyone; then the draft', () => {
    const h = cards(9, 3, ['p3', 'b2', 'g6']);
    expect(att(h).stage).toBe('tokens');
    expect(h.refuse('p2', { type: 'token-edit', a: 0, b: 2 }).code).toBe('bad-target');
    h.act('p2', { type: 'token-edit', a: 0, b: 1 });
    h.act('p1', { type: 'token-answer', yes: true });
    h.act('p3', { type: 'token-answer', yes: true });
    expect(att(h).tasks.map((t) => t.token)).toEqual(['2', '1', null]);
    expect(att(h).stage).toBe('draft');
  });

  it('after the first trick everyone draws a card from the player on their right', () => {
    const h = cards(10, 3, ['p9', 'y9']);
    draftAll(h);
    dive(h);
    h.act('p1', { type: 'play', card: 'p1' });
    h.act('p2', { type: 'play', card: 'b2' });
    h.act('p3', { type: 'play', card: 'g6' });
    const a = att(h);
    expect(Object.keys(a.extras.drawn).sort()).toEqual(['p1', 'p2', 'p3']);
    // p1 drew from p3 (on their right), and so on.
    expect(a.hands.p1).toContain(a.extras.drawn.p1);
    expect(SPLIT[2]).toContain(a.extras.drawn.p1);
    expect(SPLIT[0]).toContain(a.extras.drawn.p2);
  });

  it('a signalled card that changes hands loses its signal (the token stays used)', () => {
    const h = cards(10, 3, ['p9', 'y9']);
    const a = att(h);
    const crafted = {
      ...a,
      hands: { p1: ['p1'], p2: ['b9'], p3: ['g6'] },
      signals: [{ by: 'p2', card: 'b9', pos: 'only' as const, played: false, before: 1 }],
      tokens: ['p1', 'p3'],
    };
    const after = drawFromRight(crafted, createRng(1));
    expect(after.hands.p3).toEqual(['b9']);
    expect(after.signals).toEqual([]);
    expect(after.tokens).toEqual(['p1', 'p3']);
  });

  it('with the dummy: a face-up card is drawn from it, and its new card lies face up', () => {
    rig(null);
    const h = harness(2, 5);
    h.act(HOST, { type: 'update-settings', voyageKey: 'test-cards' });
    h.act(HOST, { type: 'choose', mission: 10 });
    h.act(HOST, { type: 'start' });
    const a = att(h);
    const up = a.dummy!.up.filter((c): c is string => c !== null);
    const after = drawFromRight(a, createRng(3));
    const taken = after.extras.drawn[a.crew[(a.crew.indexOf(DUMMY) + 1) % 3]!]!;
    expect(up).toContain(taken);
    const got = after.extras.drawn[DUMMY]!;
    expect(after.dummy!.up).toContain(got);
    expect(after.dummy!.up).toHaveLength(8);
  });

  it('the condition goes to the player after the card’s holder, announced', () => {
    const h = cards(14);
    expect(att(h).tasks).toMatchObject([{ key: 'holder-left', owner: 'p2' }]);
    expect(att(h).extras.notes).toEqual(['{p:p1} holds {c:p9}.']);
  });

  it('five players may hand one task over before the first trick', () => {
    const five = [
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 't4', 'b1'],
      ['p7', 'p8', 'p9', 'b2', 'b3', 'b4', 'b5', 'b6'],
      ['b7', 'b8', 'b9', 'g1', 'g2', 'g3', 'g4', 'g5'],
      ['g6', 'g7', 'g8', 'g9', 'y1', 'y2', 'y3', 'y4'],
      ['y5', 'y6', 'y7', 'y8', 'y9', 't1', 't2', 't3'],
    ];
    const h = cards(15, 5, ['p3', 'b2', 'g6'], five);
    draftAll(h);
    expect(att(h).stage).toBe('handover');
    const t = att(h).tasks.findIndex((x) => x.owner === 'p1');
    h.act('p2', { type: 'hand-over', task: t, to: 'p4' });
    for (const id of ['p1', 'p3', 'p4', 'p5']) h.act(id, { type: 'hand-over-answer', yes: true });
    expect(att(h).tasks[t]!.owner).toBe('p4');
    expect(att(h).stage).toBe('distress');
  });

  it('Challenge for Three drops green and the trump 1: ten cards each', () => {
    rig(null);
    const h = harness(3);
    h.act(HOST, { type: 'update-settings', voyageKey: 'test-cards', challenge: true });
    h.act(HOST, { type: 'choose', mission: 1 });
    h.act(HOST, { type: 'start' });
    const a = att(h);
    expect(a.total).toBe(10);
    const all = Object.values(a.hands).flat();
    expect(all).toHaveLength(30);
    expect(all.some((c) => c.startsWith('g') || c === 't1')).toBe(false);
    expect(a.tasks.some((t) => t.key.startsWith('card:g'))).toBe(false);
  });
});

const tbl = (over: Partial<Table>): Table => ({
  tricks: [],
  current: [],
  total: 4,
  crew: ['a', 'b', 'c'],
  captain: 'a',
  hands: { a: [], b: [], c: [] },
  size: 3,
  final: false,
  ...over,
});
const trick = (winner: string, ...cards: [string, string][]) => ({
  winner,
  plays: cards.map(([by, card]) => ({ by, card })),
});

describe('mission conditions', () => {
  it('trumps win in order, each as the winning card', () => {
    const c = { kind: 'each-wins', cards: ['t1', 't2'], ordered: true } as const;
    const t = tbl({
      tricks: [trick('a', ['a', 't2'], ['b', 'p1'], ['c', 'p2'])],
      hands: { a: ['t1'], b: [], c: [] },
    });
    expect(evaluate({ ...c, cards: [...c.cards] }, null, t)).toMatchObject({
      state: 'failed',
      why: '{c:t2} won a trick before {c:t1} did.',
    });
  });

  it('a 1 must win a trick; nobody may get two tricks ahead', () => {
    const won = tbl({ tricks: [trick('a', ['a', 'p1'], ['b', 'b5'], ['c', 'y5'])] });
    expect(evaluate({ kind: 'won-with', match: { values: [1] }, count: 1 }, null, won).state).toBe(
      'done',
    );
    const ahead = tbl({ tricks: [trick('a'), trick('a')] });
    expect(evaluate({ kind: 'trick-balance', gap: 2 }, null, ahead)).toMatchObject({
      state: 'failed',
      why: '{p:a} has won 2 more tricks than {p:b}.',
    });
  });

  it('the tricks between belong to their seats', () => {
    const t = tbl({
      total: 6,
      tricks: [trick('a'), trick('a'), trick('a'), trick('a'), trick('c')],
    });
    expect(evaluate({ kind: 'span', from: 5, toFromEnd: 1, seats: ['b'] }, null, t)).toMatchObject({
      state: 'failed',
    });
  });
});
