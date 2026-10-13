import { describe, expect, it } from 'vitest';
import { ALLIES_SCENE_TILES, EVENT_TILES, UNKNOWN_LOCATION_TILE } from './content.ts';
import { inquestBotInfo } from './bot.ts';
import { inquest } from './game.ts';
import { rolesFor, startProblem, suggestedRoles } from './setup.ts';
import {
  HOST,
  type Harness,
  IDS,
  commit,
  harness,
  player,
  stackPile,
  startedGame,
  toDiscussion,
  toFinal,
} from './test-utils.ts';
import type { RoleId, Settings } from './types.ts';

const inquestBotInfoRetry = (code: string) => inquestBotInfo.retry!(code);

const ALL: Partial<Settings> = {
  allies: true,
  labTech: true,
  insideMan: true,
  protective: true,
  presentations: false,
  events: false,
};

// Nine at the table: host is the Forensic Scientist, ana the Murderer, ben the Accomplice, cy the
// Witness, dee the Lab Technician, eve the Inside Man, fay the Protective Detail, gus and hal
// Investigators.
const ROLES: Record<string, RoleId> = {
  host: 'forensic',
  ana: 'murderer',
  ben: 'accomplice',
  cy: 'witness',
  dee: 'lab-technician',
  eve: 'inside-man',
  fay: 'protective-detail',
  gus: 'investigator',
  hal: 'investigator',
};
const nine = (settings: Partial<Settings> = {}) =>
  startedGame(
    9,
    {
      murderer: 'ana',
      accomplice: 'ben',
      witness: 'cy',
      'lab-technician': 'dee',
      'inside-man': 'eve',
      'protective-detail': 'fay',
    },
    { ...ALL, ...settings },
  );

/** Round 1's discussion ended: the Allies Phase. */
function toAllies(h: Harness) {
  const crime = toDiscussion(h);
  h.act({ type: 'end-discussion' }, HOST);
  return crime;
}

const seats = (n: number) => IDS.slice(0, n).map((id) => ({ id, playing: true, volunteer: false }));

describe('Allies setup', () => {
  it('adds its roles from 6 players, and the Protective Detail only with the Witness', () => {
    const s = { accomplice: true, witness: true, ...ALL } as Settings;
    expect(rolesFor(9, s).sort()).toEqual(
      [
        'forensic',
        'murderer',
        'accomplice',
        'witness',
        'lab-technician',
        'inside-man',
        'protective-detail',
        'investigator',
        'investigator',
      ].sort(),
    );
    expect(rolesFor(5, s)).not.toContain('lab-technician');
    expect(rolesFor(9, { ...s, witness: false })).not.toContain('protective-detail');
    // The expansion off switches its roles off too.
    expect(rolesFor(9, { ...s, allies: false })).not.toContain('inside-man');
  });

  it('suggests the rulebook’s sets', () => {
    expect(suggestedRoles(6)).toEqual({
      accomplice: true,
      witness: true,
      labTech: false,
      insideMan: false,
    });
    expect(suggestedRoles(7)).toMatchObject({ labTech: true, insideMan: false });
    expect(suggestedRoles(8)).toMatchObject({ labTech: true, insideMan: true });
  });

  it('seats up to 14 with the expansion, 12 without, and needs one plain Investigator', () => {
    const base = harness(4).state.settings;
    expect(startProblem(base, seats(13))).toBe('At most 12 can play without the Allies expansion.');
    expect(startProblem({ ...base, fsMode: 'random', allies: true }, seats(14))).toBeNull();
    const crowded = { ...base, fsMode: 'random' as const, ...ALL };
    expect(startProblem(crowded, seats(6))).toBe('Too many roles for 6 players: switch one off.');
    expect(startProblem(crowded, seats(8))).toBeNull();
    const h = harness(14);
    expect(Object.values(h.state.seats).filter((x) => x.playing)).toHaveLength(12);
    h.act({ type: 'update-settings', allies: true });
    h.act({ type: 'sit', playing: true }, 'lee');
    h.act({ type: 'sit', playing: true }, 'mo');
    expect(Object.values(h.state.seats).filter((x) => x.playing)).toHaveLength(14);
  });

  it('refuses the Protective Detail without the Witness, and drops it with the Witness', () => {
    const h = harness(8);
    h.act({ type: 'update-settings', allies: true, protective: true });
    expect(h.state.settings.protective).toBe(true);
    h.act({ type: 'update-settings', witness: false });
    expect(h.state.settings.protective).toBe(false);
    expect(h.reject({ type: 'update-settings', protective: true })).toBe('needs-witness');
  });

  it('shuffles in its cards and tiles, and deals up to 14', () => {
    const h = startedGame(14, {}, { allies: true, events: false });
    const g = h.game();
    expect(g.players).toHaveLength(14);
    const cards = g.players.flatMap((p) => p.clue);
    expect(cards.some((c) => c > 200)).toBe(true);
    expect(Math.max(...cards)).toBeLessThanOrEqual(289);
    expect(Math.max(...g.players.flatMap((p) => p.means))).toBeLessThanOrEqual(144);
    for (const t of ALLIES_SCENE_TILES) expect(g.pile).toContain(t);
    const off = startedGame(6);
    expect(off.game().pile.some((t) => ALLIES_SCENE_TILES.includes(t))).toBe(false);
  });

  it('Unknown Location: its one tile replaces the four', () => {
    const h = startedGame(4, {}, { allies: true, unknownLocation: true });
    commit(h);
    expect(h.reject({ type: 'pick-location', tile: 2 }, HOST)).toBe('bad-tile');
    h.act({ type: 'pick-location', tile: UNKNOWN_LOCATION_TILE }, HOST);
    expect(h.game().slots[1]!.tile).toBe(UNKNOWN_LOCATION_TILE);
  });
});

