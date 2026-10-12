import { describe, expect, it } from 'vitest';
import { CAUSE_TILE, EVENT_TILES, LOCATION_TILES } from './content.ts';
import { inquest } from './game.ts';
import { rolesFor } from './setup.ts';
import {
  HOST,
  NOW,
  commit,
  harness,
  holder,
  player,
  presentAll,
  stackPile,
  startPresentations,
  startedGame,
  toDiscussion,
  toPresentations,
} from './test-utils.ts';

const roleCounts = (roles: string[]) =>
  roles.reduce<Record<string, number>>((m, r) => ({ ...m, [r]: (m[r] ?? 0) + 1 }), {});

describe('setup', () => {
  it('deals the roles for each table size and toggle', () => {
    expect(roleCounts(rolesFor(4, { accomplice: true, witness: true }))).toEqual({
      forensic: 1,
      murderer: 1,
      investigator: 2,
    });
    expect(roleCounts(rolesFor(5, { accomplice: true, witness: true })).accomplice).toBeUndefined();
    expect(roleCounts(rolesFor(6, { accomplice: true, witness: true }))).toEqual({
      forensic: 1,
      murderer: 1,
      accomplice: 1,
      witness: 1,
      investigator: 2,
    });
    expect(roleCounts(rolesFor(8, { accomplice: true, witness: false })).witness).toBeUndefined();
    expect(roleCounts(rolesFor(12, { accomplice: false, witness: false }))).toEqual({
      forensic: 1,
      murderer: 1,
      investigator: 10,
    });
  });

  it('starts with hands, a badge each and the Forensic Scientist empty-handed', () => {
    for (const [count, hand] of [
      [4, 4],
      [7, 3],
      [12, 5],
    ] as const) {
      const h = harness(count);
      h.act({ type: 'update-settings', fsMode: 'random', hand });
      h.act({ type: 'start' });
      const g = h.game();
      expect(g.players).toHaveLength(count);
      const fs = g.players.find((p) => p.id === g.fs)!;
      expect(fs.role).toBe('forensic');
      expect(fs.clue).toEqual([]);
      for (const p of g.players.filter((p) => p.id !== g.fs)) {
        expect(p.clue).toHaveLength(hand);
        expect(p.means).toHaveLength(hand);
        expect(p.badges).toBe(1);
      }
      const all = g.players.flatMap((p) => p.clue);
      expect(new Set(all).size).toBe(all.length);
      expect(g.stage).toBe('night');
      expect(g.deadline).toBe(NOW + 60_000);
    }
  });

  it('turns the Witness off with the Accomplice and refuses it alone', () => {
    const h = harness(6);
    h.act({ type: 'update-settings', accomplice: false });
    expect(h.state.settings.witness).toBe(false);
    expect(h.reject({ type: 'update-settings', witness: true })).toBe('needs-accomplice');
    expect(h.reject({ type: 'update-settings', events: false }, 'ana')).toBe('not-host');
  });

  it('needs 4 players', () => {
    const h = harness(3);
    expect(h.reject({ type: 'start' })).toBe('cannot-start');
  });
});

