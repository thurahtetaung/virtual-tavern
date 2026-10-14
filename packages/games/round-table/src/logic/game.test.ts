import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { legalSlots, roundTable } from './game.ts';
import {
  EVIL_COUNT,
  PRESETS,
  TEAM_SIZE,
  deal,
  failsNeeded,
  fitDeck,
  knowledgeFor,
  presetDeck,
  validateSetup,
} from './setup.ts';
import { ROLES, loyaltyOf } from './roles.ts';
import {
  HOST,
  NOW,
  deadline,
  game,
  harness,
  ids,
  leave,
  playAll,
  propose,
  questRound,
  rigged,
  voteAll,
} from './test-utils.ts';
import type { RoleId } from './types.ts';

const BASE5: RoleId[] = ['merlin', 'servant', 'servant', 'assassin', 'minion'];

describe('setup', () => {
  it('splits Good and Evil and sizes quests by table size (spec 1–3)', () => {
    expect(EVIL_COUNT).toEqual({ 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 });
    expect(TEAM_SIZE[5]).toEqual([2, 3, 2, 3, 3]);
    expect(TEAM_SIZE[10]).toEqual([3, 4, 4, 5, 5]);
    for (let n = 5; n <= 10; n++)
      for (let q = 0; q < 5; q++) expect(failsNeeded(n, q)).toBe(n >= 7 && q === 3 ? 2 : 1);
    const deck = presetDeck('first', 5);
    expect(deck).toEqual(['merlin', 'servant', 'servant', 'assassin', 'minion']);
    expect(presetDeck('first', 10).filter((r) => loyaltyOf(r) === 'evil')).toHaveLength(4);
  });

  it('every preset is valid at every table size', () => {
    for (const p of PRESETS)
      for (let n = 5; n <= 10; n++) {
        const deck = presetDeck(p.id, n);
        expect(deck, `${p.id} ${n}`).toHaveLength(n);
        expect(validateSetup(deck, n).errors, `${p.id} ${n}`).toEqual([]);
        expect(deck.filter((r) => loyaltyOf(r) === 'evil')).toHaveLength(EVIL_COUNT[n]!);
      }
    // Classic+ at 6: Morgana acts as the Assassin.
    expect(presetDeck('classic-plus', 6)).toEqual([
      'merlin',
      'percival',
      'servant',
      'servant',
      'morgana',
      'mordred',
    ]);
  });

  it('explains what is wrong with a deck, and warns about odd ones (spec 8–9)', () => {
    expect(validateSetup(BASE5, 4).errors[0]).toBe('5 players are needed (4 so far).');
    expect(validateSetup(['merlin', 'servant', 'assassin', 'minion', 'minion'], 5).errors).toEqual([
      'Too much Evil: 5 players need 3 Good and 2 Evil.',
    ]);
    expect(validateSetup(['merlin', 'merlin', 'servant', 'assassin', 'minion'], 5).errors).toEqual([
      'Only one Merlin can play.',
    ]);
    expect(validateSetup(BASE5.slice(0, 4), 5).errors).toEqual([
      'The deck has 4 cards for 5 players.',
    ]);
    expect(
      validateSetup(['merlin', 'servant', 'servant', 'assassin', 'morgana'], 5).notes,
    ).toContain('Morgana needs Percival: without him she plays as a plain Minion.');
    expect(
      validateSetup(['merlin', 'percival', 'servant', 'assassin', 'minion'], 5).notes,
    ).toContain('With 5 players and Percival, add Morgana or Mordred to keep Evil in the game.');
    expect(
      validateSetup(['servant', 'servant', 'servant', 'minion', 'minion'], 5).notes[0],
    ).toMatch(/No Merlin/);
  });

  it('fits a custom deck to the table: plain cards come and go, specials stay', () => {
    expect(fitDeck(['merlin', 'percival', 'morgana', 'assassin'], 7)).toEqual([
      'merlin',
      'percival',
      'servant',
      'servant',
      'assassin',
      'morgana',
      'minion',
    ]);
    expect(fitDeck(['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion'], 5)).toEqual(
      BASE5,
    );
  });

  it('deals a random leader with the Lady on their right (spec 23)', () => {
    for (let seed = 1; seed < 20; seed++) {
      const players = ids(8);
      const d = deal(players, presetDeck('first', 8), createRng(seed));
      const li = players.indexOf(d.leader);
      expect(d.ladyHolder).toBe(players[(li + 7) % 8]);
    }
  });

  it('designates an Assassin from Evil (never Oberon) when there is no Assassin card (spec 10)', () => {
    const deck: RoleId[] = ['merlin', 'percival', 'servant', 'servant', 'morgana', 'mordred'];
    const seen = new Set<RoleId>();
    for (let seed = 1; seed < 40; seed++) {
      const d = deal(ids(6), deck, createRng(seed));
      expect(d.designated).toBe(true);
      seen.add(d.roles[d.assassin!]!);
    }
    expect([...seen].sort()).toEqual(['mordred', 'morgana']);
    for (let seed = 1; seed < 20; seed++) {
      const d = deal(
        ids(6),
        ['merlin', 'servant', 'servant', 'servant', 'oberon', 'minion'],
        createRng(seed),
      );
      expect(d.roles[d.assassin!]).toBe('minion');
    }
    const none = deal(ids(5), ['servant', 'servant', 'servant', 'minion', 'minion'], createRng(1));
    expect(none.assassin).toBeNull();
  });
});

