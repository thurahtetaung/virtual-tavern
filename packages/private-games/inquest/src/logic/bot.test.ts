import { type BotCtx, type Rng, createRng, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { inquestBot, inquestBotInfo } from './bot.ts';
import { SCENE_SLOTS } from './content.ts';
import { inquest } from './game.ts';
import { EVENT_TILES } from './content.ts';
import {
  HOST,
  commit,
  holder,
  presentAll,
  stackPile,
  startedGame,
  toFinal,
  toPresentations,
} from './test-utils.ts';
import type { InquestAction, InquestView, Settings } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const ctx = (me: string, seed = 1): BotCtx => ({
  me,
  now: 0,
  rng: createRng(seed),
  words: () => [],
});

/**
 * The human Forensic Scientist, played by the test (bots never take that seat): the host, who
 * also starts the game with the playtest's own setup.
 */
const forensic =
  (mode: Partial<Settings> = {}) =>
  (view: InquestView, me: string, rng: Rng): InquestAction | null => {
    if (view.phase === 'lobby') {
      const setup = inquestBotInfo.setup!(me)[0] as Extract<
        InquestAction,
        { type: 'update-settings' }
      >;
      const want = { ...setup, events: false, ...mode };
      const ready = Object.entries(want).every(
        ([k, v]) => k === 'type' || view.settings[k as keyof Settings] === v,
      );
      return ready ? { type: 'start' } : want;
    }
    const g = view.game;
    if (!g || g.fs !== me) return null;
    // After the table has talked it over, the Forensic Scientist ends the discussion.
    if (g.stage === 'discuss') return { type: 'end-discussion' };
    if (g.stage !== 'collect') return null;
    switch (g.step?.kind) {
      case 'pick-location':
        return { type: 'pick-location', tile: 2 };
      case 'bullets': {
        const slot = g.slots.findIndex((s) => s.bullet === null);
        return slot < 0 ? null : { type: 'place-bullet', slot, item: rng.int(6) };
      }
      case 'replace':
        return { type: 'replace-tile', slot: SCENE_SLOTS[rng.int(SCENE_SLOTS.length)]! };
      default:
        return null;
    }
  };

describe('Inquest bots', () => {
  it('see only their own seat’s view', () => {
    expectTypeOf<Parameters<NonNullable<typeof inquest.bot>>>().toEqualTypeOf<
      [InquestView, BotCtx]
    >();
  });

  it('keep the Forensic Scientist with the human host', () => {
    expect(inquestBotInfo.setup!('ana')).toEqual([
      { type: 'update-settings', fsMode: 'host', fsPick: 'ana' },
    ]);
    const h = startedGame(5);
    expect(inquestBot(inquest.view(h.state, HOST), ctx(HOST))).toBeNull();
  });

  it('play every other role through whole games with no refused move, in every mode', () => {
    const modes: Partial<Settings>[] = [
      {},
      { presentations: true, finalAccusations: false },
      { presentations: true, finalAccusations: true },
      { presentations: false, finalAccusations: false },
    ];
    for (const mode of modes) {
      for (let n = 4; n <= 10; n++) {
        for (const seed of [1, 2, 3]) {
          const r = playWithBots(inquest, seats(n), {
            seed,
            maxSteps: 3000,
            humans: { ids: ['p0'], play: forensic(mode) },
          });
          const at = `${JSON.stringify(mode)} / ${n} / ${seed}`;
          expect(r.refused, at).toEqual([]);
          expect(r.over, at).toBe(true);
          const g = r.state.game!;
          // Bots only ever accuse in the final accusations, never themselves.
          for (const a of g.attempts) {
            expect(a.final, at).toBe(true);
            expect(a.target, at).not.toBe(a.by);
          }
          if (mode.finalAccusations === false) expect(g.attempts, at).toEqual([]);
        }
      }
    }
  });

  it('accuse in their final turn, and the Murderer’s side never names its own crime', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const h = startedGame(
        6,
        { murderer: 'ana', accomplice: 'ben', witness: 'cy' },
        { presentations: false, finalAccusations: true, events: false },
      );
      const crime = toFinal(h);
      expect(h.game().stage).toBe('final');
      // Not your turn: nothing.
      expect(inquestBot(inquest.view(h.state, 'ben'), ctx('ben', seed))).toBeNull();
      for (const id of ['ana', 'ben']) {
        // Give the culprit the turn, with the real pair the only one left on the Murderer's
        // cards, so a careless pick would name it.
        const g = h.game();
        const players = g.players.map((p) =>
          p.id === 'ana' ? { ...p, ruledOut: p.clue.filter((c) => c !== crime.clue) } : p,
        );
        const others = g.players.filter((p) => p.id !== id && p.id !== HOST);
        const rest = others.filter((p) => p.id !== 'ana');
        // Every other suspect's cards are ruled out too, bar one pair.
        const narrowed = players.map((p) =>
          rest.some((r) => r.id === p.id) ? { ...p, ruledOut: [...p.clue] } : p,
        );
        const state = {
          ...h.state,
          game: {
            ...g,
            players: narrowed,
            final: { ...g.final!, index: g.final!.order.indexOf(id) },
          },
        };
        const move = inquestBot(inquest.view(state, id), ctx(id, seed));
        if (id === 'ana') {
          // The Murderer can't name themself, and every other card is ruled out: no move.
          expect(move).toBeNull();
        } else {
          expect(move?.type).toBe('solve');
          expect(move).toMatchObject({ target: 'ana' });
          expect(move).not.toMatchObject({ clue: crime.clue, means: crime.means });
        }
      }
    }
  });

  it('commit a crime from the Murderer’s own cards', () => {
    const h = startedGame(5);
    const m = holder(h, 'murderer');
    const move = inquestBot(inquest.view(h.state, m.id), ctx(m.id));
    expect(move?.type).toBe('commit-crime');
    h.act(move!, m.id);
    expect(h.game().stage).toBe('collect');
  });

  it('flip a face-up Clue for Ruled Out Evidence, never the Murderer’s own crime', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = startedGame(5, { murderer: 'cy' });
      const crime = toPresentations(h);
      stackPile(h, [EVENT_TILES['ruled-out']]);
      presentAll(h);
      expect(h.game().event?.kind).toBe('ruled-out');
      for (let i = 0; i < 10 && h.game().event?.kind === 'ruled-out'; i++) {
        const ev = h.game().event as { order: string[]; index: number };
        const cur = ev.order[ev.index]!;
        const move = inquestBot(inquest.view(h.state, cur), ctx(cur, seed * 10 + i));
        expect(move?.type).toBe('rule-out');
        if (cur === crime.murderer) expect(move).not.toMatchObject({ clue: crime.clue });
        h.act(move!, cur);
      }
      expect(h.game().event).toBeNull();
    }
  });

  it('let the Witness point at a scene tile', () => {
    const h = startedGame(6, { murderer: 'cy', witness: 'ben' }, { witness: true });
    toPresentations(h);
    stackPile(h, [EVENT_TILES.testimony]);
    presentAll(h);
    expect(h.game().event?.kind).toBe('testimony');
    expect(inquestBot(inquest.view(h.state, 'ana'), ctx('ana'))).toBeNull();
    const move = inquestBot(inquest.view(h.state, 'ben'), ctx('ben'));
    expect(move?.type).toBe('testify');
    h.act(move!, 'ben');
    expect(h.game().event).toBeNull();
  });

  it('run the Reversal: the Accomplice and the Murderer tap, then the Murderer confirms', () => {
    const h = startedGame(
      7,
      { murderer: 'cy', accomplice: 'dee', witness: 'ben' },
      { witness: true, accomplice: true },
    );
    const crime = toPresentations(h);
    h.act({ type: 'solve', target: 'cy', clue: crime.clue, means: crime.means }, 'ana');
    expect(h.game().stage).toBe('reversal');
    for (const id of ['ana', 'ben'])
      expect(inquestBot(inquest.view(h.state, id), ctx(id))).toBeNull();
    for (const id of ['dee', 'cy', 'cy']) {
      const move = inquestBot(inquest.view(h.state, id), ctx(id));
      expect(move).not.toBeNull();
      if (move?.type === 'reversal-tap') expect(['cy', 'dee', HOST]).not.toContain(move.target);
      h.act(move!, id);
    }
    expect(h.state.phase).toBe('over');
  });

  it('never solve outside the final accusations, so never spend a badge early', () => {
    const h = startedGame(5);
    commit(h);
    for (const p of h.game().players) {
      const move = inquestBot(inquest.view(h.state, p.id), ctx(p.id));
      expect(move?.type ?? null).not.toBe('solve');
    }
  });
});