describe('choosing the Forensic Scientist', () => {
  it('host picks a player', () => {
    const h = harness(4);
    h.act({ type: 'update-settings', fsMode: 'host' });
    expect(h.refusal({ type: 'start' })).toMatch(/host picks/);
    h.act({ type: 'update-settings', fsPick: 'ben' });
    h.act({ type: 'start' });
    expect(h.game().fs).toBe('ben');
  });

  it('random among everyone', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 30; seed++) {
      const h = harness(4, seed);
      h.act({ type: 'start' });
      seen.add(h.game().fs);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('random among volunteers', () => {
    const h = harness(5);
    h.act({ type: 'update-settings', fsMode: 'volunteers' });
    expect(h.refusal({ type: 'start' })).toMatch(/volunteered/);
    h.act({ type: 'volunteer', on: true }, 'cy');
    h.act({ type: 'volunteer', on: true }, 'dee');
    h.act({ type: 'start' });
    expect(['cy', 'dee']).toContain(h.game().fs);
  });

  it('host picks from the volunteers', () => {
    const h = harness(4);
    h.act({ type: 'update-settings', fsMode: 'host-volunteers', fsPick: 'ana' });
    h.act({ type: 'volunteer', on: true }, 'ben');
    expect(h.refusal({ type: 'start' })).toMatch(/from the volunteers/);
    h.act({ type: 'update-settings', fsPick: 'ben' });
    h.act({ type: 'start' });
    expect(h.game().fs).toBe('ben');
  });
});

describe('the night', () => {
  it('lets only the Murderer pick a pair from their own cards', () => {
    const h = startedGame(4);
    const m = player(h, 'ana');
    const other = player(h, 'ben');
    expect(h.reject({ type: 'commit-crime', clue: m.clue[0]!, means: m.means[0]! }, 'ben')).toBe(
      'not-murderer',
    );
    expect(
      h.reject({ type: 'commit-crime', clue: other.clue[0]!, means: m.means[0]! }, 'ana'),
    ).toBe('not-yours');
    h.act({ type: 'commit-crime', clue: m.clue[1]!, means: m.means[2]! }, 'ana');
    expect(h.game().solution).toEqual({ clue: m.clue[1], means: m.means[2] });
    expect(h.game().stage).toBe('collect');
    expect(h.game().autoCrime).toBe(false);
  });

  it('picks the crime at random after 60 s and tells the Murderer', () => {
    const h = startedGame(4);
    h.tick(59_000);
    expect(h.game().stage).toBe('night');
    h.tick(1_000);
    const g = h.game();
    const m = player(h, 'ana');
    expect(g.stage).toBe('collect');
    expect(m.clue).toContain(g.solution!.clue);
    expect(m.means).toContain(g.solution!.means);
    expect(inquest.view(h.state, 'ana').game!.autoCrime).toBe(true);
    expect(inquest.view(h.state, 'ben').game!.autoCrime).toBe(false);
  });
});

describe('collecting evidence', () => {
  it('lays the Location, Cause and 4 scene tiles, then one bullet each', () => {
    const h = startedGame(4);
    commit(h);
    expect(h.reject({ type: 'pick-location', tile: 7 }, HOST)).toBe('bad-tile');
    expect(h.reject({ type: 'pick-location', tile: 3 }, 'ben')).toBe('not-fs');
    h.act({ type: 'pick-location', tile: LOCATION_TILES[2]! }, HOST);
    const slots = h.game().slots;
    expect(slots.map((s) => s.tile).slice(0, 2)).toEqual([CAUSE_TILE, 4]);
    expect(slots).toHaveLength(6);
    // No solving before the first bullet.
    const b = player(h, 'ben');
    expect(
      h.reject(
        {
          type: 'solve',
          target: 'ana',
          clue: player(h, 'ana').clue[0]!,
          means: player(h, 'ana').means[0]!,
        },
        'ben',
      ),
    ).toBe('not-now');
    h.now += 4_000;
    h.act({ type: 'place-bullet', slot: 3, item: 2 }, HOST);
    expect(h.game().bullets[0]).toMatchObject({ seq: 1, slot: 3, item: 2, gapMs: 4_000 });
    expect(h.reject({ type: 'place-bullet', slot: 3, item: 1 }, HOST)).toBe('has-bullet');
    expect(b.badges).toBe(1);
    for (const slot of [0, 1, 2, 4]) h.act({ type: 'place-bullet', slot, item: 0 }, HOST);
    expect(h.game().stage).toBe('collect');
    h.now += 9_000;
    h.act({ type: 'place-bullet', slot: 5, item: 5 }, HOST);
    expect(h.game().bullets.at(-1)!.gapMs).toBe(9_000);
    // The table talks the evidence over first; the Forensic Scientist starts the presentations.
    expect(h.game().stage).toBe('discuss');
    h.act({ type: 'start-presentations' }, HOST);
    expect(h.game().stage).toBe('present');
    // Speakers start left of the Forensic Scientist and leave them out.
    expect(h.game().present!.order).toEqual(['ana', 'ben', 'cy']);
  });

  it('draws a tile in round 2 that replaces a scene tile and gets a bullet', () => {
    const h = startedGame(4, {}, { events: false });
    toPresentations(h);
    presentAll(h);
    const g = h.game();
    expect(g.round).toBe(2);
    expect(g.step?.kind).toBe('replace');
    expect(h.reject({ type: 'replace-tile', slot: 1 }, HOST)).toBe('special-tile');
    const drawn = g.step?.kind === 'replace' ? g.step.drawn : 0;
    const old = g.slots[4]!;
    h.act({ type: 'replace-tile', slot: 4 }, HOST);
    expect(h.game().slots[4]).toEqual({ tile: drawn, bullet: null });
    expect(h.game().removed).toEqual([old]);
    h.act({ type: 'place-bullet', slot: 4, item: 1 }, HOST);
    expect(h.game().stage).toBe('discuss');
  });

  it('ends with the Murderer winning after round 3’s last presentation', () => {
    const h = startedGame(4, {}, { events: false });
    toPresentations(h);
    for (let round = 1; round <= 3; round++) {
      if (round > 1) {
        h.act({ type: 'replace-tile', slot: 2 }, HOST);
        h.act({ type: 'place-bullet', slot: 2, item: 0 }, HOST);
      }
      presentAll(h);
    }
    expect(h.state.phase).toBe('over');
    expect(h.game().result).toMatchObject({ winner: 'murderer', how: 'time' });
    expect(h.game().result!.winners).toEqual(['ana']);
  });
});

describe('the discussion before presentations', () => {
  it('comes after the last bullet in every round, with a soft 2-minute clock by default', () => {
    const h = startedGame(4, {}, { events: false });
    expect(h.state.settings.discussSeconds).toBe(120);
    for (let round = 1; round <= 3; round++) {
      if (round === 1) toDiscussion(h);
      else {
        h.act({ type: 'replace-tile', slot: 2 }, HOST);
        h.act({ type: 'place-bullet', slot: 2, item: 0 }, HOST);
      }
      expect(h.game()).toMatchObject({ stage: 'discuss', round, deadline: h.now + 120_000 });
      expect(h.game().present).toBeNull();
      // Soft: nothing happens by itself at 0.
      expect(inquest.nextDeadline!(h.state)).toBeNull();
      h.tick(10 * 60_000);
      expect(h.game().stage).toBe('discuss');
      presentAll(h);
    }
    expect(h.game().result).toMatchObject({ winner: 'murderer', how: 'time' });
  });

  it('the Forensic Scientist starts the presentations, early or late; the host can too', () => {
    const h = startedGame(4);
    toDiscussion(h);
    expect(h.reject({ type: 'start-presentations' }, 'ben')).toBe('not-fs');
    expect(h.reject({ type: 'done-presenting' }, 'ana')).toBe('wrong-stage');
    h.act({ type: 'start-presentations' }, HOST);
    expect(h.game()).toMatchObject({ stage: 'present', deadline: null });
    expect(h.reject({ type: 'start-presentations' }, HOST)).toBe('wrong-stage');

    // After a handover, the new Forensic Scientist starts them, or the host when they're away.
    const t = startedGame(6, { murderer: 'ana', accomplice: 'ben', witness: 'cy' });
    toDiscussion(t);
    t.act({ type: 'hand-over' }, HOST);
    const fs = t.game().fs;
    expect(t.game().stage).toBe('discuss');
    expect(t.reject({ type: 'start-presentations' }, 'ben')).toBe('not-fs');
    t.act({ type: 'start-presentations' }, fs);
    expect(t.game().present!.order).not.toContain(fs);
    const away = startedGame(5);
    toDiscussion(away);
    away.state = inquest.playerLeft(away.state, HOST, away.now);
    expect(away.game().stage).toBe('discuss');
    away.act({ type: 'start-presentations' }, away.game().fs);
    expect(away.game().stage).toBe('present');
  });

  it('can be switched off (no clock), and solving stays open during it', () => {
    const h = startedGame(4, {}, { discussSeconds: 0 });
    const crime = toDiscussion(h);
    expect(h.game()).toMatchObject({ stage: 'discuss', deadline: null });
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'ben');
    expect(h.game().result).toMatchObject({ winner: 'investigators', how: 'solved' });
    const five = startedGame(4, {}, { discussSeconds: 300 });
    toDiscussion(five);
    expect(five.game().deadline).toBe(five.now + 300_000);
  });

  it('rooms saved before the setting existed get the 2-minute default', () => {
    const h = startedGame(4);
    const { discussSeconds: _, ...old } = h.state.settings;
    h.state = { ...h.state, settings: old };
    toDiscussion(h);
    expect(h.game().deadline).toBe(h.now + 120_000);
    startPresentations(h);
    expect(h.game().stage).toBe('present');
  });
});

