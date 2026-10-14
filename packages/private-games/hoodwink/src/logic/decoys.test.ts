import { wordKey } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { hoodwink, liePoints } from './game.ts';
import { insights } from './insights.ts';
import {
  FOUR,
  HOST,
  NOW,
  THREE,
  content,
  harness,
  lieOf,
  lureDeck,
  playRound,
  round,
  startedGame,
  truthIndex,
} from './test-utils.ts';
import type { HoodwinkState } from './types.ts';

/** Fakes that clash with the truth (a plural), an alternate (any case) and a lie written below. */
const CLASHING = ['wooden spoons', 'LADLE', 'teacups'];
const GOOD = ['Brick', 'Teapot', 'Kazoo', 'Umbrella', 'Trombone'];
const DECOYS = [...CLASHING, ...GOOD, 'brick'];

/** `null`: questions without any built-in fakes. */
const game = (decoys: string[] | null = DECOYS, players = FOUR, opts = {}) =>
  startedGame(players, { provider: content([lureDeck(decoys ?? undefined)]), ...opts });
const strict = { clueSeconds: 60, guessSeconds: 30, timerMode: 'strict' as const };
const lies = (h: { state: HoodwinkState }) => Object.values(round(h as never).lies);

describe('lie for me', () => {
  it('gives the player a built-in fake as their own lie, which typing replaces', () => {
    const h = game();
    h.act({ type: 'lie-for-me' }, 'p2');
    const picked = round(h).lies.p2!;
    expect(GOOD).toContain(picked);
    expect(round(h).autoLies).toEqual(['p2']);
    const mine = hoodwink.view(h.state, 'p2').round!;
    // One pick per round: the button goes once used.
    expect(mine).toMatchObject({ myLie: picked, myLieAuto: true, canLieForMe: false });
    expect(hoodwink.view(h.state, 'p3').round).toMatchObject({
      myLieAuto: false,
      canLieForMe: true,
    });
    h.act({ type: 'lie', text: 'My own idea' }, 'p2');
    expect(round(h).autoLies).toEqual([]);
    expect(hoodwink.view(h.state, 'p2').round!.myLieAuto).toBe(false);
  });

  it('never picks the truth, an alternate, a lie already written or a fake already used', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const h = harness(FOUR, content([lureDeck(DECOYS)]), seed);
      h.act({ type: 'update-settings', rounds: 5 });
      h.act({ type: 'start' });
      h.act({ type: 'lie', text: 'Teacup' }, HOST);
      h.act({ type: 'lie-for-me' }, 'p2');
      h.act({ type: 'lie-for-me' }, 'p3');
      h.act({ type: 'lie-for-me' }, 'p4');
      const all = round(h).options.map((o) => wordKey(o.text));
      expect(new Set(all).size, `seed ${seed}`).toBe(all.length);
      const autos = round(h).options.filter((o) => o.auto.length > 0);
      expect(autos).toHaveLength(3);
      for (const o of autos) expect(GOOD).toContain(o.text);
    }
  });

  it('keeps the half score when the player types out the fake they were shown', () => {
    const h = game();
    h.act({ type: 'lie-for-me' }, 'p2');
    const picked = round(h).lies.p2!;
    for (const text of [picked.toUpperCase(), `${picked}!`, `the ${picked}s`]) {
      h.act({ type: 'lie', text: 'My own idea' }, 'p2');
      expect(round(h).autoLies).toEqual([]);
      h.act({ type: 'lie', text }, 'p2');
      expect(round(h).autoLies, text).toEqual(['p2']);
    }
    // A fake nobody showed them is just a lie of their own.
    const p3Fake = round(h).fakes!.p3!;
    h.act({ type: 'lie', text: p3Fake }, 'p3');
    expect(round(h).autoLies).toEqual(['p2']);
  });

  it('never offers a fake that is the truth with a hyphen or a full stop', () => {
    const h = game(['Wooden-spoon', 'Wooden. Spoon', ...GOOD]);
    for (const id of ['p2', 'p3', 'p4']) h.act({ type: 'lie-for-me' }, id);
    expect(Object.values(round(h).fakes!)).not.toContain('Wooden-spoon');
    expect(lies(h)).not.toContain('Wooden. Spoon');
    for (const id of ['p2', 'p3', 'p4']) expect(GOOD).toContain(round(h).lies[id]);
  });

  it('can’t be re-rolled to harvest the fakes, even after typing your own lie', () => {
    const h = game();
    h.act({ type: 'lie-for-me' }, 'p2');
    const picked = round(h).lies.p2!;
    expect(h.reject({ type: 'lie-for-me' }, 'p2').code).toBe('already-picked');
    expect(round(h).lies.p2).toBe(picked);
    h.act({ type: 'lie', text: 'My own idea' }, 'p2');
    expect(h.reject({ type: 'lie-for-me' }, 'p2').code).toBe('already-picked');
    // Every press across the table showed each player at most one fake.
    expect(round(h).fakeShown).toEqual(['p2']);
  });

  it('never uses a fake a player was shown as a house fake', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const h = harness(THREE, content([lureDeck(['Brick', 'Teapot', 'Kazoo'])]), seed);
      h.act({ type: 'update-settings', rounds: 5 });
      h.act({ type: 'start' });
      h.act({ type: 'lie-for-me' }, HOST);
      const shown = round(h).lies.host!;
      h.act({ type: 'lie', text: 'Owl' }, HOST); // replaces the fake on the board
      h.act({ type: 'lie', text: 'Cat' }, 'p2');
      h.act({ type: 'lie', text: 'Dog' }, 'p3');
      expect(
        round(h).options.map((o) => o.text),
        `seed ${seed}`,
      ).not.toContain(shown);
      expect(round(h).options).toHaveLength(4);
      expect(round(h).options.filter((o) => o.house)).toHaveLength(0);
    }
  });

  it('offers it per player, the same whatever the others do', () => {
    // One fake for four players: exactly one of them is offered it, from the start.
    const h = game(['Brick']);
    const offered = () => FOUR.filter((id) => hoodwink.view(h.state, id).round!.canLieForMe).sort();
    const before = offered();
    expect(before).toHaveLength(1);
    const [lucky] = before;
    const other = FOUR.find((id) => id !== lucky)!;
    expect(h.reject({ type: 'lie-for-me' }, other).code).toBe('no-decoys');
    h.act({ type: 'lie', text: 'Brick' }, other); // someone writes the very same lie
    expect(offered()).toEqual([lucky]);
    h.act({ type: 'lie-for-me' }, lucky);
    // It merges, and both are told it'll be shared.
    expect(hoodwink.view(h.state, lucky!).round!.myLieShared).toBe(true);
    expect(hoodwink.view(h.state, other).round!.myLieShared).toBe(true);
  });

  it('warns when your lie matches someone else’s', () => {
    const h = game();
    h.act({ type: 'lie', text: 'Owl' }, 'p2');
    expect(hoodwink.view(h.state, 'p2').round!.myLieShared).toBe(false);
    h.act({ type: 'lie', text: 'owls' }, 'p3');
    expect(hoodwink.view(h.state, 'p2').round!.myLieShared).toBe(true);
    expect(hoodwink.view(h.state, 'p3').round!.myLieShared).toBe(true);
    expect(hoodwink.view(h.state, 'p4').round!.myLieShared).toBe(false);
    h.act({ type: 'lie', text: 'Cat' }, 'p3');
    expect(hoodwink.view(h.state, 'p2').round!.myLieShared).toBe(false);
  });

  it('never replaces a lie you wrote yourself', () => {
    const h = game();
    h.act({ type: 'lie', text: 'My own idea' }, 'p2');
    expect(h.reject({ type: 'lie-for-me' }, 'p2').code).toBe('own-lie-sent');
    expect(round(h).lies.p2).toBe('My own idea');
  });

  it('refuses when the question has no fakes, or they have run out', () => {
    const none = game(null);
    expect(hoodwink.view(none.state, 'p2').round!.canLieForMe).toBe(false);
    expect(none.reject({ type: 'lie-for-me' }, 'p2').code).toBe('no-decoys');
    const h = game();
    h.state = hoodwink.playerJoined(h.state, { id: 'late', name: 'Late' });
    expect(h.reject({ type: 'lie-for-me' }, 'late').code).toBe('not-playing-round');
  });

  it('scores half, split among merged authors, and doubles in the final round', () => {
    expect(liePoints(1, 1, 1, true)).toBe(250);
    expect(liePoints(2, 1, 2, true)).toBe(1000);
    expect(liePoints(1, 2, 1, true)).toBe(100);
    const h = game(['Brick'], FOUR, { rounds: 5 });
    // The one fake goes to one player each round: whoever is offered it.
    const lucky = () => FOUR.find((id) => hoodwink.view(h.state, id).round!.canLieForMe)!;
    const a = lucky();
    const [b, c, d] = FOUR.filter((id) => id !== a) as [string, string, string];
    h.act({ type: 'lie-for-me' }, a);
    h.act({ type: 'lie', text: 'bricks' }, b); // merges with the fake, typed by hand
    h.act({ type: 'lie', text: 'Owl' }, c);
    h.act({ type: 'lie', text: 'Cat' }, d);
    const brick = lieOf(h, a);
    expect(round(h).options[brick]).toMatchObject({ auto: [a] });
    expect([...round(h).options[brick]!.authors].sort()).toEqual([a, b].sort());
    h.act({ type: 'vote', option: brick }, c);
    h.act({ type: 'vote', option: brick }, d);
    h.act({ type: 'vote', option: truthIndex(h) }, a);
    h.act({ type: 'vote', option: truthIndex(h) }, b);
    expect(round(h).points).toEqual({ [a]: 1250, [b]: 1500, [c]: 0, [d]: 0 });
    h.act({ type: 'next-round' });
    for (let i = 0; i < 3; i++) playRound(h);
    expect(round(h).number).toBe(5);
    const e = lucky();
    const others = FOUR.filter((id) => id !== e);
    h.act({ type: 'lie-for-me' }, e);
    for (const id of others) h.act({ type: 'lie', text: `lie ${id}` }, id);
    for (const id of others) h.act({ type: 'vote', option: lieOf(h, e) }, id);
    h.act({ type: 'vote', option: truthIndex(h) }, e);
    expect(round(h).points[e]).toBe(2000 + 3 * 500);
  });
});