describe('what each role knows', () => {
  const know = (roles: RoleId[], viewer: string, oberonHidden = false) => {
    const players = ids(roles.length);
    const g = {
      players,
      roles: Object.fromEntries(players.map((p, i) => [p, roles[i]!])),
      oberonHidden,
    };
    return knowledgeFor(g, viewer);
  };

  it('Merlin sees Evil but not Mordred (spec 4)', () => {
    const roles: RoleId[] = [
      'merlin',
      'servant',
      'servant',
      'servant',
      'assassin',
      'mordred',
      'minion',
    ];
    expect(know(roles, HOST)).toEqual([
      { id: 'dee', as: 'evil' },
      { id: 'fin', as: 'evil' },
    ]);
  });

  it('Oberon: Merlin sees him, Evil does not, he sees nobody (spec 5)', () => {
    const roles: RoleId[] = [
      'merlin',
      'servant',
      'servant',
      'servant',
      'assassin',
      'oberon',
      'minion',
    ];
    expect(know(roles, HOST).map((k) => k.id)).toEqual(['dee', 'eve', 'fin']);
    expect(know(roles, 'dee')).toEqual([{ id: 'fin', as: 'evil' }]);
    expect(know(roles, 'eve')).toEqual([]);
    // The FAQ reading hides him from Merlin.
    expect(know(roles, HOST, true).map((k) => k.id)).toEqual(['dee', 'fin']);
  });

  it('Percival sees Merlin and Morgana alike, in seat order (spec 6–7)', () => {
    const roles: RoleId[] = [
      'morgana',
      'percival',
      'merlin',
      'servant',
      'servant',
      'servant',
      'assassin',
      'minion',
    ];
    expect(know(roles, 'ana')).toEqual([
      { id: HOST, as: 'magic' },
      { id: 'ben', as: 'magic' },
    ]);
    expect(know(['merlin', 'percival', 'servant', 'assassin', 'minion'], 'ana')).toEqual([
      { id: HOST, as: 'magic' },
    ]);
  });

  it('Evil sees fellow Evil only as “evil”, never by role (spec 11); servants see nothing', () => {
    const roles: RoleId[] = ['merlin', 'servant', 'servant', 'assassin', 'morgana'];
    expect(know(roles, 'cy')).toEqual([{ id: 'dee', as: 'evil' }]);
    expect(know(roles, 'ana')).toEqual([]);
  });

  it('the view sends your own card and only that', () => {
    const h = rigged(['merlin', 'servant', 'servant', 'assassin', 'minion']);
    const v = h.view(HOST);
    expect(v.role).toMatchObject({ role: 'merlin', loyalty: 'good', cards: ['success'] });
    expect(v.role!.known.map((k) => k.id)).toEqual(['cy', 'dee']);
    expect(h.view('dee').role).toMatchObject({ role: 'minion', cards: ['success', 'fail'] });
    expect(h.view('cy').role).toMatchObject({ assassin: true, designated: false });
    expect(h.view(null).role).toBeNull();
  });
});

