import { describe, expect, it } from 'vitest';
import { cliffhanger } from './definition.ts';
import { DECK_CAP, goalNow, nextDeadline, progressOf, stealGenres } from './game.ts';
import {
  BASE_GENRES,
  FILM_GENRE_IDS,
  GOALS,
  RETURNS_GENRES,
  TV_GENRE_IDS,
  goalFor,
} from './genres.ts';
import { type Settings, soundModeIn } from './types.ts';
import {
  CATEGORIES,
  HOST,
  type Harness,
  NOW,
  films,
  gettable,
  harness,
  keepAndPlace,
  pair,
  started,
  winFaceOff,
} from './test-utils.ts';
import { COUNTDOWN_MS, PLACE_MS } from './types.ts';

/** Runs the clocks to the next round's face-off, passing any three-for-one. */
function finishRound(h: Harness): void {
  const n = h.state.round!.number;
  while (
    h.state.phase === 'playing' &&
    (h.state.round!.number === n || h.state.round!.stage !== 'faceoff')
  ) {
    const r = h.state.round!;
    if (r.stage === 'steal') h.act(r.pair[r.steal!.queue[0]!], { type: 'pass' });
    else h.tick();
  }
}

describe('lobby', () => {
  it('splits newcomers into the smaller team', () => {
    const h = harness(5);
    const teams = Object.values(h.state.seats).map((s) => s.team);
    expect(teams).toEqual(['a', 'b', 'a', 'b', 'a']);
  });

  it('refuses to start with a team under two, without films or without categories', () => {
    const h = harness(3);
    expect(h.refuse(HOST, { type: 'start' })).toBe('team-too-small');
    expect(harness(4, { packs: { films: [] } }).refuse(HOST, { type: 'start' })).toBe('no-cards');
    expect(harness(4, { packs: { categories: [] } }).refuse(HOST, { type: 'start' })).toBe(
      'no-categories',
    );
    const off = harness(4);
    off.act(HOST, { type: 'update-settings', packIds: ['c1'] });
    expect(off.refuse(HOST, { type: 'start' })).toBe('no-cards');
  });

  it('only the host changes settings; Mix needs exactly three styles unless dealt fresh', () => {
    const h = harness(4);
    expect(h.refuse('p2', { type: 'update-settings', noAdvantage: true })).toBe('not-host');
    h.act(HOST, { type: 'update-settings', mode: 'mix', mixStyles: ['one-word', 'quote'] });
    expect(h.refuse(HOST, { type: 'start' })).toBe('mix-styles');
    h.act(HOST, {
      type: 'update-settings',
      mixStyles: ['one-word', 'quote', 'act', 'describe-badly'],
      mixFresh: true,
    });
    h.act(HOST, { type: 'start' });
    expect(h.state.round!.styles).toHaveLength(3);
  });

  it('TV plays shows to one of each TV genre', () => {
    const h = started(4, { settings: { deck: 'tv' } });
    expect(h.state.goal).toBe('tv');
    expect(h.state.deck.every((c) => c.id.startsWith('s1:'))).toBe(true);
    expect(progressOf(h.state, 'a').need).toBe(8);
  });
});