describe('presentations', () => {
  it('soft timers wait; hard timers pass the turn', () => {
    const soft = startedGame(4);
    toPresentations(soft);
    soft.tick(31_000);
    expect(soft.game().present!.index).toBe(0);
    expect(soft.reject({ type: 'skip-speaker' }, 'ben')).toBe('not-host');
    soft.act({ type: 'skip-speaker' }, HOST);
    expect(soft.game().present!.index).toBe(1);

    const hard = startedGame(4, {}, { presentMode: 'hard', presentSeconds: 20 });
    toPresentations(hard);
    hard.tick(20_000);
    expect(hard.game().present!.index).toBe(1);
    expect(hard.game().notices.at(-1)!.text).toMatch(/Time ran out/);
  });

  it('skips a player who left, and keeps their cards', () => {
    const h = startedGame(5);
    toPresentations(h);
    h.state = inquest.playerLeft(h.state, 'ben', h.now);
    expect(player(h, 'ben').gone).toBe(true);
    expect(player(h, 'ben').clue).toHaveLength(4);
    h.act({ type: 'done-presenting' }, 'ana');
    expect(h.game().present!.order[h.game().present!.index]).toBe('cy');
  });
});

describe('solving', () => {
  it('a right answer wins for the Investigators', () => {
    const h = startedGame(4);
    const crime = toPresentations(h);
    h.act({ type: 'solve', target: crime.murderer, clue: crime.clue, means: crime.means }, 'ben');
    expect(h.state.phase).toBe('over');
    expect(h.game().result).toMatchObject({
      winner: 'investigators',
      how: 'solved',
      solvedBy: 'ben',
    });
    expect(h.game().result!.winners.sort()).toEqual(['ben', 'cy', 'host']);
    expect(h.state.lastSolver).toBe('ben');
  });

  it('a wrong answer spends the badge, and every badge spent ends it', () => {
    const h = startedGame(4);
    const crime = toPresentations(h);
    const m = player(h, 'ana');
    const wrong = { type: 'solve' as const, target: 'ana', clue: m.clue[1]!, means: crime.means };
    h.act(wrong, 'ben');
    expect(player(h, 'ben').badges).toBe(0);
    expect(h.game().attempts.at(-1)).toMatchObject({ by: 'ben', correct: false });
    expect(h.reject(wrong, 'ben')).toBe('no-badge');
    // The Murderer may bluff.
    h.act(wrong, 'ana');
    expect(h.state.phase).toBe('playing');
    h.act(wrong, 'cy');
    expect(h.state.phase).toBe('over');
    expect(h.game().result).toMatchObject({ winner: 'murderer', how: 'badges' });
  });

  it('refuses a pair from two suspects, ruled-out cards and the Forensic Scientist', () => {
    const h = startedGame(4);
    toPresentations(h);
    const a = player(h, 'ana');
    const b = player(h, 'ben');
    expect(
      h.reject({ type: 'solve', target: 'ana', clue: a.clue[0]!, means: b.means[0]! }, 'cy'),
    ).toBe('bad-cards');
    expect(
      h.reject({ type: 'solve', target: 'ana', clue: a.clue[0]!, means: a.means[0]! }, HOST),
    ).toBe('cannot-solve');
    h.state = {
      ...h.state,
      game: {
        ...h.game(),
        players: h
          .game()
          .players.map((p) => (p.id === 'ana' ? { ...p, ruledOut: [a.clue[2]!] } : p)),
      },
    };
    expect(
      h.reject({ type: 'solve', target: 'ana', clue: a.clue[2]!, means: a.means[0]! }, 'cy'),
    ).toBe('ruled-out');
  });
});