describe('reading role cards', () => {
  it('waits for everyone to read their card, then the leader proposes', () => {
    const h = rigged(BASE5, { ready: false });
    expect(h.state.stage).toBe('reveal');
    h.act({ type: 'ready' }, HOST);
    h.act({ type: 'ready' }, HOST);
    expect(game(h).ready).toEqual([HOST]);
    expect(h.reject({ type: 'propose', team: [HOST, 'ana'] })).toBe('wrong-stage');
    for (const p of ['ana', 'ben', 'cy']) h.act({ type: 'ready' }, p);
    // The host steps in for someone who wandered off.
    expect(h.reject({ type: 'skip', player: 'dee' }, 'ana')).toBe('not-host');
    h.act({ type: 'skip', player: 'dee' });
    expect(h.state.stage).toBe('propose');
  });
});

describe('proposals and votes', () => {
  it('builds a team live, announces it, then the leader calls the vote', () => {
    const h = rigged(BASE5);
    expect(h.reject({ type: 'pick', player: 'ana' }, 'ana')).toBe('not-leader');
    h.act({ type: 'pick', player: 'ana' });
    h.act({ type: 'pick', player: 'ben' });
    expect(h.view('cy').game!.draft).toEqual(['ana', 'ben']);
    expect(h.reject({ type: 'pick', player: 'cy' })).toBe('team-full');
    h.act({ type: 'pick', player: 'ben' });
    expect(game(h).draft).toEqual(['ana']);
    expect(h.reject({ type: 'propose' })).toBe('team-size');
    h.act({ type: 'pick', player: HOST });
    expect(h.reject({ type: 'call-vote' })).toBe('wrong-stage');
    h.act({ type: 'propose' });
    // Announced: the table talks it over, and the team stays on show.
    expect(h.state.stage).toBe('discuss');
    expect(h.view('cy').game!.draft).toEqual(['ana', HOST]);
    expect(h.view('cy').game!.vote).toBeNull();
    expect(h.reject({ type: 'vote', approve: true }, 'cy')).toBe('wrong-stage');
    expect(h.reject({ type: 'pick', player: 'cy' })).toBe('wrong-stage');
    expect(h.reject({ type: 'call-vote' }, 'ana')).toBe('not-leader');
    expect(h.reject({ type: 'edit-team' }, 'ana')).toBe('not-leader');
    // The leader can take it back and change it.
    h.act({ type: 'edit-team' });
    expect(h.state.stage).toBe('propose');
    expect(game(h).draft).toEqual(['ana', HOST]);
    h.act({ type: 'pick', player: HOST });
    h.act({ type: 'pick', player: 'cy' });
    h.act({ type: 'propose' });
    h.act({ type: 'call-vote' });
    expect(h.state.stage).toBe('vote');
    expect(game(h).team).toEqual(['ana', 'cy']);
  });

  it('refuses a wrong-size or duplicate team (spec 16)', () => {
    const h = rigged(BASE5);
    expect(h.reject({ type: 'propose', team: ['ana'] })).toBe('team-size');
    expect(h.reject({ type: 'propose', team: ['ana', 'ana'] })).toBe('duplicate');
    expect(h.reject({ type: 'propose', team: ['ana', 'zed'] })).toBe('bad-player');
    expect(h.reject({ type: 'propose', team: ['ana', 'ben'] }, 'ana')).toBe('not-leader');
  });

  it('a tie rejects and the lead passes (spec 13)', () => {
    const h = rigged(['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion']);
    propose(h, [HOST, 'ana']);
    voteAll(h, ['cy', 'dee', 'eve']);
    expect(h.state.stage).toBe('propose');
    expect(game(h).rejections).toBe(1);
    expect(game(h).leader).toBe('ana');
    expect(game(h).proposals[0]).toMatchObject({ approved: false, attempt: 1, round: 1 });
  });

  it('five rejections in a round hand Evil the game (spec 14)', () => {
    const h = rigged(BASE5);
    for (let i = 0; i < 4; i++) {
      propose(h, [HOST, 'ana']);
      voteAll(h, ['ana', 'ben', 'cy']);
    }
    expect(h.view(HOST).game!.hammer).toBe(game(h).leader);
    propose(h, [HOST, 'ana']);
    voteAll(h, ['ana', 'ben', 'cy']);
    expect(h.state.phase).toBe('over');
    expect(game(h)).toMatchObject({ winner: 'evil', reason: 'rejections' });
    expect(game(h).results).toEqual([]);
  });

  it('four rejections then an approval: the quest runs and the track resets (spec 15)', () => {
    const h = rigged(BASE5);
    for (let i = 0; i < 4; i++) {
      propose(h, [HOST, 'ana']);
      voteAll(h, [HOST, 'ana', 'ben']);
    }
    expect(game(h).rejections).toBe(4);
    propose(h, [HOST, 'ana']);
    voteAll(h);
    expect(h.state.stage).toBe('quest');
    playAll(h);
    expect(game(h).rejections).toBe(0);
    expect(game(h).results[0]).toMatchObject({ success: true, fails: 0 });
  });

  it('lets a voter change their mind until the last vote is in', () => {
    const h = rigged(BASE5);
    propose(h, [HOST, 'ana']);
    h.act({ type: 'vote', approve: false }, 'ana');
    h.act({ type: 'vote', approve: true }, 'ana');
    expect(h.view('ana').game!.vote!.myVote).toBe(true);
  });
});