describe('filling missed lies', () => {
  it('gives everyone without a lie a distinct fake when the strict lie timer runs out', () => {
    const h = game(DECOYS, FOUR, strict);
    h.act({ type: 'lie', text: 'Teacup' }, HOST);
    h.act({ type: 'lie', text: 'Teapot' }, 'p2');
    h.state = hoodwink.onDeadline!(h.state, NOW + 60_000);
    expect(round(h).stage).toBe('vote');
    expect(round(h).autoLies).toEqual(['p3', 'p4']);
    const keys = lies(h).map(wordKey);
    expect(new Set(keys).size).toBe(4);
    for (const id of ['p3', 'p4']) {
      expect(GOOD.filter((g) => g !== 'Teapot')).toContain(round(h).lies[id]);
    }
    expect(round(h).options).toHaveLength(5);
    // Each player whose lie was filled in is told so; the others aren't.
    expect(hoodwink.view(h.state, 'p3').round).toMatchObject({
      myLieFilled: true,
      myLieAuto: true,
    });
    expect(hoodwink.view(h.state, HOST).round!.myLieFilled).toBe(false);
  });

  it('marks a lie picked with Lie for me as not filled in', () => {
    const h = game(DECOYS, FOUR, strict);
    h.act({ type: 'lie-for-me' }, 'p2');
    expect(hoodwink.view(h.state, 'p2').round!.myLieFilled).toBe(false);
  });

  it('fills as many as the fakes allow, and nothing in soft mode', () => {
    const h = game(['Brick'], FOUR, strict);
    const owner = Object.keys(round(h).fakes!)[0]!;
    h.state = hoodwink.onDeadline!(h.state, NOW + 60_000);
    expect(round(h).lies).toEqual({ [owner]: 'Brick' });
    expect(round(h).stage).toBe('vote');
    const soft = game(DECOYS, FOUR, { ...strict, timerMode: 'soft' });
    expect(hoodwink.onDeadline!(soft.state, NOW + 60_000)).toBe(soft.state);
    const none = game(null, FOUR, strict);
    none.state = hoodwink.onDeadline!(none.state, NOW + 60_000);
    expect(round(none).stage).toBe('reveal');
  });
});