describe('the Reversal', () => {
  const six = () => startedGame(6, { murderer: 'ana', accomplice: 'ben', witness: 'cy' });

  it('finding the Witness turns the win round', () => {
    const h = six();
    const crime = toPresentations(h);
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'dee');
    expect(h.game().stage).toBe('reversal');
    expect(h.reject({ type: 'reversal-tap', target: 'cy' }, 'dee')).toBe('not-yours');
    expect(h.reject({ type: 'reversal-tap', target: 'ben' }, 'ana')).toBe('bad-target');
    h.act({ type: 'reversal-tap', target: 'eve' }, 'ben');
    expect(h.reject({ type: 'reversal-confirm' }, 'ana')).toBe('no-pick');
    h.act({ type: 'reversal-tap', target: 'cy' }, 'ana');
    expect(h.reject({ type: 'reversal-confirm' }, 'ben')).toBe('not-murderer');
    h.act({ type: 'reversal-confirm' }, 'ana');
    expect(h.game().result).toMatchObject({
      winner: 'murderer',
      how: 'reversal',
      witnessFound: true,
      solvedBy: 'dee',
    });
    expect(h.game().result!.winners.sort()).toEqual(['ana', 'ben']);
  });

  it('a miss keeps the Investigators’ win', () => {
    const h = six();
    const crime = toPresentations(h);
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'dee');
    h.act({ type: 'reversal-tap', target: 'eve' }, 'ana');
    h.act({ type: 'reversal-confirm' }, 'ana');
    expect(h.game().result).toMatchObject({ winner: 'investigators', witnessFound: false });
  });

  it('on timeout the Murderer’s tap counts, or a random one', () => {
    const h = six();
    const crime = toPresentations(h);
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'dee');
    h.act({ type: 'reversal-tap', target: 'cy' }, 'ana');
    h.tick(60_000);
    expect(h.game().result).toMatchObject({
      how: 'reversal',
      reversalPick: 'cy',
      witnessFound: true,
    });

    const r = six();
    const c2 = toPresentations(r);
    r.act({ type: 'solve', target: 'ana', clue: c2.clue, means: c2.means }, 'dee');
    r.tick(60_000);
    expect(r.state.phase).toBe('over');
    expect(['cy', 'dee', 'eve']).toContain(r.game().result!.reversalPick);
  });
});