describe('quests', () => {
  it('Good can only play Success; Evil may Fail (spec 17, 19)', () => {
    const h = rigged(BASE5);
    propose(h, ['ana', 'dee']);
    voteAll(h);
    expect(h.reject({ type: 'play', card: 'fail' }, 'ana')).toBe('illegal-card');
    expect(h.reject({ type: 'play', card: 'success' }, 'ben')).toBe('not-on-team');
    h.act({ type: 'play', card: 'fail' }, 'dee');
    expect(h.reject({ type: 'play', card: 'success' }, 'dee')).toBe('played');
    h.act({ type: 'play', card: 'success' }, 'ana');
    expect(game(h).results[0]).toEqual({
      round: 1,
      slot: 0,
      team: ['ana', 'dee'],
      fails: 1,
      success: false,
      autoPlayed: [],
    });
    expect(game(h).cards).toEqual({});
  });

  it('quest 4 needs two Fails at 7 players (spec 18)', () => {
    const roles: RoleId[] = [
      'merlin',
      'servant',
      'servant',
      'servant',
      'assassin',
      'minion',
      'minion',
    ];
    const h = rigged(roles);
    questRound(h, [HOST, 'ana']);
    questRound(h, [HOST, 'ana', 'ben'], []);
    questRound(h, ['eve', 'ana', 'ben'], ['eve']);
    questRound(h, ['eve', 'ana', 'ben', 'cy'], ['eve']);
    expect(game(h).results[3]).toMatchObject({ fails: 1, success: true });
    expect(h.state.stage).toBe('assassinate');
    const h2 = rigged(roles);
    questRound(h2, [HOST, 'ana']);
    questRound(h2, ['eve', 'ana', 'ben'], ['eve']);
    questRound(h2, ['eve', 'ana', 'ben'], []);
    questRound(h2, ['eve', 'fin', 'ben', 'cy'], ['eve', 'fin']);
    expect(game(h2).results[3]).toMatchObject({ fails: 2, success: false });
  });

  it('three successes without Merlin: Good wins outright (spec 20)', () => {
    const h = rigged(['servant', 'servant', 'servant', 'minion', 'minion']);
    questRound(h, [HOST, 'ana']);
    questRound(h, [HOST, 'ana', 'ben']);
    questRound(h, [HOST, 'ana']);
    expect(h.state.phase).toBe('over');
    expect(game(h)).toMatchObject({ winner: 'good', reason: 'quests' });
  });

  it('three successes with Merlin: the Assassin names him (spec 21)', () => {
    const play = (target: string) => {
      const h = rigged(BASE5);
      questRound(h, [HOST, 'ana']);
      questRound(h, [HOST, 'ana', 'ben']);
      questRound(h, [HOST, 'ana']);
      expect(h.state.stage).toBe('assassinate');
      expect(h.view('ana').game!.assassin).toBe('cy');
      expect(h.reject({ type: 'assassinate', target: HOST }, 'dee')).toBe('not-assassin');
      expect(h.reject({ type: 'assassinate', target: 'cy' }, 'cy')).toBe('self');
      h.act({ type: 'assassinate', target }, 'cy');
      return game(h);
    };
    expect(play(HOST)).toMatchObject({ winner: 'evil', reason: 'assassin-hit', target: HOST });
    expect(play('ana')).toMatchObject({ winner: 'good', reason: 'assassin-missed' });
  });

  it('a designated assassin makes the pick (spec 10)', () => {
    const h = rigged(['merlin', 'percival', 'servant', 'servant', 'morgana', 'mordred']);
    expect(game(h).designated).toBe(true);
    const who = game(h).assassin!;
    expect(h.view(who).role).toMatchObject({ assassin: true, designated: true });
    questRound(h, [HOST, 'ana']);
    questRound(h, [HOST, 'ana', 'ben']);
    questRound(h, [HOST, 'ana', 'ben', 'cy']);
    h.act({ type: 'assassinate', target: HOST }, who);
    expect(game(h).winner).toBe('evil');
  });

  it('three failures: Evil wins and the Lady is never used (spec 22)', () => {
    const h = rigged(
      ['merlin', 'servant', 'servant', 'servant', 'servant', 'assassin', 'minion', 'minion'],
      {
        lady: true,
      },
    );
    questRound(h, ['fin', 'ana', 'ben'], ['fin']);
    questRound(h, ['fin', 'ana', 'ben', 'cy'], ['fin']);
    expect(h.state.stage).toBe('lady');
    h.act({ type: 'lady', target: 'ana' }, game(h).ladyState!.holder);
    questRound(h, ['fin', 'ana', 'ben', 'cy'], ['fin']);
    expect(h.state.phase).toBe('over');
    expect(game(h)).toMatchObject({ winner: 'evil', reason: 'fails' });
    expect(game(h).ladyState!.checks).toHaveLength(1);
  });
});