describe('Name the Cast', () => {
  it('is a style the host can tick in Mix', () => {
    const h = harness(4, { settings: { mode: 'mix', mixStyles: ['one-word', 'cast', 'quote'] } });
    h.act(HOST, { type: 'start' });
    expect(h.state.round!.styles).toEqual(['one-word', 'quote', 'cast']);
  });

  it('replaces Describe It Badly on Voice call squares when the host picks it', () => {
    expect(started(4, { settings: { mode: 'voice' } }).state.round!.styles).toEqual([
      'one-word',
      'quote',
      'describe-badly',
    ]);
    const h = started(4, { settings: { mode: 'voice', actAlt: 'cast' } });
    expect(h.state.round!.styles).toEqual(['one-word', 'quote', 'cast']);
  });

  /** The squares as the describer sees them, everyone on a call. */
  function onCallSquares(settings: Partial<Settings>, unset = false) {
    const h = harness(4, { settings });
    for (const id of ['p1', 'p2', 'p3', 'p4']) h.act(id, { type: 'on-call', onCall: true });
    // A room saved before the choice existed has no actAlt at all.
    if (unset) delete h.state.settings.actAlt;
    h.act(HOST, { type: 'start' });
    if (h.state.round?.stage === 'countdown') h.tick();
    const [a] = pair(h);
    winFaceOff(h, a);
    keepAndPlace(h);
    const team = h.state.round!.turn!.team;
    const describer = h.state.round!.pair[team];
    return cliffhanger.view(h.state, describer).round!.board[team]!.map((x) => [x.style, x.plays]);
  }

  it('is what Act It becomes for a player on a call when picked; saved rooms keep Describe It Badly', () => {
    expect(onCallSquares({ actAlt: 'cast' })).toContainEqual(['act', 'cast']);
    expect(onCallSquares({ actAlt: 'cast' }, true)).toContainEqual(['act', 'describe-badly']);
    expect(onCallSquares({})).toContainEqual(['act', 'describe-badly']);
  });
});

describe('choosing the genres', () => {
  const lobby = (h: Harness) => cliffhanger.view(h.state, HOST);

  it('defaults to the first eight films or the eight TV genres, one of each', () => {
    const h = harness(4);
    expect(lobby(h).target).toEqual({ genres: BASE_GENRES, each: 1 });
    h.act(HOST, { type: 'update-settings', deck: 'tv' });
    expect(lobby(h).target).toEqual({ genres: TV_GENRE_IDS, each: 1 });
  });

  it('the film presets set the chips and how many of each', () => {
    const h = harness(4);
    h.act(HOST, { type: 'update-settings', goal: 'returns' });
    expect(lobby(h).target).toEqual({ genres: RETURNS_GENRES, each: 2 });
    h.act(HOST, { type: 'update-settings', goal: 'all' });
    expect(lobby(h).target).toEqual({ genres: FILM_GENRE_IDS, each: 1 });
  });

  it('keeps loading a room saved with only a film goal, in the lobby and mid-game', () => {
    const h = harness(4);
    const { filmGenres: _f, each: _e, ...old } = { ...h.state.settings, goal: 'returns' as const };
    expect(goalFor(old)).toEqual({ genres: RETURNS_GENRES, each: 2 });
    const g = started(4);
    const { target: _t, ...saved } = { ...g.state, goal: 'all' as const };
    expect(goalNow(saved)).toEqual(GOALS.all);
  });

  it('keeps at least four genres, all of the deck', () => {
    const h = harness(4);
    expect(h.refuse(HOST, { type: 'update-settings', genres: ['action', 'drama', 'comedy'] })).toBe(
      'too-few-genres',
    );
    expect(
      h.refuse(HOST, { type: 'update-settings', genres: ['action', 'drama', 'comedy', 'crime'] }),
    ).toBe('unknown-genre');
    h.act(HOST, { type: 'update-settings', deck: 'tv' });
    h.act(HOST, { type: 'update-settings', genres: ['crime', 'reality', 'action', 'drama'] });
    // Kept in table order, per deck.
    expect(h.state.settings.tvGenres).toEqual(['action', 'drama', 'crime', 'reality']);
    expect(lobby(h).target.genres).toEqual(['action', 'drama', 'crime', 'reality']);
    h.act(HOST, { type: 'update-settings', deck: 'films' });
    expect(lobby(h).target.genres).toEqual(BASE_GENRES);
  });

  it('the goal is exactly the genres on: other films leave the deck, categories stay', () => {
    const picked = ['action', 'drama', 'comedy', 'horror', 'animation', 'heart', 'adult'];
    const h = harness(4);
    h.act(HOST, { type: 'update-settings', genres: picked, each: 2 });
    expect(h.refuse(HOST, { type: 'start' })).toBe('too-few-titles');
    h.act(HOST, { type: 'update-settings', each: 1 });
    h.act(HOST, { type: 'start' });
    expect(new Set(h.state.deck.map((c) => c.genre))).toEqual(new Set(picked));
    expect(progressOf(h.state, 'a').need).toBe(7);
    expect(h.state.categories).toHaveLength(CATEGORIES.length);
    // Fixed for the game: the settings can't move it now.
    expect(goalNow(h.state)).toEqual({
      genres: FILM_GENRE_IDS.filter((g) => picked.includes(g)),
      each: 1,
    });
  });

  it('flags a genre with too few titles and refuses to start until it has more or is off', () => {
    const pack = [
      ...films(10, BASE_GENRES.slice(0, 7)),
      ...films(9, ['scifi']),
      ...films(25, RETURNS_GENRES),
    ];
    const h = harness(4, { packs: { films: pack, categories: CATEGORIES } });
    h.act(HOST, { type: 'update-settings', turnSeconds: 45 });
    expect(lobby(h).genreCounts).toMatchObject({ action: 10, scifi: 9, heart: 25 });
    expect(h.refuse(HOST, { type: 'start' })).toBe('too-few-titles');
    // Two of each needs twenty a genre.
    h.act(HOST, { type: 'update-settings', goal: 'returns' });
    h.act(HOST, { type: 'start' });
    expect(h.state.phase).toBe('playing');
    const g = harness(4, { packs: { films: pack, categories: CATEGORIES } });
    g.act(HOST, { type: 'update-settings', genres: BASE_GENRES.filter((x) => x !== 'scifi') });
    g.act(HOST, { type: 'start' });
    expect(g.state.phase).toBe('playing');
    expect(cliffhanger.view(g.state, HOST)).toMatchObject({ genreCounts: null });
  });

  it('names the thin genres when the chosen packs hold titles but none in the goal', () => {
    // A pack of only the four extra genres, with the first eight picked.
    const extra = FILM_GENRE_IDS.filter((g) => !BASE_GENRES.includes(g));
    const h = harness(4, { packs: { films: films(12, extra) } });
    expect(() => h.act(HOST, { type: 'start' })).toThrow(
      /too-few-titles: Too few films in Action, .*Fantasy/,
    );
  });

  it('a big pack still deals every genre’s titles into the capped deck', () => {
    const pack = [...films(400, ['action']), ...films(10, BASE_GENRES.slice(1))];
    const h = started(4, { packs: { films: pack, categories: CATEGORIES } });
    // At the first face-off nothing is drawn yet.
    expect(h.state.deck).toHaveLength(DECK_CAP);
    for (const g of BASE_GENRES.slice(1)) {
      expect(h.state.deck.filter((c) => c.genre === g).length, g).toBe(10);
    }
  });
});