describe('events', () => {
  /** Through round 1 and to round 2's draw, with the pile stacked. */
  function toRound2(h: ReturnType<typeof startedGame>, pile: number[]) {
    const crime = toPresentations(h);
    stackPile(h, pile);
    presentAll(h);
    return crime;
  }

  it('Fresh Lead: the FS chooses 1 of 5 scene tiles, then draws the round’s tile', () => {
    const h = startedGame(4);
    toRound2(h, [EVENT_TILES['useful-clue']]);
    const ev = h.game().event!;
    expect(ev.kind).toBe('useful-clue');
    const options = ev.kind === 'useful-clue' ? ev.options : [];
    expect(options).toHaveLength(5);
    expect(inquest.view(h.state, 'ben').game!.event).toMatchObject({ options: null });
    expect(h.reject({ type: 'useful-pick', tile: options[0]!, slot: 0 }, HOST)).toBe(
      'special-tile',
    );
    h.act({ type: 'useful-pick', tile: options[2]!, slot: 3 }, HOST);
    expect(h.game().slots[3]).toEqual({ tile: options[2], bullet: null });
    h.act({ type: 'place-bullet', slot: 3, item: 4 }, HOST);
    expect(h.game().step?.kind).toBe('replace');
    expect(h.game().events).toEqual(['useful-clue']);
  });

  it('Second Chance: the last solver gets a badge, else another tile is drawn', () => {
    const h = startedGame(4);
    h.state = { ...h.state, lastSolver: 'cy' };
    toRound2(h, [EVENT_TILES['good-twist']]);
    expect(player(h, 'cy').badges).toBe(2);
    expect(h.game().twist).toBe('cy');
    expect(h.game().step?.kind).toBe('replace');

    const n = startedGame(4);
    toRound2(n, [EVENT_TILES['good-twist']]);
    expect(n.game().twist).toBeNull();
    expect(n.game().notices.at(-1)!.text).toMatch(/Nobody solved/);
    expect(n.game().step?.kind).toBe('replace');
  });

  it('Cleared Evidence: everyone flips a Clue card the other way round; the key is refused neutrally', () => {
    const h = startedGame(5, { murderer: 'cy' });
    const crime = toRound2(h, [EVENT_TILES['ruled-out']]);
    const ev = h.game().event!;
    expect(ev.kind === 'ruled-out' && ev.order).toEqual(['dee', 'cy', 'ben', 'ana']);
    h.act({ type: 'rule-out', clue: player(h, 'dee').clue[0]! }, 'dee');
    expect(h.reject({ type: 'rule-out', clue: player(h, 'ana').clue[0]! }, 'ana')).toBe(
      'not-your-turn',
    );
    expect(h.refusal({ type: 'rule-out', clue: crime.clue }, 'cy')).toBe('Pick a different card.');
    h.act({ type: 'rule-out', clue: player(h, 'cy').clue[1]! }, 'cy');
    h.tick(30_000);
    expect(player(h, 'ben').ruledOut).toHaveLength(1);
    h.act({ type: 'rule-out', clue: player(h, 'ana').clue[3]! }, 'ana');
    expect(h.game().event).toBeNull();
    expect(player(h, 'cy').ruledOut).toEqual([player(h, 'cy').clue[1]]);
  });

  it('Shifted Bullet: one bullet moves to another item on the same scene tile', () => {
    const h = startedGame(4);
    toRound2(h, [EVENT_TILES.erroneous]);
    expect(h.reject({ type: 'move-bullet', slot: 0, item: 3 }, HOST)).toBe('special-tile');
    expect(h.reject({ type: 'move-bullet', slot: 2, item: 2 }, HOST)).toBe('same-item');
    h.act({ type: 'move-bullet', slot: 2, item: 5 }, HOST);
    expect(h.game().slots[2]!.bullet).toBe(5);
    expect(h.game().bullets.at(-1)).toMatchObject({ movedFrom: 2, item: 5 });
  });

  it('Last Call: two tiles swap in and this round’s presentations are the last', () => {
    const h = startedGame(4);
    toRound2(h, [EVENT_TILES.countdown]);
    expect(h.game()).toMatchObject({ countdown: true, finalRound: 2 });
    h.act({ type: 'replace-tile', slot: 2 }, HOST);
    expect(h.reject({ type: 'replace-tile', slot: 2 }, HOST)).toBe('just-placed');
    h.act({ type: 'replace-tile', slot: 5 }, HOST);
    h.act({ type: 'place-bullet', slot: 2, item: 0 }, HOST);
    h.act({ type: 'place-bullet', slot: 5, item: 0 }, HOST);
    // Then the round's own tile.
    h.act({ type: 'replace-tile', slot: 3 }, HOST);
    h.act({ type: 'place-bullet', slot: 3, item: 0 }, HOST);
    expect(h.game().stage).toBe('discuss');
    presentAll(h);
    expect(h.state.phase).toBe('over');
    expect(h.game().result).toMatchObject({ winner: 'murderer', how: 'time' });
  });

  it('Secret Tip: only the Witness picks, and it is left out without one', () => {
    const h = startedGame(6, { murderer: 'ana', accomplice: 'ben', witness: 'cy' });
    toRound2(h, [EVENT_TILES.testimony]);
    expect(h.reject({ type: 'testify', slot: 3 }, 'dee')).toBe('not-witness');
    const before = h.game().slots[3]!.tile;
    h.act({ type: 'testify', slot: 3 }, 'cy');
    expect(h.game().slots[3]!.tile).not.toBe(before);
    expect(h.game().notices.at(-1)!.text).not.toMatch(/Cy/);

    const t = startedGame(6, { murderer: 'ana', accomplice: 'ben', witness: 'cy' });
    toRound2(t, [EVENT_TILES.testimony]);
    t.tick(30_000);
    expect(t.game().event).toBeNull();

    // Shuffled in without a Witness: never in the pile.
    const n = startedGame(4);
    toPresentations(n);
    presentAll(n);
    expect(n.game().pile).not.toContain(EVENT_TILES.testimony);
    expect(n.game().pile).toContain(EVENT_TILES.countdown);
  });
});