describe('the Lady of the Lake', () => {
  const EIGHT: RoleId[] = [
    'merlin',
    'servant',
    'servant',
    'servant',
    'servant',
    'mordred',
    'oberon',
    'minion',
  ];

  it('checks after quests 2, 3 and 4, never a former holder (spec 24–28)', () => {
    const h = rigged(EIGHT, { lady: true, leader: 'cy' });
    // The Lady starts on the leader's right.
    expect(game(h).ladyState!.holder).toBe('ben');
    questRound(h, ['ana', 'ben', 'cy']);
    expect(h.state.stage).toBe('propose');
    questRound(h, ['ana', 'ben', 'cy', HOST]);
    expect(h.state.stage).toBe('lady');
    expect(h.reject({ type: 'lady', target: 'eve' }, 'ana')).toBe('not-holder');
    expect(h.reject({ type: 'lady', target: 'ben' }, 'ben')).toBe('self');
    h.act({ type: 'lady', target: 'eve' }, 'ben');
    // Mordred shows Evil; only the checker sees it.
    expect(h.view('ben').game!.lady!.mine).toEqual([{ round: 2, target: 'eve', loyalty: 'evil' }]);
    for (const p of ids(8).filter((p) => p !== 'ben')) {
      expect(h.view(p).game!.lady!.mine).toEqual([]);
      expect(JSON.stringify({ ...h.view(p), role: null })).not.toContain('"loyalty"');
    }
    expect(h.view('ana').game!.lady!.checks).toEqual([
      { round: 2, holder: 'ben', target: 'eve', auto: false },
    ]);
    expect(game(h).ladyState!.holder).toBe('eve');
    questRound(h, ['eve', 'ana', 'ben', 'cy'], ['eve']);
    expect(h.reject({ type: 'lady', target: 'ben' }, 'eve')).toBe('former-holder');
    h.act({ type: 'lady', target: 'fin' }, 'eve');
    // Oberon shows Evil by the rulebook.
    expect(h.view('eve').game!.lady!.mine).toEqual([{ round: 3, target: 'fin', loyalty: 'evil' }]);
  });

  it('with the FAQ reading, Oberon shows Good (spec 26, ruling)', () => {
    const h = rigged(EIGHT, { lady: true, leader: 'cy', oberonHidden: true });
    questRound(h, ['ana', 'ben', 'cy']);
    questRound(h, ['ana', 'ben', 'cy', HOST]);
    h.act({ type: 'lady', target: 'fin' }, 'ben');
    expect(h.view('ben').game!.lady!.mine).toEqual([{ round: 2, target: 'fin', loyalty: 'good' }]);
    expect(h.view(HOST).role!.known.map((k) => k.id)).toEqual(['gus']);
  });
});

