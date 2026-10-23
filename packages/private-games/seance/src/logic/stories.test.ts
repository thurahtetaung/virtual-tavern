import { describe, expect, it } from 'vitest';
import { ALL_CARDS, STELLAR_SET, CARD_SETS as PICTURE_SETS } from '@vt/private-reverie/cards';
import {
  CARD_COUNTS,
  CARD_SETS,
  POOL_CARDS,
  POOL_IDS,
  POOL_R_CARDS,
  SET_IDS,
  isPillarCard,
  kindOf,
  pictureCardOf,
  poolOf,
  poolOfVision,
} from './cards.ts';
import { seance } from './game.ts';
import { insights } from './insights.ts';
import { startProblem } from './setup.ts';
import {
  HOST,
  colorOf,
  guessAll,
  harness,
  playHour,
  readyAll,
  sendAll,
  startedGame,
  toFinal,
} from './test-utils.ts';
import { type SeanceState, actionSchema } from './types.ts';

const STORIES = [...CARD_SETS.exp2.story, ...CARD_SETS.promo.story];

describe('card numbers', () => {
  it('stories are 1 to 20, from the second expansion and the promos', () => {
    expect(STORIES).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(CARD_SETS.base.story).toEqual([]);
    expect(CARD_SETS.exp1.story).toEqual([]);
    expect(CARD_COUNTS.story).toBe(20);
  });

  it('the pools follow the sets’ 173 visions, contiguous and never overlapping', () => {
    const sets = SET_IDS.flatMap((s) => [...CARD_SETS[s].vision]);
    expect(sets).toEqual(Array.from({ length: 173 }, (_, i) => i + 1));
    expect(POOL_CARDS['pool-a']).toHaveLength(168);
    expect(POOL_CARDS['pool-b']).toHaveLength(84);
    const all = [...sets, ...POOL_IDS.flatMap((p) => [...POOL_CARDS[p]])];
    expect(all).toEqual(Array.from({ length: all.length }, (_, i) => i + 1));
    expect(CARD_COUNTS.vision).toBe(all.length);
  });

  it('pool-r plays Reverie’s picture cards, all but Starlight’s own, in order', () => {
    const stellar = PICTURE_SETS.find((s) => s.id === STELLAR_SET)!.cards;
    expect(POOL_R_CARDS).toHaveLength(867);
    expect(POOL_R_CARDS).toEqual(ALL_CARDS.filter((n) => !stellar.includes(n)));
    expect(POOL_CARDS['pool-r']).toHaveLength(867);
    const first = POOL_CARDS['pool-r'][0]!;
    expect(pictureCardOf(first)).toBe(POOL_R_CARDS[0]);
    expect(pictureCardOf(first + 866)).toBe(POOL_R_CARDS[866]);
    expect(pictureCardOf(first - 1)).toBeNull();
    expect(pictureCardOf(1)).toBeNull();
    expect(poolOfVision(174)).toBe('pool-a');
    expect(poolOfVision(342)).toBe('pool-b');
    expect(poolOfVision(first)).toBe('pool-r');
    expect(poolOfVision(173)).toBeNull();
  });

  it('the third pillar’s kind', () => {
    expect(kindOf('object')).toBe('object');
    expect(kindOf('object', 'story')).toBe('story');
    expect(kindOf('suspect', 'story')).toBe('suspect');
    expect(kindOf('place', 'story')).toBe('place');
  });

  it('a card belongs to a pillar by its kind, stories standing in for objects', () => {
    expect(isPillarCard('story', 'object', 'story')).toBe(true);
    expect(isPillarCard('object', 'object', 'story')).toBe(false);
    expect(isPillarCard('object', 'object')).toBe(true);
    expect(isPillarCard('story', 'object')).toBe(false);
    expect(isPillarCard('suspect', 'suspect', 'story')).toBe(true);
    expect(isPillarCard('vision', 'suspect', 'story')).toBe(false);
    expect(isPillarCard('place', 'suspect', 'story')).toBe(false);
  });
});

describe('lobby options', () => {
  it('new rooms play objects and no extra visions', () => {
    const h = harness(4);
    expect(h.state.settings.third).toBe('object');
    expect(h.state.settings.pools).toEqual([]);
    expect(seance.view(h.state, HOST).settings.pools).toEqual([]);
  });

  it('the host picks the third pillar and the pools (kept in pool order, no repeats)', () => {
    const h = harness(4);
    h.act({ type: 'update-settings', third: 'story', pools: ['pool-r', 'pool-a'] });
    expect(h.state.settings.third).toBe('story');
    expect(h.state.settings.pools).toEqual(['pool-a', 'pool-r']);
    expect(
      actionSchema.safeParse({ type: 'update-settings', pools: ['pool-a', 'pool-a'] }).success,
    ).toBe(false);
    expect(actionSchema.safeParse({ type: 'update-settings', third: 'card' }).success).toBe(false);
    expect(h.reject({ type: 'update-settings', third: 'object' }, 'ana')).toBe('not-host');
    h.act({ type: 'update-settings', pools: [] });
    expect(h.state.settings.pools).toEqual([]);
  });

  it('stories need the sets that hold them', () => {
    const seats = ['a', 'b', 'c', 'd'].map((id) => ({ id, playing: true, volunteer: false }));
    const base = harness(4).state.settings;
    expect(startProblem({ ...base, third: 'story' }, seats)).toBeNull();
    expect(startProblem({ ...base, third: 'story', sets: ['base', 'exp1'] }, seats)).toMatch(
      /too few story cards/,
    );
    // The promos' two stories alone are too few, but the objects are fine without stories.
    expect(startProblem({ ...base, third: 'story', sets: ['base', 'promo'] }, seats)).toMatch(
      /story/,
    );
    expect(startProblem({ ...base, sets: ['base'] }, seats)).toBeNull();
  });

  it('extra pools count towards the visions in play', () => {
    expect(poolOf(['promo'], 'vision')).toHaveLength(5);
    expect(poolOf(['promo'], 'vision', ['pool-b'])).toHaveLength(89);
    const seats = ['a', 'b', 'c'].map((id) => ({ id, playing: true, volunteer: false }));
    const settings = { ...harness(3).state.settings, sets: ['promo' as const] };
    // The promos alone lack the pillar cards anyway; the visions are what the pools fix.
    expect(startProblem(settings, seats)).toMatch(/suspect/);
  });
});

