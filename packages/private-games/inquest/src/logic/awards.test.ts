import {
  type AwardRule,
  type GameEvents,
  type InsightEvent,
  fixtureGame,
  recapEv,
  recapEventOf,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { INQUEST_RULES, inquestAwards } from './awards.ts';
import { EVENT_TILES } from './content.ts';
import { insights } from './insights.ts';
import {
  HOST,
  type Harness,
  presentAll,
  stackPile,
  startedGame,
  toPresentations,
} from './test-utils.ts';
import type { InquestAction, InquestState } from './types.ts';

const rule = (id: string) => INQUEST_RULES.find((r) => r.id === `inquest.${id}`)!;
const hit = (r: AwardRule, g: GameEvents) => r.compute!(g);

const PLAYERS = ['fs', 'm', 'a', 'w', 'i1', 'i2'];
const outcome = (props: Record<string, unknown>) =>
  recapEv('outcome', null, {
    fs: 'fs',
    fsIds: ['fs'],
    murderer: 'm',
    accomplice: 'a',
    witness: 'w',
    finalRound: 3,
    ...props,
  });
const solveEv = (by: string, correct: boolean, round = 1) =>
  recapEv('solve', by, { correct, round, target: 'm', clue: 'clue-1', means: 'means-1' });
const game = (...events: ReturnType<typeof recapEv>[]) => fixtureGame(events, { players: PLAYERS });

describe('Inquest awards', () => {
  it('Sharp Eye: a first-try solver', () => {
    const g = game(
      solveEv('i1', true, 2),
      outcome({ winner: 'investigators', how: 'solved', firstTry: true }),
    );
    expect(hit(rule('sharp-eye'), g)[0]!.players).toEqual(['i1']);
    const second = game(
      solveEv('i1', false),
      solveEv('i2', true, 2),
      outcome({ winner: 'investigators', how: 'solved', firstTry: false }),
    );
    expect(hit(rule('sharp-eye'), second)).toEqual([]);
  });

  it('Case Closed Early and Last-Second Save', () => {
    const early = game(
      solveEv('i2', true, 1),
      outcome({ winner: 'investigators', how: 'solved', solvedRound: 1, solvedBy: 'i2' }),
    );
    expect(hit(rule('case-closed-early'), early)[0]!.players).toEqual(['i2']);
    expect(hit(rule('last-second-save'), early)).toEqual([]);
    const late = game(
      solveEv('i2', true, 3),
      outcome({ winner: 'investigators', how: 'solved', solvedRound: 3, solvedBy: 'i2' }),
    );
    expect(hit(rule('case-closed-early'), late)).toEqual([]);
    expect(hit(rule('last-second-save'), late)[0]).toMatchObject({ players: ['i2'], value: 3 });
    const countdown = game(
      outcome({
        winner: 'investigators',
        how: 'solved',
        solvedRound: 2,
        finalRound: 2,
        solvedBy: 'i1',
      }),
    );
    expect(hit(rule('last-second-save'), countdown)[0]!.players).toEqual(['i1']);
  });

  it('Got Away With It and Silent Partner', () => {
    const time = game(outcome({ winner: 'murderer', how: 'time', round: 3 }));
    expect(hit(rule('got-away'), time)[0]!.players).toEqual(['m']);
    expect(hit(rule('silent-partner'), time)[0]!.players).toEqual(['a']);
    const caught = game(outcome({ winner: 'investigators', how: 'solved' }));
    expect(hit(rule('got-away'), caught)).toEqual([]);
    expect(hit(rule('silent-partner'), caught)).toEqual([]);
    // Winning by the Reversal is Found the Witness, not Got Away.
    const rev = game(outcome({ winner: 'murderer', how: 'reversal', witnessFound: true }));
    expect(hit(rule('got-away'), rev)).toEqual([]);
    expect(hit(rule('found-the-witness'), rev)[0]!.players).toEqual(['m']);
    expect(hit(rule('star-witness'), rev)).toEqual([]);
    const safe = game(outcome({ winner: 'investigators', how: 'reversal', witnessFound: false }));
    expect(hit(rule('star-witness'), safe)[0]!.players).toEqual(['w']);
    expect(hit(rule('found-the-witness'), safe)).toEqual([]);
  });

  it('Master Forensic and Hesitant Hand', () => {
    const g = game(
      outcome({ winner: 'investigators', how: 'solved', bulletsBeforeSolve: 7, maxGapS: 31.4 }),
    );
    expect(hit(rule('master-forensic'), g)[0]).toMatchObject({ players: ['fs'], value: 7 });
    expect(hit(rule('hesitant-hand'), g)[0]).toMatchObject({ players: ['fs'], value: 31 });
    const quick = game(outcome({ winner: 'murderer', how: 'time', maxGapS: 8 }));
    expect(hit(rule('master-forensic'), quick)).toEqual([]);
    expect(hit(rule('hesitant-hand'), quick)).toEqual([]);
    const night = rule('master-forensic').computeNight!([
      fixtureGame([outcome({ winner: 'investigators', how: 'solved', bulletsBeforeSolve: 9 })], {
        players: PLAYERS,
      }),
      fixtureGame(
        [outcome({ winner: 'investigators', how: 'solved', bulletsBeforeSolve: 6, fs: 'i1' })],
        { players: PLAYERS },
      ),
    ]);
    expect(night[0]!.players).toEqual(['i1']);
  });

  it('Bold Bluffer and Wrong Tree', () => {
    const g = game(
      outcome({ winner: 'murderer', how: 'time', bluffers: ['a'], nearMisses: ['i1'] }),
    );
    expect(hit(rule('bold-bluffer'), g)[0]!.players).toEqual(['a']);
    expect(hit(rule('wrong-tree'), g)[0]!.players).toEqual(['i1']);
    const lost = game(outcome({ winner: 'investigators', how: 'solved', bluffers: ['a'] }));
    expect(hit(rule('bold-bluffer'), lost)).toEqual([]);
    expect(hit(rule('wrong-tree'), lost)).toEqual([]);
  });

  it('gives nothing for old events without the newer props', () => {
    const g = game(recapEv('outcome', null, {}));
    for (const r of INQUEST_RULES) expect(r.compute!(g), r.id).toEqual([]);
    expect(inquestAwards.history!(g)).toEqual(['The Murderer got away']);
  });

  it('nuggets: cases, fastest solve, cards and the longest pause', () => {
    const games = [
      fixtureGame(
        [
          recapEv('event', null, { kind: 'countdown' }),
          outcome({
            winner: 'investigators',
            how: 'solved',
            solvedRound: 2,
            solveS: 300,
            means: 'means-4',
            clue: 'clue-9',
            maxGapS: 12,
            wrong: 2,
            wrongBeforeSolve: 1,
          }),
        ],
        { players: PLAYERS },
      ),
      fixtureGame(
        [
          outcome({
            winner: 'murderer',
            how: 'time',
            means: 'means-4',
            clue: 'clue-9',
            maxGapS: 40.2,
            wrong: 1,
          }),
        ],
        { players: PLAYERS },
      ),
    ];
    const text = (id: string) =>
      inquestAwards.nuggets.find((n) => n.id === `inquest.${id}`)!.compute(games);
    expect(text('solved')!.text).toBe('Cases solved: 1 of 2');
    expect(text('fastest')).toEqual({ value: 200300, text: 'Fastest solve: round 2, 5m 0s in' });
    expect(text('top-means')!.text).toBe('{card:means-4} killed 2 times');
    expect(text('top-clue')!.text).toBe('{card:clue-9} was the key 2 times');
    expect(text('events')!.text).toBe('1 event turned up');
    expect(text('longest-pause')).toEqual({
      value: 40.2,
      text: 'Longest pause between bullets: 40 s',
    });
    expect(text('badges')!.text).toBe('3 badges spent on wrong guesses');
    expect(inquestAwards.nuggets.find((n) => n.id === 'inquest.fastest')!.record).toBe('min');
    expect(inquestAwards.nuggets.find((n) => n.id === 'inquest.longest-pause')!.record).toBe('max');
  });

  it('history says who solved it, or that the Murderer got away', () => {
    expect(
      inquestAwards.history!(game(outcome({ how: 'solved', solvedRound: 2, solvedBy: 'i1' }))),
    ).toEqual(['Solved in round 2 by {p:i1}']);
    expect(
      inquestAwards.history!(
        game(outcome({ how: 'reversal', solvedRound: 1, solvedBy: 'i1', witnessFound: true })),
      ),
    ).toEqual(['Solved in round 1 by {p:i1}, but the Witness was found']);
    expect(inquestAwards.history!(game(outcome({ how: 'badges' })))).toEqual([
      'Every badge was spent: the Murderer got away',
    ]);
  });
});

/** Plays actions through the harness, collecting the real insight events. */
function recording(h: Harness) {
  const events: InsightEvent[] = [];
  const act = (action: InquestAction, by?: string) => {
    const before: InquestState = h.state;
    h.act(action, by);
    events.push(...insights(before, h.state, action, by ?? HOST));
  };
  return { events, act };
}

describe('a real game through insights and awards', () => {
  it('reports bullets, events, solves and the outcome, and awards follow', () => {
    const h = startedGame(6, { murderer: 'ana', accomplice: 'ben', witness: 'cy' });
    const rec = recording(h);
    const m = h.game().players.find((p) => p.id === 'ana')!;
    rec.act({ type: 'commit-crime', clue: m.clue[0]!, means: m.means[0]! }, 'ana');
    // Nothing secret leaks before the end.
    expect(JSON.stringify(rec.events)).not.toMatch(/murderer|"clue-/);
    rec.act({ type: 'pick-location', tile: 3 }, HOST);
    for (let slot = 0; slot < 6; slot++) {
      h.now += 2000 + slot * 1000;
      rec.act({ type: 'place-bullet', slot, item: 1 }, HOST);
    }
    stackPile(h, [EVENT_TILES['good-twist']]);
    // A bluff by the Accomplice, then a near miss on the Murderer's cards.
    rec.act(
      {
        type: 'solve',
        target: 'dee',
        clue: h.game().players.find((p) => p.id === 'dee')!.clue[0]!,
        means: h.game().players.find((p) => p.id === 'dee')!.means[0]!,
      },
      'ben',
    );
    rec.act({ type: 'solve', target: 'ana', clue: m.clue[1]!, means: m.means[0]! }, 'eve');
    while (h.game().stage === 'present') {
      const p = h.game().present!;
      rec.act({ type: 'done-presenting' }, p.order[p.index]);
    }
    expect(h.game().round).toBe(2);
    h.now += 5000;
    rec.act({ type: 'solve', target: 'ana', clue: m.clue[0]!, means: m.means[0]! }, 'dee');
    rec.act({ type: 'reversal-tap', target: 'eve' }, 'ana');
    rec.act({ type: 'reversal-confirm' }, 'ana');
    expect(h.state.phase).toBe('over');

    expect(rec.events.filter((e) => e.type === 'bullet')).toHaveLength(6);
    expect(rec.events.filter((e) => e.type === 'event').map((e) => e.props!.kind)).toEqual([
      'good-twist',
    ]);
    expect(rec.events.filter((e) => e.type === 'solve').map((e) => e.props!.correct)).toEqual([
      false,
      false,
      true,
    ]);
    const out = rec.events.find((e) => e.type === 'outcome')!;
    expect(out.props).toMatchObject({
      winner: 'investigators',
      how: 'reversal',
      solvedBy: 'dee',
      solvedRound: 2,
      murderer: 'ana',
      witnessFound: false,
      bluffers: ['ben'],
      nearMisses: ['eve'],
      firstTry: true,
      bulletsBeforeSolve: 6,
      wrongBeforeSolve: 2,
      clue: `clue-${m.clue[0]}`,
    });
    expect(out.winners!.sort()).toEqual(['cy', 'dee', 'eve', 'host']);

    const g = fixtureGame(
      rec.events.map((e, i) => recapEventOf(e, i + 1)),
      {
        players: h.game().players.map((p) => p.id),
      },
    );
    const got = (id: string) => hit(rule(id), g).flatMap((c) => c.players);
    expect(got('sharp-eye')).toEqual(['dee']);
    expect(got('star-witness')).toEqual(['cy']);
    expect(got('wrong-tree')).toEqual(['eve']);
    expect(got('master-forensic')).toEqual([HOST]);
    expect(got('bold-bluffer')).toEqual([]);
    expect(inquestAwards.history!(g)).toEqual([
      'Solved in round 2 by {p:dee}, and the Witness stayed safe',
    ]);
  });

  it('a lost game rewards the culprits', () => {
    const h = startedGame(
      6,
      { murderer: 'ana', accomplice: 'ben', witness: 'cy' },
      { events: false },
    );
    const rec = recording(h);
    toPresentations(h);
    rec.events.length = 0;
    for (let round = 1; round <= 3; round++) {
      if (round > 1) {
        rec.act({ type: 'replace-tile', slot: 2 }, HOST);
        rec.act({ type: 'place-bullet', slot: 2, item: 0 }, HOST);
      }
      while (h.state.phase === 'playing' && h.game().stage === 'present') {
        const p = h.game().present!;
        rec.act({ type: 'done-presenting' }, p.order[p.index]);
      }
    }
    presentAll(h);
    const g = fixtureGame(
      rec.events.map((e, i) => recapEventOf(e, i + 1)),
      {
        players: h.game().players.map((p) => p.id),
      },
    );
    expect(hit(rule('got-away'), g)[0]!.players).toEqual(['ana']);
    expect(hit(rule('silent-partner'), g)[0]!.players).toEqual(['ben']);
  });
});