describe('Targeting', () => {
  const EIGHT: RoleId[] = [
    'merlin',
    'servant',
    'servant',
    'servant',
    'servant',
    'assassin',
    'minion',
    'minion',
  ];

  it('lets the leader pick the quest; quest 5 waits for two successes (spec 42)', () => {
    const h = rigged(EIGHT, { targeting: true });
    expect(legalSlots(game(h))).toEqual([0, 1, 2, 3]);
    expect(h.reject({ type: 'target', slot: 4 })).toBe('bad-quest');
    h.act({ type: 'target', slot: 2 });
    propose(h, ['ana', 'ben', 'cy', 'dee']);
    voteAll(h);
    playAll(h);
    expect(game(h).results[0]).toMatchObject({ slot: 2, success: true });
    expect(h.reject({ type: 'propose', team: ['ana', 'ben', 'cy', 'dee'], slot: 2 }, 'ana')).toBe(
      'bad-quest',
    );
    questRound(h, ['ana', 'ben', 'cy'], [], 0);
    expect(legalSlots(game(h))).toEqual([1, 3, 4]);
  });

  it('quest 4 still needs two Fails when played first (spec 43)', () => {
    const h = rigged(['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion', 'minion'], {
      targeting: true,
    });
    questRound(h, ['eve', 'ana', 'ben', 'cy'], ['eve'], 3);
    expect(game(h).results[0]).toMatchObject({ slot: 3, fails: 1, success: true });
  });

  it('without Targeting the quests go in order', () => {
    const h = rigged(BASE5);
    expect(h.reject({ type: 'target', slot: 2 })).toBe('no-targeting');
    expect(legalSlots(game(h))).toEqual([0]);
  });

  it('always leaves a quest to attempt (spec 4.4)', () => {
    for (let mask = 0; mask < 32; mask++) {
      const results = [0, 1, 2, 3, 4]
        .filter((s) => mask & (1 << s))
        .map((slot, i) => ({ slot, success: i % 2 === 0 }));
      const ok = results.filter((r) => r.success).length;
      if (ok >= 3 || results.length - ok >= 3 || results.length === 5) continue;
      expect(legalSlots({ targeting: true, results }).length, String(mask)).toBeGreaterThan(0);
    }
  });
});

describe('timers', () => {
  const timed = (mode: 'soft' | 'strict') =>
    rigged(BASE5, { settings: { pickSeconds: 60, voteSeconds: 30, timerMode: mode } });

  it('strict: a team is filled in, missing votes approve, missing cards succeed', () => {
    const h = timed('strict');
    expect(game(h).deadline).toBe(NOW + 60_000);
    h.act({ type: 'pick', player: 'dee' });
    deadline(h);
    expect(h.state.stage).toBe('discuss');
    expect(game(h).team).toContain('dee');
    expect(game(h).team).toHaveLength(2);
    expect(game(h).autoTeam).toBe(true);
    // The talk has the leader's clock too; then the vote opens on its own.
    expect(game(h).deadline).toBe(NOW + 120_000);
    deadline(h);
    expect(h.state.stage).toBe('vote');
    h.act({ type: 'vote', approve: false }, 'ana');
    deadline(h);
    const p = game(h).proposals[0]!;
    expect(p).toMatchObject({ approved: true, auto: true });
    expect(p.autoVotes).toEqual([HOST, 'ben', 'cy', 'dee']);
    expect(h.state.stage).toBe('quest');
    deadline(h);
    expect(game(h).results[0]).toMatchObject({ fails: 0, success: true });
    expect(game(h).results[0]!.autoPlayed).toHaveLength(2);
    // Players see only how many were automatic: an auto card is always Success.
    const seen = h.view('ana').game!;
    expect(seen.proposals[0]).toMatchObject({ autoVoteCount: 4, autoVotes: null });
    expect(seen.results[0]).toMatchObject({ autoPlayedCount: 2, autoPlayed: null });
  });

  it('names who the timer played for only at the end', () => {
    const h = timed('strict');
    propose(h, ['ana', 'ben']);
    voteAll(h);
    h.act({ type: 'play', card: 'success' }, 'ana');
    deadline(h);
    expect(game(h).results[0]!.autoPlayed).toEqual(['ben']);
    for (const viewer of [...ids(5), null])
      expect(h.view(viewer).game!.results[0], String(viewer)).toMatchObject({
        autoPlayedCount: 1,
        autoPlayed: null,
      });
    questRound(h, [HOST, 'ana', 'ben']);
    questRound(h, [HOST, 'ana']);
    const assassin = game(h).assassin!;
    h.act({ type: 'assassinate', target: game(h).players.find((p) => p !== assassin)! }, assassin);
    expect(h.state.phase).toBe('over');
    expect(h.view('cy').game!.results[0]!.autoPlayed).toEqual(['ben']);
  });

  it('strict: the assassination is picked at random', () => {
    const h = timed('strict');
    questRound(h, [HOST, 'ana']);
    questRound(h, [HOST, 'ana', 'ben']);
    questRound(h, [HOST, 'ana']);
    deadline(h);
    expect(h.state.phase).toBe('over');
    expect(game(h).autoTarget).toBe(true);
    expect(game(h).target).not.toBe('cy');
  });

  it('soft: the clock shows but nothing happens', () => {
    const h = timed('soft');
    expect(roundTable.nextDeadline!(h.state)).toBeNull();
    expect(h.view(HOST).game!.deadline).toBe(NOW + 60_000);
    expect(roundTable.onDeadline!(h.state, NOW + 120_000)).toBe(h.state);
  });

  it('no timers by default', () => {
    const h = rigged(BASE5);
    expect(game(h).deadline).toBeNull();
  });
});