describe('padding small games', () => {
  it('adds house fakes up to four answers, which score for nobody', () => {
    const h = game(DECOYS, THREE);
    h.act({ type: 'lie', text: 'Teacup' }, HOST);
    h.act({ type: 'lie', text: 'teacups' }, 'p2');
    h.act({ type: 'lie', text: 'Teapot' }, 'p3');
    const options = round(h).options;
    expect(options).toHaveLength(4);
    const house = options.filter((o) => o.house);
    expect(house).toHaveLength(1);
    expect(house[0]).toMatchObject({ authors: [], auto: [], truth: false });
    expect(GOOD.filter((g) => g !== 'Teapot')).toContain(house[0]!.text);
    const keys = options.map((o) => wordKey(o.text));
    expect(new Set(keys).size).toBe(4);
    const houseIndex = options.indexOf(house[0]!);
    for (const id of THREE) h.act({ type: 'vote', option: houseIndex }, id);
    expect(round(h).points).toEqual({ host: 0, p2: 0, p3: 0 });
    expect(Object.values(h.state.scores).every((s) => s.fooled === 0)).toBe(true);
  });

  it('stops when the fakes run out, and never pads a full board', () => {
    const h = game(['Brick', 'brick', 'LADLE'], THREE);
    h.act({ type: 'lie', text: 'Same' }, HOST);
    h.act({ type: 'lie', text: 'same' }, 'p2');
    h.act({ type: 'lie', text: 'SAME' }, 'p3');
    expect(round(h).options).toHaveLength(3);
    expect(
      round(h)
        .options.filter((o) => o.house)
        .map((o) => o.text),
    ).toEqual(['Brick']);
    const full = game(DECOYS, THREE);
    for (const id of THREE) full.act({ type: 'lie', text: `lie ${id}` }, id);
    expect(full.state.round!.options.some((o) => o.house)).toBe(false);
  });
});

