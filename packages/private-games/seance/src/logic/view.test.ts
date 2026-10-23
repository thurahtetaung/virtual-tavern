import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { PILLARS, POOL_IDS } from './cards.ts';
import { seance } from './game.ts';
import {
  HOST,
  type Harness,
  colorOf,
  guessAll,
  playHour,
  readyAll,
  sendAll,
  startedGame,
  toFinal,
} from './test-utils.ts';

// Five at the table: host is the ghost, ana, ben, cy and dee are psychics; zed watches.
const PSYCHICS = ['ana', 'ben', 'cy', 'dee'];

function game(settings: Parameters<typeof startedGame>[1] = {}) {
  const h = startedGame(5, settings);
  h.state = seance.playerJoined(h.state, { id: 'zed', name: 'Zed' });
  return h;
}

/** Everything every viewer may (and may not) see, checked on the raw JSON they would receive. */
function checkViews(h: Harness, label: string) {
  const g = h.game();
  const over = h.state.phase === 'over';
  const viewers = [g.ghost, ...g.psychics.map((p) => p.id), 'zed', ...g.formerGhosts, null];
  for (const viewer of viewers) {
    const v = seance.view(h.state, viewer);
    const json = JSON.stringify(v);
    const at = `${label} / ${viewer ?? 'nobody'}`;
    const ghost = viewer !== null && viewer === g.ghost;
    const knows = ghost || over;
    expect(v.game!.third, at).toBe(g.third ?? 'object');
    // The draw pile and the hidden seed never leave the server.
    expect(json, at).not.toContain('"deck"');
    expect(json, at).not.toContain('"seed"');
    expect(json, at).not.toContain('"discard"');
    // The ghost's hand: the ghost only (its size is public).
    if (ghost) expect(v.game!.hand, at).toEqual(g.hand);
    else {
      expect(v.game!.hand, at).toBeNull();
      expect(json, at).not.toContain('"hand":[');
    }
    expect(v.game!.handCount, at).toBe(g.hand.length);
    // Every verdict (the past guesses) is public, the same for everyone.
    expect(v.game!.verdicts, at).toEqual(g.verdicts);
    // Each psychic's three cards: the ghost and the end only. Found cards are public.
    for (const p of v.game!.psychics) {
      const real = g.psychics.find((x) => x.color === p.color)!;
      expect(p.found, at).toEqual(real.found);
      if (knows) expect(p.targets, at).toEqual(real.targets);
      else expect(p.targets, at).toBeNull();
    }
    if (!knows) expect(json, at).not.toContain('"targets":[');
    // The final: the culprit, the unrevealed shared cards, the tags and the votes stay hidden.
    const f = g.final;
    const vf = v.game!.final;
    if (f && vf) {
      expect(vf.sharedCount, at).toBe(f.shared.length);
      if (knows) {
        expect(vf.culprit, at).toBe(f.culprit);
        expect(vf.shared, at).toEqual(f.shared);
        expect(vf.tags, at).toEqual(f.tags);
      } else {
        expect(vf.culprit, at).toBeNull();
        expect(vf.tags, at).toBeNull();
        expect(vf.shared, at).toEqual(f.shared.slice(0, f.revealed));
        for (const card of f.shared.slice(f.revealed)) expect(vf.shared, at).not.toContain(card);
        expect(json, at).not.toContain('"tags":[');
        if (f.culprit !== null) expect(json, at).not.toContain(`"culprit":${f.culprit}`);
      }
      if (over) expect(vf.votes, at).toEqual(f.votes);
      else {
        expect(vf.votes, at).toBeNull();
        const mine = g.psychics.find((p) => p.id === viewer);
        expect(vf.myVote, at).toBe(mine ? f.votes[mine.color] : undefined);
        expect(vf.voted.sort(), at).toEqual(Object.keys(f.votes).sort());
      }
    }
    // Roles: who is the ghost is public; only the viewer's own role is theirs.
    const role = v.game!.myRole;
    if (ghost) expect(role, at).toBe('ghost');
    else if (g.psychics.some((p) => p.id === viewer)) expect(role, at).toBe('psychic');
    else if (viewer !== null && g.formerGhosts.includes(viewer))
      expect(role, at).toBe('former-ghost');
    else expect(role, at).toBeNull();
  }
}