describe('absent players', () => {
  it('the host can skip a voter: their vote approves', () => {
    const h = rigged(BASE5);
    propose(h, [HOST, 'ana']);
    for (const p of [HOST, 'ana', 'ben', 'cy']) h.act({ type: 'vote', approve: true }, p);
    expect(h.reject({ type: 'skip', player: 'ana' })).toBe('not-waiting');
    h.act({ type: 'skip', player: 'dee' });
    expect(game(h).proposals[0]!.autoVotes).toEqual(['dee']);
  });

  it('players who leave keep their seat and the game plays their turns', () => {
    const h = rigged(BASE5);
    leave(h, 'dee');
    expect(h.view(HOST).game!.players.find((p) => p.id === 'dee')!.left).toBe(true);
    propose(h, [HOST, 'dee']);
    for (const p of [HOST, 'ana', 'ben', 'cy']) h.act({ type: 'vote', approve: true }, p);
    expect(h.state.stage).toBe('quest');
    // Dee's card is played for her as soon as the quest starts.
    expect(h.view(HOST).game!.quest!.played).toEqual(['dee']);
    h.act({ type: 'play', card: 'success' }, HOST);
    expect(game(h).results[0]).toMatchObject({ success: true, autoPlayed: ['dee'] });
    // Ana leads next; then Ben, Cy and Dee: Dee's turn to lead is played for her.
    for (const leader of ['ana', 'ben', 'cy']) {
      expect(game(h).leader).toBe(leader);
      propose(h, [HOST, 'ana', 'ben']);
      for (const p of [HOST, 'ana', 'ben', 'cy']) h.act({ type: 'vote', approve: false }, p);
    }
    expect(h.state.stage).toBe('vote');
    expect(game(h).autoTeam).toBe(true);
    // Coming back: she plays her own turns again.
    h.state = roundTable.playerJoined(h.state, { id: 'dee', name: 'Dee' });
    expect(game(h).left).toEqual([]);
  });
});

describe('between games', () => {
  it('keeps the setup on Play again and refuses changes mid-game', () => {
    const h = harness(ids(7));
    h.act({ type: 'update-settings', preset: 'classic-plus', targeting: true });
    expect(h.state.settings.lady).toBe(true);
    expect(h.view(HOST).deck).toEqual(presetDeck('classic-plus', 7));
    h.act({ type: 'start' });
    expect(h.reject({ type: 'update-settings', lady: false })).toBe('in-progress');
    expect(h.reject({ type: 'start' })).toBe('in-progress');
    h.act({ type: 'back-to-lobby' });
    expect(h.state.settings).toMatchObject({ preset: 'classic-plus', targeting: true, lady: true });
    h.act({ type: 'start' });
    expect(Object.values(game(h).roles).sort()).toEqual([...presetDeck('classic-plus', 7)].sort());
  });

  it('refuses to start a bad deck and seats at most ten', () => {
    const h = harness(ids(4));
    expect(h.reject({ type: 'start' })).toBe('bad-setup');
    const big = harness([...ids(10), 'x1', 'x2']);
    expect(big.view(HOST).seats.filter((s) => s.playing)).toHaveLength(10);
    big.act({ type: 'start' });
    expect(game(big).players).toHaveLength(10);
    expect(big.view('x1').role).toBeNull();
  });

  it('a custom deck switches off the preset', () => {
    const h = harness(ids(5));
    h.act({ type: 'update-settings', roles: ['merlin', 'percival', 'assassin', 'morgana'] });
    expect(h.state.settings.preset).toBeNull();
    expect(h.view(HOST).deck).toEqual(['merlin', 'percival', 'servant', 'assassin', 'morgana']);
    expect(h.reject({ type: 'update-settings', lady: true }, 'ana')).toBe('not-host');
  });
});