describe('the Allies Phase', () => {
  it('comes once after round 1: the Lab Technician, then the Inside Man, then round 2', () => {
    const h = nine();
    const crime = toAllies(h);
    expect(h.game()).toMatchObject({ stage: 'allies', round: 1 });
    expect(h.game().allies).toMatchObject({ steps: ['lab', 'inside'], step: 'lab' });
    // Nobody solves while the allies work, and only the right role acts in each step.
    expect(
      h.reject({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'gus'),
    ).toBe('not-now');
    expect(h.reject({ type: 'inside-pick', target: 'gus' }, 'eve')).toBe('wrong-stage');
    expect(h.reject({ type: 'lab-skip' }, 'gus')).toBe('not-yours');
    h.act({ type: 'lab-check', owner: 'ana', deck: 'clue', n: crime.clue }, 'dee');
    expect(h.game().allies).toMatchObject({
      step: 'inside',
      labDone: true,
      lab: { owner: 'ana', deck: 'clue', n: crime.clue, hit: true },
    });
    expect(h.game().notices.at(-1)!.text).toBe('The Lab Technician has checked a card.');
    expect(h.reject({ type: 'lab-skip' }, 'dee')).toBe('wrong-stage');
    // Anyone with a badge, himself included; never the Forensic Scientist.
    expect(h.reject({ type: 'inside-pick', target: HOST }, 'eve')).toBe('no-badge');
    h.act({ type: 'inside-pick', target: 'eve' }, 'eve');
    expect(player(h, 'eve').badges).toBe(0);
    expect(h.game().notices.at(-1)!.text).toBe('Eve lost their badge.');
    expect(h.game()).toMatchObject({ stage: 'collect', round: 2, deadline: null });
    expect(h.game().allies).toMatchObject({ step: null, lostBadge: 'eve' });
    // Only once.
    h.act({ type: 'replace-tile', slot: 2 }, HOST);
    h.act({ type: 'place-bullet', slot: 2, item: 0 }, HOST);
    h.act({ type: 'end-discussion' }, HOST);
    expect(h.game()).toMatchObject({ stage: 'collect', round: 3 });
  });

  it('a miss is a miss, and the check can be skipped', () => {
    const h = nine();
    const crime = toAllies(h);
    const means = player(h, 'ana').means.find((m) => m !== crime.means)!;
    h.act({ type: 'lab-check', owner: 'ana', deck: 'means', n: means }, 'dee');
    expect(h.game().allies!.lab).toMatchObject({ hit: false });
    const s = nine();
    toAllies(s);
    s.act({ type: 'lab-skip' }, 'dee');
    expect(s.game().allies).toMatchObject({ labDone: true, lab: null, step: 'inside' });
  });

  it('on timeout: no check, then a random badge', () => {
    const h = nine();
    toAllies(h);
    h.tick(45_000);
    expect(h.game().allies).toMatchObject({ step: 'inside', lab: null, labDone: true });
    h.tick(45_000);
    const lost = h.game().allies!.lostBadge!;
    expect(lost).toBeTruthy();
    expect(player(h, lost).badges).toBe(0);
    expect(h.game().stage).toBe('collect');
  });

  it('has only the steps of the roles in play, and none without them', () => {
    const lab = startedGame(7, { 'lab-technician': 'dee' }, { ...ALL, insideMan: false });
    toAllies(lab);
    expect(lab.game().allies!.steps).toEqual(['lab']);
    lab.act({ type: 'lab-skip' }, 'dee');
    expect(lab.game().stage).toBe('collect');
    const none = startedGame(6, {}, { allies: true, presentations: false, events: false });
    toAllies(none);
    expect(none.game()).toMatchObject({ stage: 'collect', round: 2, allies: null });
  });

  it('a lost badge means one accuser fewer in the final accusations', () => {
    const h = nine({ finalAccusations: true });
    toAllies(h);
    h.act({ type: 'lab-skip' }, 'dee');
    h.act({ type: 'inside-pick', target: 'gus' }, 'eve');
    for (let r = 2; r <= 3; r++) {
      h.act({ type: 'replace-tile', slot: 2 }, HOST);
      h.act({ type: 'place-bullet', slot: 2, item: 0 }, HOST);
      h.act({ type: 'end-discussion' }, HOST);
    }
    expect(h.game().stage).toBe('final');
    expect(h.game().final!.order).not.toContain('gus');
    expect(h.game().final!.order).toContain('eve');
  });

  it('the Inside Man, refused the real pair in his final turn, just accuses again', () => {
    const h = nine({ finalAccusations: true });
    const crime = toAllies(h);
    h.act({ type: 'lab-skip' }, 'dee');
    h.act({ type: 'inside-pick', target: 'gus' }, 'eve');
    for (let r = 2; r <= 3; r++) {
      h.act({ type: 'replace-tile', slot: 2 }, HOST);
      h.act({ type: 'place-bullet', slot: 2, item: 0 }, HOST);
      h.act({ type: 'end-discussion' }, HOST);
    }
    // Give him the turn.
    const f = h.game().final!;
    h.state = { ...h.state, game: { ...h.game(), final: { ...f, index: f.order.indexOf('eve') } } };
    expect(
      h.refusal({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'eve'),
    ).toBe('You can’t make that accusation — pick a different pair.');
    expect(h.game().final!.order[h.game().final!.index]).toBe('eve');
    const other = player(h, 'ana').means.find((m) => m !== crime.means)!;
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: other }, 'eve');
    expect(h.game().attempts.at(-1)).toMatchObject({ by: 'eve', correct: false, final: true });
  });

  it('taking the last badge ends the game for the Murderer’s side', () => {
    const h = startedGame(
      6,
      { 'inside-man': 'ben' },
      { ...ALL, labTech: false, protective: false, accomplice: false, witness: false },
    );
    toDiscussion(h);
    // Everyone but cy spends their badge first.
    for (const id of ['ana', 'ben', 'dee', 'eve']) {
      const t = player(h, id === 'eve' ? 'dee' : 'eve');
      h.act({ type: 'solve', target: t.id, clue: t.clue[1]!, means: t.means[1]! }, id);
    }
    h.act({ type: 'end-discussion' }, HOST);
    expect(h.game().stage).toBe('allies');
    h.act({ type: 'inside-pick', target: 'cy' }, 'ben');
    expect(h.game().result).toMatchObject({ winner: 'murderer', how: 'badges' });
  });
});