describe('view() redaction, every viewer at every phase', () => {
  it('lobby', () => {
    const h = startedGame(5);
    h.act({ type: 'back-to-lobby' }, HOST);
    for (const viewer of ['host', 'ana', null]) {
      const json = JSON.stringify(seance.view(h.state, viewer));
      expect(json).not.toContain('"seed"');
      expect(seance.view(h.state, viewer).game).toBeNull();
    }
  });

  it('visions, tokens, verdicts, a new hour, the final and a win', () => {
    const h = game();
    checkViews(h, 'hour 1, no visions');
    h.act({ type: 'send', to: colorOf(h, 'ana'), cards: h.game().hand.slice(0, 2) }, HOST);
    checkViews(h, 'hour 1, one vision');
    sendAll(h);
    guessAll(h, ['ana', 'ben']);
    h.act({ type: 'mark', target: colorOf(h, 'ana'), kind: 'yes' }, 'cy');
    h.act({ type: 'raven', cards: [h.game().hand[0]!] }, HOST);
    checkViews(h, 'hour 1, guesses and tokens');
    readyAll(h);
    checkViews(h, 'hour 1, verdicts');
    h.act({ type: 'continue' }, HOST);
    checkViews(h, 'hour 2');
    playHour(h);
    playHour(h);
    toFinal(h);
    checkViews(h, 'final, before the shared vision');
    // Spread the levels so the vote has all three stages (5 players: 5 and 7 unlock cards).
    h.state = {
      ...h.state,
      game: {
        ...h.game(),
        psychics: h.game().psychics.map((p, i) => ({ ...p, level: [2, 5, 6, 9][i]! })),
      },
    };
    h.act(
      {
        type: 'shared',
        group: 1,
        cards: h.game().hand.slice(0, 3),
        tags: ['suspect', null, 'object'],
      },
      HOST,
    );
    checkViews(h, 'vote stage 1');
    h.act({ type: 'vote', group: 1 }, 'ana');
    checkViews(h, 'vote stage 2');
    h.act({ type: 'vote', group: 1 }, 'ben');
    checkViews(h, 'vote stage 2, one vote in');
    h.act({ type: 'vote', group: 0 }, 'cy');
    checkViews(h, 'vote stage 3');
    h.act({ type: 'vote', group: 1 }, 'dee');
    expect(h.game().result!.win).toBe(true);
    checkViews(h, 'over (win)');
  });

  it('a loss by the clock reveals every target', () => {
    const h = game();
    for (let i = 0; i < 7; i++) playHour(h, []);
    expect(h.state.phase).toBe('over');
    checkViews(h, 'over (clock)');
  });

  it('after a ghost handover, the old ghost sees what any watcher sees', () => {
    const h = game();
    sendAll(h);
    h.act({ type: 'hand-ghost', to: 'zed' }, HOST);
    checkViews(h, 'after handover');
    expect(seance.view(h.state, 'zed').game!.hand).toEqual(h.game().hand);
    expect(seance.view(h.state, HOST).game!.hand).toBeNull();
    expect(PSYCHICS.every((id) => seance.view(h.state, id).game!.hand === null)).toBe(true);
  });

  it('stories and every extra pool: the same boundary', () => {
    const h = game({ third: 'story', pools: [...POOL_IDS] });
    checkViews(h, 'stories, hour 1');
    playHour(h, ['ana']);
    checkViews(h, 'stories, hour 2');
    toFinal(h);
    checkViews(h, 'stories, final');
    h.act(
      { type: 'shared', group: 0, cards: h.game().hand.slice(0, 3), tags: ['object', null, null] },
      HOST,
    );
    checkViews(h, 'stories, vote');
  });
});

/** Every psychic whose stage is up votes, at random, until the game ends. */
function voteOut(h: Harness, pick: (n: number) => number) {
  while (h.state.phase !== 'over') {
    const f = h.game().final!;
    const next = h.game().psychics.find((p) => {
      if (p.retired || f.votes[p.color] !== undefined) return false;
      const me = seance.view(h.state, p.id).game!.psychics.find((x) => x.id === p.id)!;
      return me.voteStage <= f.revealed;
    });
    if (!next) throw new Error('nobody can vote');
    h.act({ type: 'vote', group: pick(f.groups.length) }, next.id);
    checkViews(h, `fuzz vote by ${next.id}`);
  }
}

describe('view() fuzz: seeded games with every option', () => {
  it('never leaks across 150 games', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = createRng(seed * 7919);
      const players = 3 + r.int(5);
      const pools = POOL_IDS.filter(() => r.int(2) === 1);
      const h = startedGame(
        players,
        {
          third: r.int(2) ? 'story' : 'object',
          pools,
          difficulty: (['easy', 'medium', 'hard'] as const)[r.int(3)]!,
        },
        seed,
      );
      h.state = seance.playerJoined(h.state, { id: 'zed', name: 'Zed' });
      const label = `seed ${seed}`;
      checkViews(h, label);
      while (h.game().stage === 'visions') {
        for (const p of h.game().psychics) {
          if (p.step >= 3 || h.game().sent.includes(p.color)) continue;
          const hand = h.game().hand;
          h.act({ type: 'send', to: p.color, cards: hand.slice(0, 1 + r.int(3)) }, HOST);
        }
        for (const p of h.game().psychics) {
          if (p.step >= 3) continue;
          const pillar = PILLARS[p.step]!;
          const table = h.game().table[pillar];
          const card = r.int(3) ? p.targets[p.step]! : table[r.int(table.length)]!;
          h.act({ type: 'intuition', card }, p.id);
        }
        const g = h.game();
        if (g.clairvoyance) {
          for (const p of g.psychics) {
            const other = g.psychics[r.int(g.psychics.length)]!;
            if (other.color === p.color || other.step >= 3 || p.tokens <= 0 || r.int(2)) continue;
            h.act({ type: 'mark', target: other.color, kind: r.int(2) ? 'yes' : 'no' }, p.id);
          }
        }
        checkViews(h, `${label} hour ${g.hour}`);
        readyAll(h);
        checkViews(h, `${label} verdicts ${g.hour}`);
        if (h.state.phase === 'over') break;
        h.act({ type: 'continue' }, HOST);
      }
      if (h.state.phase !== 'over') {
        expect(h.game().stage, label).toBe('shared');
        const tags = [0, 1, 2].map(() => [null, ...PILLARS][r.int(4)]!);
        const groups = h.game().final!.groups.length;
        h.act(
          { type: 'shared', group: r.int(groups), cards: h.game().hand.slice(0, 3), tags },
          HOST,
        );
        checkViews(h, `${label} shared`);
        voteOut(h, (n) => r.int(n));
      }
      checkViews(h, `${label} over`);
    }
  }, 120_000);
});