/** Every role id, to spot a role leaking as `"<player>":"<role>"`. */
const ROLE_RE = Object.keys(ROLES).join('|');

describe('view() never leaks (the security boundary)', () => {
  it('hides roles, live votes, card owners and Lady results from every viewer at every stage', () => {
    const roles: RoleId[] = [
      'merlin',
      'percival',
      'servant',
      'servant',
      'servant',
      'assassin',
      'morgana',
      'oberon',
    ];
    const h = rigged(roles, { lady: true, ready: false });
    h.state = roundTable.playerJoined(h.state, { id: 'late', name: 'Late' });
    const players = ids(8);
    const viewers = [...players, 'late', null];
    const pid = players.join('|');
    const check = (label: string) => {
      const g = game(h);
      for (const viewer of viewers) {
        const v = h.view(viewer);
        const json = JSON.stringify(v);
        const where = `${label} as ${viewer}`;
        expect(json, where).not.toContain('seed');
        // Nobody's role is ever sent keyed by player, except at the end.
        if (h.state.phase !== 'over') {
          expect(json, where).not.toMatch(new RegExp(`"(${pid})":"(${ROLE_RE})"`));
          expect(v.game!.end, where).toBeNull();
        }
        // Quest cards never carry their owner.
        expect(json, where).not.toMatch(new RegExp(`"(${pid})":"(success|fail)"`));
        // Live votes: only who has voted, and your own.
        const withoutHistory = JSON.stringify({ ...v, game: { ...v.game, proposals: [] } });
        expect(withoutHistory, where).not.toMatch(new RegExp(`"(${pid})":(true|false)`));
        // Your knowledge is exactly what the matrix grants.
        if (viewer && players.includes(viewer))
          expect(v.role!.known, where).toEqual(knowledgeFor(g, viewer));
        else expect(v.role, where).toBeNull();
        // Lady results: the checker's own only.
        const mine = (g.ladyState?.checks ?? []).filter((c) => c.holder === viewer);
        if (h.state.phase !== 'over') {
          expect(v.game!.lady!.mine, where).toHaveLength(mine.length);
          expect(
            JSON.stringify({ ...v, role: null, game: { ...v.game, lady: null } }),
            where,
          ).not.toContain('"loyalty"');
        }
        if (h.state.stage !== 'assassinate' && h.state.phase !== 'over')
          expect(v.game!.assassin, where).toBeNull();
      }
    };
    check('reveal');
    for (const p of players) h.act({ type: 'ready' }, p);
    h.act({ type: 'pick', player: 'ana' });
    check('propose');
    h.act({ type: 'pick', player: 'fin' });
    h.act({ type: 'pick', player: 'ben' });
    h.act({ type: 'propose' });
    check('discuss');
    h.act({ type: 'call-vote' });
    h.act({ type: 'vote', approve: false }, 'gus');
    h.act({ type: 'vote', approve: true }, 'ana');
    check('vote');
    for (const p of players)
      if (p !== 'gus' && p !== 'ana') h.act({ type: 'vote', approve: true }, p);
    h.act({ type: 'play', card: 'fail' }, 'fin');
    check('quest');
    h.act({ type: 'play', card: 'success' }, 'ana');
    h.act({ type: 'play', card: 'success' }, 'ben');
    check('after quest 1');
    questRound(h, ['ana', 'ben', 'cy', 'dee']);
    check('lady');
    h.act({ type: 'lady', target: 'fin' }, game(h).ladyState!.holder);
    check('after the lady');
    questRound(h, ['ana', 'ben', 'cy', 'dee']);
    h.act({ type: 'lady', target: 'dee' }, game(h).ladyState!.holder);
    questRound(h, ['ana', 'ben', 'cy', 'dee', HOST]);
    expect(h.state.stage).toBe('assassinate');
    check('assassinate');
    h.act({ type: 'assassinate', target: 'ana' }, 'eve');
    check('over');
    const end = h.view('ben').game!.end!;
    expect(end.roles).toEqual(game(h).roles);
    expect(end.ladyChecks).toHaveLength(2);
    expect(end.knowledge.ana).toEqual(knowledgeFor(game(h), 'ana'));
  });
});