describe('Allies knowledge and the Reversal', () => {
  it('the Protective Detail knows the Witness; the Witness never sees the Inside Man', () => {
    const h = nine();
    expect(inquest.view(h.state, 'fay').game!.protectedWitness).toBe('cy');
    for (const id of Object.keys(ROLES).filter((x) => x !== 'fay'))
      expect(inquest.view(h.state, id).game!.protectedWitness, id).toBeNull();
    expect(inquest.view(h.state, 'cy').game!.witnessPair).toEqual(['ana', 'ben']);
    // The Inside Man knows nobody, and nobody knows him.
    expect(inquest.view(h.state, 'eve').game!).toMatchObject({ partner: null, solution: null });
    expect(inquest.view(h.state, 'ana').game!.partner).toBe('ben');
  });

  it('the Inside Man joins the Reversal: the side sees itself and its taps there', () => {
    const h = nine();
    const crime = toAllies(h);
    h.act({ type: 'lab-skip' }, 'dee');
    h.act({ type: 'inside-pick', target: 'hal' }, 'eve');
    // The Inside Man is on the Murderer's side: the real pair is refused to him privately, with
    // a neutral message (he doesn't know the crime, and the refusal mustn't tell him), and
    // nothing changes: he may simply pick another pair.
    const before = h.state;
    expect(
      h.reject({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'eve'),
    ).toBe('no-accusation');
    expect(
      h.refusal({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'eve'),
    ).toBe('You can’t make that accusation — pick a different pair.');
    expect(h.state).toBe(before);
    expect(inquestBotInfoRetry('no-accusation')).toBe(true);
    expect(inquestBotInfoRetry('own-crime')).toBe(false);
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'gus');
    expect(h.game().stage).toBe('reversal');
    const team = [
      { id: 'ana', role: 'murderer' },
      { id: 'ben', role: 'accomplice' },
      { id: 'eve', role: 'inside-man' },
    ];
    for (const id of ['ana', 'ben', 'eve'])
      expect(inquest.view(h.state, id).game!.team, id).toEqual(team);
    for (const id of ['cy', 'dee', 'fay', 'gus', HOST, null])
      expect(inquest.view(h.state, id).game!.team, `${id}`).toBeNull();
    expect(h.reject({ type: 'reversal-tap', target: 'ben' }, 'eve')).toBe('bad-target');
    h.act({ type: 'reversal-tap', target: 'fay' }, 'eve');
    expect(inquest.view(h.state, 'ana').game!.reversal!.insideTap).toBe('fay');
    expect(inquest.view(h.state, 'gus').game!.reversal!.insideTap).toBeNull();
    h.act({ type: 'reversal-tap', target: 'fay' }, 'ana');
    h.act({ type: 'reversal-confirm' }, 'ana');
    expect(h.game().result).toMatchObject({ winner: 'investigators', how: 'reversal' });
    expect(h.game().result!.winners).not.toContain('eve');
  });
});

describe('Change of Heart (perfect-crime)', () => {
  const four = () =>
    startedGame(4, {}, { allies: true, presentations: false, finalAccusations: false });

  it('an event peeked: the Forensic Scientist switches, secretly, and loses with the Investigators', () => {
    const h = four();
    const crime = toDiscussion(h);
    stackPile(h, [EVENT_TILES['perfect-crime'], EVENT_TILES['ruled-out'], 10, 11]);
    h.act({ type: 'end-discussion' }, HOST);
    expect(h.game().events).toEqual(['perfect-crime']);
    expect(h.game().perfect).toEqual([
      { by: HOST, tile: EVENT_TILES['ruled-out'], switched: true, round: 2 },
    ]);
    // The set-aside tile never comes up, and another tile is drawn for the round.
    expect(h.game().step).toMatchObject({ kind: 'replace', drawn: 10 });
    expect(inquest.view(h.state, HOST).game!.perfect).toHaveLength(1);
    for (const id of ['ana', 'ben', 'cy', null]) {
      const v = inquest.view(h.state, id);
      expect(v.game!.perfect, `${id}`).toEqual([]);
      expect(JSON.stringify(v), `${id}`).not.toContain('"switched"');
    }
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'ben');
    expect(h.game().result!.winners.sort()).toEqual(['ben', 'cy']);
    expect(inquest.view(h.state, 'ben').game!.perfect[0]).toMatchObject({ switched: true });
  });

  it('a scene tile peeked: no switch; the Murderer’s side winning leaves the FS a loser', () => {
    const h = four();
    toDiscussion(h);
    stackPile(h, [EVENT_TILES['perfect-crime'], 12, 13]);
    h.act({ type: 'end-discussion' }, HOST);
    expect(h.game().perfect![0]).toMatchObject({ tile: 12, switched: false });
    expect(h.game().step).toMatchObject({ kind: 'replace', drawn: 13 });
  });

  it('a switched Forensic Scientist wins with the Murderer’s side', () => {
    const h = four();
    toDiscussion(h);
    stackPile(h, [EVENT_TILES['perfect-crime'], EVENT_TILES.erroneous]);
    h.act({ type: 'end-discussion' }, HOST);
    h.act({ type: 'replace-tile', slot: 2 }, HOST);
    h.act({ type: 'place-bullet', slot: 2, item: 0 }, HOST);
    h.act({ type: 'end-discussion' }, HOST);
    h.act({ type: 'replace-tile', slot: 3 }, HOST);
    h.act({ type: 'place-bullet', slot: 3, item: 0 }, HOST);
    h.act({ type: 'end-discussion' }, HOST);
    expect(h.game().result).toMatchObject({ winner: 'murderer', how: 'time' });
    expect(h.game().result!.winners.sort()).toEqual(['ana', HOST]);
  });

  it('with an empty pile, reshuffles the discarded scene tiles, then peeks', () => {
    const h = four();
    toDiscussion(h);
    stackPile(h, [14]);
    h.state = { ...h.state, game: { ...h.game(), pile: [14] } };
    h.act({ type: 'end-discussion' }, HOST);
    const gone = h.game().slots[2]!.tile;
    h.act({ type: 'replace-tile', slot: 2 }, HOST);
    h.act({ type: 'place-bullet', slot: 2, item: 0 }, HOST);
    expect(h.game().removed.map((s) => s.tile)).toContain(gone);
    h.state = { ...h.state, game: { ...h.game(), pile: [EVENT_TILES['perfect-crime']] } };
    h.act({ type: 'end-discussion' }, HOST);
    expect(h.game().perfect![0]).toMatchObject({ tile: gone, switched: false, round: 3 });
    expect(h.game().notices.map((n) => n.text)).toContain(
      'The pile was empty, so the discarded scene tiles were reshuffled.',
    );
  });

  it('only comes up with the expansion on', () => {
    const h = startedGame(4, {}, { presentations: false });
    toDiscussion(h);
    h.act({ type: 'end-discussion' }, HOST);
    expect(h.game().pile).not.toContain(EVENT_TILES['perfect-crime']);
    expect(h.game().events).not.toContain('perfect-crime');
  });

  it('never makes the switched Forensic Scientist accuse', () => {
    const h = startedGame(
      4,
      {},
      { allies: true, presentations: false, events: false, finalAccusations: true },
    );
    toFinal(h);
    expect(h.game().final!.order).not.toContain(HOST);
  });
});