describe('the face-off', () => {
  it('counts down, flips, and either player answers first; then they alternate', () => {
    const h = harness(4);
    h.act(HOST, { type: 'start' });
    expect(h.state.round!.stage).toBe('countdown');
    expect(h.state.round!.stageEnds).toBe(NOW + COUNTDOWN_MS);
    h.tick();
    const [a, b] = pair(h);
    expect(h.state.round!.stage).toBe('faceoff');
    expect(h.state.round!.category!.text).toMatch(/Made-up category/);
    expect(h.state.round!.faceoff!.deadline).toBeNull();
    h.act(b, { type: 'said' });
    expect(h.refuse(b, { type: 'said' })).toBe('not-your-turn');
    expect(h.refuse('p3', { type: 'said' })).toBe('not-in-faceoff');
    h.act(a, { type: 'said' });
    expect(h.state.round!.faceoff!.answers).toBe(2);
    expect(h.state.round!.faceoff!.on).toBe(b);
    h.tick();
    expect(h.state.round!.faceoffResult).toMatchObject({
      winner: a,
      loser: b,
      how: 'time',
      answers: 2,
    });
    expect(h.state.round!.stage).toBe('keep');
    expect(h.state.round!.order).toEqual(['a', 'b']);
  });

  it('new category only before the first answer', () => {
    const h = started();
    const [a] = pair(h);
    const first = h.state.round!.category!.id;
    h.act(a, { type: 'new-category' });
    expect(h.state.round!.category!.id).not.toBe(first);
    h.act(a, { type: 'said' });
    expect(h.refuse(a, { type: 'new-category' })).toBe('answered');
  });

  it('the opening clock flips a new category for the same pair', () => {
    const h = started(4, { settings: { openingClock: true } });
    const first = h.state.round!.category!.id;
    const players = pair(h);
    h.tick();
    expect(h.state.round!.stage).toBe('faceoff');
    expect(h.state.round!.category!.id).not.toBe(first);
    expect(pair(h)).toEqual(players);
  });

  it('the face-off is a straight rally: nobody pauses it, every press gives the other full time', () => {
    const h = started();
    const [a, b] = pair(h);
    h.act(a, { type: 'said' });
    h.wait(5000);
    for (const type of ['pause', 'concede', 'stands']) {
      expect(cliffhanger.actionSchema.safeParse({ type }).success).toBe(false);
    }
    expect(cliffhanger.actionSchema.safeParse({ type: 'rule', stands: false }).success).toBe(false);
    h.act(b, { type: 'said' });
    expect(h.state.round!.faceoff!.deadline).toBe(h.now + 15_000);
    h.tick();
    expect(h.state.round!.faceoffResult).toMatchObject({ winner: b, loser: a, how: 'time' });
  });

  it('a room saved with Challenge on and a paused face-off loads and plays on', () => {
    const h = started();
    const [a, b] = pair(h);
    h.act(a, { type: 'said' });
    const r = h.state.round!;
    // As an older release saved it: paused with 7 s left, and the old Challenge setting.
    h.state = {
      ...h.state,
      settings: { ...h.state.settings, challenge: true } as typeof h.state.settings,
      round: {
        ...r,
        faceoff: { ...r.faceoff!, deadline: null, before: null, paused: { by: b, left: 7000 } },
      } as typeof r,
    };
    h.wait(60_000);
    h.tick();
    const fo = h.state.round!.faceoff!;
    expect(fo).toMatchObject({ on: b, answers: 1, deadline: h.now + 7000 });
    expect('paused' in fo).toBe(false);
    h.act(b, { type: 'said' });
    h.tick();
    expect(h.state.round!.faceoffResult).toMatchObject({ winner: b, how: 'time' });
  });
});