describe('handing over', () => {
  it('only a plain Investigator takes over, and everyone is told', () => {
    const h = startedGame(6, { murderer: 'ana', accomplice: 'ben', witness: 'cy' });
    const crime = toPresentations(h);
    expect(h.reject({ type: 'hand-over' }, 'dee')).toBe('not-host');
    h.act({ type: 'hand-over' }, HOST);
    const g = h.game();
    expect(['dee', 'eve']).toContain(g.fs);
    expect(g.formerFs).toEqual([HOST]);
    expect(g.notices.map((n) => n.text).join(' ')).toMatch(/is now the Forensic Scientist/);
    const fs = g.fs;
    expect(inquest.view(h.state, fs).game!.solution).toMatchObject({ clue: crime.clue });
    expect(inquest.view(h.state, HOST).game!.myRole).toBe('former-forensic');
    expect(inquest.view(h.state, HOST).game!.solution).not.toBeNull();
    expect(
      h.reject({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, fs),
    ).toBe('cannot-solve');
    expect(h.game().present!.order.filter((id) => id !== fs)).not.toContain(fs);
    // The new FS runs the next collection.
    while (h.game().stage === 'present') h.act({ type: 'skip-speaker' }, HOST);
    expect(h.game().step?.kind).toBe('replace');
    expect(h.reject({ type: 'replace-tile', slot: 2 }, HOST)).toBe('not-fs');
  });

  it('hands over by itself when the Forensic Scientist leaves for good', () => {
    const h = startedGame(5);
    toPresentations(h);
    h.state = inquest.playerLeft(h.state, HOST, h.now);
    expect(['ben', 'cy', 'dee']).toContain(h.game().fs);
  });
});

describe('the end', () => {
  it('Play again keeps the settings and the last solver', () => {
    const h = startedGame(4, {}, { hand: 5, presentMode: 'hard' });
    const crime = toPresentations(h);
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'cy');
    h.act({ type: 'play-again' }, HOST);
    expect(h.state.phase).toBe('playing');
    expect(h.state.settings).toMatchObject({ hand: 5, presentMode: 'hard', fsPick: HOST });
    expect(h.state.lastSolver).toBe('cy');
    expect(h.state.gamesPlayed).toBe(2);
    expect(holder(h, 'forensic').id).toBe(HOST);
  });
});

describe('the test event order', () => {
  it('puts the named events on top when they are shuffled in, then resets', async () => {
    const { setTestEventOrder } = await import('./game.ts');
    setTestEventOrder(['countdown', 'erroneous']);
    try {
      const h = startedGame(4);
      toPresentations(h);
      presentAll(h);
      expect(h.game().events).toEqual(['countdown']);
      expect(h.game().pile[0]).toBe(EVENT_TILES.erroneous);
      expect(h.game().pile).not.toContain(EVENT_TILES['useful-clue']);
    } finally {
      setTestEventOrder([]);
    }
  });
});