describe('redaction and insights', () => {
  it('never sends the fakes, and only marks auto lies and house fakes at the reveal', () => {
    const h = game(DECOYS, THREE);
    h.act({ type: 'lie-for-me' }, HOST);
    const picked = round(h).lies.host!;
    // Nobody writes a teacup here, so that fake is fair game too (shown capitalised).
    const unpicked = ['Teacups', ...GOOD].filter((g) => g !== picked);
    for (const viewer of [...THREE, null]) {
      const json = JSON.stringify(hoodwink.view(h.state, viewer));
      for (const d of DECOYS) {
        if (viewer !== HOST || d !== picked) expect(json, `${d} to ${viewer}`).not.toContain(d);
      }
    }
    h.act({ type: 'lie', text: 'Owl' }, 'p2');
    h.act({ type: 'lie', text: 'owls' }, 'p3');
    // The board: truth, the fake, the merged lie, one house fake.
    const v = hoodwink.view(h.state, 'p2').round!;
    expect(v.options).toHaveLength(4);
    expect(v.options.every((o) => o.house === null && o.auto === null)).toBe(true);
    const shown = v.options.map((o) => o.text);
    expect(unpicked.filter((d) => shown.includes(d))).toHaveLength(1);
    const json = JSON.stringify(v);
    for (const d of ['wooden spoons', 'LADLE', ...unpicked.filter((d) => !shown.includes(d))]) {
      expect(json).not.toContain(d);
    }
    const before = h.state;
    for (const id of THREE) {
      const pick = round(h).options.findIndex((o) => o.house || (o.auto.length && id !== HOST));
      h.act({ type: 'vote', option: pick }, id);
    }
    const r = hoodwink.view(h.state, null).round!;
    expect(r.options.filter((o) => o.house)).toHaveLength(1);
    expect(r.options.find((o) => o.auto?.length)!.auto).toEqual([HOST]);
    const events = insights(before, h.state, null, null);
    expect(events.find((e) => e.type === 'lie' && e.playerId === HOST)!.props).toMatchObject({
      auto: true,
    });
    expect(events.filter((e) => e.type === 'lie')).toHaveLength(2);
    expect(events.at(-1)!.props).toMatchObject({ liesCount: 2, house: 1 });
  });
});