describe('Allies redaction, every viewer at every stage', () => {
  const VIEWERS = [...Object.keys(ROLES), null];

  function check(h: Harness, label: string) {
    const g = h.game();
    const over = h.state.phase === 'over';
    for (const viewer of VIEWERS) {
      const v = inquest.view(h.state, viewer);
      const json = JSON.stringify(v);
      const at = `${label} / ${viewer ?? 'spectator'}`;
      expect(json, at).not.toContain('"pile"');
      for (const [id, role] of Object.entries(ROLES)) {
        const p = v.game!.players.find((x) => x.id === id)!;
        expect(p.role, `${at}: ${id}`).toBe(over || id === viewer ? role : null);
      }
      if (!over) {
        // Hidden role names only ever reach their holder.
        for (const role of ['inside-man', 'lab-technician', 'protective-detail'] as const)
          if (ROLES[viewer ?? ''] !== role && !v.game!.team)
            expect(json, at).not.toContain(`"${role}"`);
        // The Inside Man is in no list but his own until the Reversal.
        if (viewer !== 'eve' && g.stage !== 'reversal') expect(json, at).not.toMatch(/"eve"\]/);
        if (viewer !== 'dee') expect(v.game!.allies?.lab ?? null, at).toBeNull();
        if (viewer !== HOST) expect(v.game!.perfect, at).toEqual([]);
        if (viewer !== 'fay') expect(v.game!.protectedWitness, at).toBeNull();
        if (viewer === 'cy') expect(v.game!.witnessPair, at).toEqual(['ana', 'ben']);
        const team = g.stage === 'reversal' && ['ana', 'ben', 'eve'].includes(viewer ?? '');
        if (!team) expect(v.game!.team, at).toBeNull();
      }
    }
  }

  it('night, the Allies Phase, a Change of Heart, the Reversal and the end', () => {
    const h = nine({ events: true });
    check(h, 'night');
    const crime = toAllies(h);
    check(h, 'allies: lab');
    h.act({ type: 'lab-check', owner: 'ana', deck: 'means', n: crime.means }, 'dee');
    expect(inquest.view(h.state, 'dee').game!.allies!.lab).toMatchObject({ hit: true });
    check(h, 'allies: inside');
    // Round 2's draw will be a Change of Heart, peeking at an event.
    stackPile(h, [EVENT_TILES['perfect-crime'], EVENT_TILES.countdown]);
    h.act({ type: 'inside-pick', target: 'hal' }, 'eve');
    check(h, 'round 2 with a Change of Heart');
    expect(h.game().perfect).toMatchObject([{ by: HOST, switched: true }]);
    // Who took the badge appears nowhere.
    for (const viewer of VIEWERS)
      expect(JSON.stringify(inquest.view(h.state, viewer).game!.notices)).not.toMatch(/\bEve\b/);
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'gus');
    check(h, 'reversal');
    h.act({ type: 'reversal-tap', target: 'cy' }, 'eve');
    check(h, 'reversal with a tap');
    h.act({ type: 'reversal-tap', target: 'cy' }, 'ana');
    h.act({ type: 'reversal-confirm' }, 'ana');
    check(h, 'over');
    const end = inquest.view(h.state, 'gus').game!;
    expect(end.allies!.lab).toMatchObject({ owner: 'ana', hit: true });
    expect(end.perfect).toHaveLength(1);
    expect(end.team!.map((t) => t.id)).toEqual(['ana', 'ben', 'eve']);
  });
});