describe('stories as the third pillar', () => {
  it('lays and deals story cards, and plays to a win', () => {
    const h = startedGame(4, { third: 'story' });
    const g = h.game();
    expect(g.third).toBe('story');
    expect(g.table.object.every((n) => STORIES.includes(n))).toBe(true);
    expect(g.table.object.length).toBeGreaterThanOrEqual(5);
    for (const p of g.psychics) {
      expect(g.table.object).toContain(p.targets[2]);
      expect(STORIES).toContain(p.targets[2]);
    }
    expect(seance.view(h.state, 'ana').game!.third).toBe('story');
    toFinal(h);
    expect(h.game().psychics.every((p) => p.found.length === 3)).toBe(true);
    // Everyone at the top of the track: they all vote once the three cards are up.
    h.state = {
      ...h.state,
      game: { ...h.game(), psychics: h.game().psychics.map((p) => ({ ...p, level: 9 })) },
    };
    const cards = h.game().hand.slice(0, 3);
    h.act({ type: 'shared', group: 1, cards, tags: ['suspect', 'place', 'object'] }, HOST);
    for (const id of ['ana', 'ben', 'cy']) h.act({ type: 'vote', group: 1 }, id);
    expect(h.game().result).toMatchObject({ win: true, how: 'culprit' });
    // The line-up groups hold each psychic's story as their third card.
    const ben = h.game().psychics[1]!;
    expect(STORIES).toContain(ben.found[2]);
  });

  it('a story guess is judged like an object guess, and its stats name the story', () => {
    const h = startedGame(4, { third: 'story' });
    playHour(h);
    playHour(h);
    sendAll(h);
    const before = h.state;
    guessAll(h, ['ana']);
    readyAll(h);
    const ana = h.psychic('ana');
    expect(ana.step).toBe(3);
    expect(STORIES).toContain(ana.found[2]);
    const events = insights(before, h.state, { type: 'reveal' }, HOST);
    const guesses = events.filter((e) => e.type === 'guess');
    expect(guesses.length).toBeGreaterThan(0);
    for (const e of guesses) expect(String(e.props?.card)).toMatch(/^story-\d+$/);
  });
});

describe('extra vision pools', () => {
  it('stay out of the deck by default', () => {
    const h = startedGame(4);
    const g = h.game();
    for (const n of [...g.deck, ...g.hand]) expect(n).toBeLessThanOrEqual(173);
  });

  it('are shuffled into the deck when on, and their visions can be sent', () => {
    const h = startedGame(4, { pools: ['pool-a', 'pool-b', 'pool-r'] });
    const g = h.game();
    const cards = [...g.deck, ...g.hand];
    expect(cards).toHaveLength(173 + 168 + 84 + 867);
    expect(new Set(cards).size).toBe(cards.length);
    expect(cards.some((n) => poolOfVision(n) === 'pool-r')).toBe(true);
    // Put a pool-r vision in the hand and send it.
    const card = POOL_CARDS['pool-r'].at(-1)!;
    h.state = {
      ...h.state,
      game: {
        ...g,
        hand: [card, ...g.hand.filter((n) => n !== card).slice(1)],
        deck: g.deck.filter((n) => n !== card),
      },
    };
    h.act({ type: 'send', to: colorOf(h, 'ana'), cards: [card] }, HOST);
    expect(h.psychic('ana').visions.map((v) => v.card)).toEqual([card]);
  });
});

describe('rooms saved before wave 2', () => {
  /** A state as it was saved before the third pillar and the pools existed. */
  function old(state: SeanceState): SeanceState {
    const { third: _t, pools: _p, ...settings } = state.settings;
    const game = state.game ? (({ third: _g, ...rest }) => rest)(state.game) : null;
    return JSON.parse(JSON.stringify({ ...state, settings, game })) as SeanceState;
  }

  it('a game in progress plays on with objects', () => {
    const h = startedGame(4);
    h.state = old(h.state);
    expect(h.game().third).toBeUndefined();
    const v = seance.view(h.state, 'ana');
    expect(v.game!.third).toBe('object');
    expect(v.settings.third).toBe('object');
    expect(v.settings.pools).toEqual([]);
    toFinal(h);
    expect(h.game().stage).toBe('shared');
  });

  it('a lobby starts with objects and no pools', () => {
    const h = startedGame(4);
    h.act({ type: 'back-to-lobby' }, HOST);
    h.state = old(h.state);
    h.act({ type: 'start' });
    const g = h.game();
    expect(g.third).toBe('object');
    expect([...g.deck, ...g.hand].every((n) => n <= 173)).toBe(true);
    expect(g.table.object.every((n) => n <= CARD_COUNTS.object)).toBe(true);
  });
});