describe('cards and turns', () => {
  it('the winner keeps three (easiest auto-filled), the loser gets the other three', () => {
    const h = started();
    const [a, b] = pair(h);
    winFaceOff(h, a);
    const hand = h.state.round!.hands[a]!;
    expect(hand.offered).toHaveLength(6);
    const pick = hand.offered.slice(3).map((c) => c.id);
    h.act(a, { type: 'lock', slots: [pick[0]!, null, pick[1]!] });
    const board = h.state.round!.board.a!;
    expect(board.map((s) => s.card.id)).toContain(pick[0]);
    expect(board[2]!.card.id).toBe(pick[1]);
    const loser = h.state.round!.hands[b]!;
    expect(loser.offered).toHaveLength(3);
    expect(loser.deadline).toBe(h.now + PLACE_MS);
    expect(h.state.round!.stage).toBe('countdown');
  });

  it('placing runs out: cards are placed for you', () => {
    const h = started();
    const [a] = pair(h);
    winFaceOff(h, a);
    h.tick();
    expect(h.state.round!.board.a).toHaveLength(3);
  });

  it('a turn: Got it, steals after your own three, unguessed cards are thrown away', () => {
    const h = started();
    const [a, b] = pair(h);
    winFaceOff(h, a);
    keepAndPlace(h);
    expect(h.state.round!.stage).toBe('turn');
    const turn = h.state.round!.turn!;
    expect(turn.describer).toBe(a);
    const own = gettable(h);
    expect(h.refuse('p3', { type: 'got', card: own[0]! })).toBe('not-describer');
    h.act(a, { type: 'got', card: own[0]! });
    h.act(a, { type: 'got', card: own[1]! });
    // The other team's cards are closed until all three are got.
    expect(h.state.round!.turn!.stealOpen).toBe(false);
    h.act(a, { type: 'got', card: own[2]! });
    expect(h.state.round!.turn!.stealOpen).toBe(true);
    expect(h.state.round!.hands[b]).toBeUndefined();
    const steal = gettable(h);
    expect(steal).toHaveLength(3);
    h.act(a, { type: 'got', card: steal[0]! });
    h.tick();
    expect(h.state.collections.a).toHaveLength(4);
    expect(h.state.round!.stage).toBe('recap');
    h.tick();
    h.tick();
    expect(h.state.round!.turn!.describer).toBe(b);
    expect(gettable(h)).toHaveLength(2);
    h.tick();
    expect(h.state.round!.number).toBe(2);
    expect(h.state.discard).toHaveLength(2);
  });

  it('Got it can be taken back for three seconds', () => {
    const h = started();
    const [a] = pair(h);
    winFaceOff(h, a);
    keepAndPlace(h);
    const [card] = gettable(h);
    h.act(a, { type: 'got', card: card! });
    h.act(a, { type: 'undo', card: card! });
    expect(gettable(h)).toContain(card);
    h.act(a, { type: 'got', card: card! });
    h.wait(4000);
    expect(h.refuse(a, { type: 'undo', card: card! })).toBe('too-late');
  });

  it('a turn saved with fouls loads and plays on; Foul is gone', () => {
    const h = started();
    const [a, b] = pair(h);
    winFaceOff(h, a);
    keepAndPlace(h);
    const r = h.state.round!;
    h.state = {
      ...h.state,
      round: { ...r, turn: { ...r.turn!, fouls: [{ by: b, at: h.now }] } } as typeof r,
    };
    expect(cliffhanger.actionSchema.safeParse({ type: 'foul' }).success).toBe(false);
    const [card] = gettable(h);
    h.act(a, { type: 'got', card: card! });
    expect(h.state.round!.turn!.gots).toEqual([card]);
  });

  it('pairs rotate through each team', () => {
    const h = started(6);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(...pair(h));
      winFaceOff(h, pair(h)[0]);
      keepAndPlace(h);
      finishRound(h);
    }
    expect(seen).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  });
});

describe('three for one and winning', () => {
  it('trades three of a genre for any card of the other team, once a round', () => {
    const h = started();
    const pick = (genre: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `x:${genre}${i}`,
        title: `T ${genre}${i}`,
        genre,
      }));
    h.state = {
      ...h.state,
      collections: { a: pick('action', 3), b: pick('drama', 1) },
    };
    expect(stealGenres(h.state, 'a')).toEqual(['action']);
    expect(stealGenres(h.state, 'b')).toEqual([]);
  });

  it('the first team to complete the goal wins as its turn ends', () => {
    const h = started();
    const [a] = pair(h);
    const have = ['action', 'classics', 'drama', 'comedy', 'horror', 'family', 'animation'].map(
      (g) => ({
        id: `x:${g}`,
        title: `T ${g}`,
        genre: g,
      }),
    );
    h.state = { ...h.state, collections: { a: have, b: [] } };
    winFaceOff(h, a);
    h.state = {
      ...h.state,
      round: {
        ...h.state.round!,
        hands: {
          [a]: {
            ...h.state.round!.hands[a]!,
            offered: [
              { id: 'f1:s0', title: 'Last', genre: 'scifi' },
              ...h.state.round!.hands[a]!.offered.slice(1),
            ],
          },
        },
      },
    };
    h.act(a, { type: 'lock', slots: ['f1:s0', null, null] });
    h.tick();
    h.act(a, { type: 'got', card: 'f1:s0' });
    while (h.state.phase === 'playing' && h.state.round!.turn?.team === 'a') h.tick();
    expect(h.state.phase).toBe('over');
    expect(h.state.winner).toBe('a');
  });

  it('a whole game always moves on: steals, a skipped turn, discards, the 3-for-1, a win', () => {
    // Popcorn wins every face-off. On odd rounds its describer clears its three and steals all of
    // the other side's, so the other turn has nothing left; on even rounds it stops after its own
    // three and the other side gets one, missing the rest. Popcorn starts with three action
    // films and Nachos with one, so the 3-for-1 comes at the first round's end.
    const h = started(4, { settings: { comebackPick: true } });
    const own = (genre: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `x:${genre}${i}`,
        title: `T ${genre}${i}`,
        genre,
      }));
    h.state = { ...h.state, collections: { a: own('action', 3), b: own('drama', 1) } };
    const seen = new Set<string>();
    for (let i = 0; i < 500 && h.state.phase === 'playing'; i++) {
      const r = h.state.round!;
      seen.add(r.stage);
      if (r.stage === 'pick-category') {
        h.act(r.pick!.by, { type: 'pick-category', id: r.pick!.options[0]!.id });
      } else if (r.stage === 'faceoff' && r.faceoff!.answers === 0) {
        // Waiting for the first answer with no clock (the opening clock is off): a press moves on.
        expect(nextDeadline(h.state)).toBeNull();
        winFaceOff(h, r.pair.a);
      } else if (r.stage === 'keep') {
        keepAndPlace(h);
      } else if (r.stage === 'turn') {
        const turn = r.turn!;
        const cards = gettable(h);
        if (turn.team === 'b') {
          if (cards.length === 3) h.act(turn.describer, { type: 'got', card: cards[0]! });
          h.tick();
        } else if (turn.stealOpen && r.number % 2 === 0) {
          h.tick();
        } else {
          if (turn.stealOpen) seen.add('stolen');
          h.act(turn.describer, { type: 'got', card: cards[0]! });
        }
      } else if (r.stage === 'steal') {
        const team = r.steal!.queue[0]!;
        const theirs = h.state.collections[team === 'a' ? 'b' : 'a'];
        const genre = stealGenres(h.state, team)[0]!;
        h.act(r.pair[team], { type: 'steal', genre, card: theirs[0]!.id });
        seen.add('traded');
      } else {
        const left = [...(r.board.a ?? []), ...(r.board.b ?? [])].filter((x) => !x.got);
        if (r.stage === 'countdown' && r.turnNo === 1 && left.length === 0) seen.add('skipped');
        h.tick();
      }
    }
    expect(h.state.phase).toBe('over');
    expect(h.state.winner).toBe('a');
    expect(h.state.round!.number).toBeGreaterThan(2);
    expect(h.state.discard.length).toBeGreaterThan(0);
    for (const step of ['pick-category', 'faceoff', 'keep', 'turn', 'recap', 'stolen', 'skipped']) {
      expect(seen, step).toContain(step);
    }
    expect(seen, 'traded').toContain('traded');
    expect(h.state.collections.b.map((c) => c.id)).not.toContain('x:drama0');
  });

  it('a team down to one player ends the game with no winner', () => {
    const h = started(4);
    h.state = cliffhanger.playerLeft(h.state, 'p3', h.now);
    expect(h.state.phase).toBe('over');
    expect(h.state.endReason).toBe('too-few');
    expect(h.state.winner).toBeNull();
  });

  it('a leaving face-off player is replaced by the next teammate', () => {
    const h = started(6);
    const [a] = pair(h);
    h.state = cliffhanger.playerLeft(h.state, a, h.now);
    expect(h.state.phase).toBe('playing');
    expect(h.state.round!.pair.a).toBe('p3');
  });

  it('films the packs repeat are dealt once; the room draws unseen titles first', () => {
    const h = started(4, {
      packs: { films: [...films(10), ...films(10)], categories: CATEGORIES },
    });
    const titles = h.state.deck.map((c) => c.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('the sound follows the table until the host picks, and may change mid-game', () => {
    const h = started(4);
    expect(soundModeIn(h.state.settings, false)).toBe('host');
    expect(soundModeIn(h.state.settings, true)).toBe('stage');
    expect(soundModeIn({ ...h.state.settings, mode: 'video' }, false)).toBe('all');
    expect(h.refuse(HOST, { type: 'update-settings', sound: 'all', turnSeconds: 45 })).toBe(
      'in-progress',
    );
    h.act(HOST, { type: 'update-settings', sound: 'off' });
    expect(soundModeIn(h.state.settings, true)).toBe('off');
    expect(h.refuse('p2', { type: 'table-volume', volumes: { master: 0.5 } })).toBe('not-host');
    h.act(HOST, { type: 'table-volume', volumes: { master: 0.5 } });
    expect(h.state.settings.tableVolumes.master).toBe(0.5);
  });
});
