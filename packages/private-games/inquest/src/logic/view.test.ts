import { describe, expect, it } from 'vitest';
import { EVENT_TILES } from './content.ts';
import { inquest } from './game.ts';
import {
  HOST,
  type Harness,
  presentAll,
  stackPile,
  startedGame,
  toPresentations,
} from './test-utils.ts';
import type { RoleId } from './types.ts';

// Six at the table: host is the Forensic Scientist, ana the Murderer, ben the Accomplice, cy the
// Witness, dee and eve Investigators; plus a spectator with no seat.
const ROLES: Record<string, RoleId> = {
  host: 'forensic',
  ana: 'murderer',
  ben: 'accomplice',
  cy: 'witness',
  dee: 'investigator',
  eve: 'investigator',
};
const VIEWERS = [...Object.keys(ROLES), null];
const KNOWS = new Set(['host', 'ana', 'ben']);

const six = () => startedGame(6, { murderer: 'ana', accomplice: 'ben', witness: 'cy' });

/** Everything every viewer may (and may not) see, checked on the raw JSON they would receive. */
function checkViews(h: Harness, label: string) {
  const g = h.game();
  const over = h.state.phase === 'over';
  for (const viewer of VIEWERS) {
    const v = inquest.view(h.state, viewer);
    const json = JSON.stringify(v);
    const at = `${label} / ${viewer ?? 'spectator'}`;
    // The draw pile's order never leaves the server.
    expect(json, at).not.toContain('"pile"');
    expect(json, at).not.toContain('"seed"');
    // Roles: your own, or everyone's at the end.
    for (const [id, role] of Object.entries(ROLES)) {
      const p = v.game!.players.find((x) => x.id === id)!;
      expect(p.role, `${at}: ${id}'s role`).toBe(over || id === viewer ? role : null);
    }
    if (!over) {
      expect(v.game!.roles, at).toBeNull();
      for (const role of ['murderer', 'accomplice', 'witness'] as const) {
        if (ROLES[viewer ?? ''] !== role) expect(json, at).not.toContain(`:"${role}"`);
      }
    }
    // The crime: Murderer, Accomplice and Forensic Scientist only (everyone at the end).
    const shouldKnow = over || (viewer !== null && KNOWS.has(viewer));
    if (g.solution && shouldKnow)
      expect(v.game!.solution, at).toEqual({ murderer: 'ana', ...g.solution });
    else {
      expect(v.game!.solution, at).toBeNull();
      expect(json, at).not.toContain('"solution":{');
    }
    // The Witness sees the culprits as an unordered pair; nobody else gets a pair.
    if (viewer === 'cy') expect(v.game!.witnessPair, at).toEqual(['ana', 'ben']);
    else expect(v.game!.witnessPair, at).toBeNull();
    // The culprits know each other.
    expect(v.game!.partner, at).toBe(viewer === 'ana' ? 'ben' : viewer === 'ben' ? 'ana' : null);
    // Reversal taps: only the culprits (and everyone at the end).
    if (g.reversal && !over && !(viewer === 'ana' || viewer === 'ben')) {
      expect(v.game!.reversal, at).toEqual({
        deadline: g.reversal.deadline,
        murdererTap: null,
        accompliceTap: null,
      });
    }
    // The Forensic Scientist's private choices.
    if (viewer !== HOST) {
      const ev = v.game!.event;
      if (ev?.kind === 'useful-clue') expect(ev.options, at).toBeNull();
      if (ev?.kind === 'countdown') expect(ev.drawn, at).toBeNull();
      if (v.game!.step?.kind === 'replace') expect(v.game!.step.drawn, at).toBeNull();
    }
  }
}

describe('view() redaction, every viewer at every phase', () => {
  it('night, collection, presentations, an event, the Reversal and the end', () => {
    const h = six();
    checkViews(h, 'night');
    const crime = toPresentations(h);
    checkViews(h, 'present round 1');
    stackPile(h, [EVENT_TILES['useful-clue']]);
    presentAll(h);
    checkViews(h, 'useful clue');
    const ev = h.game().event!;
    h.act(
      { type: 'useful-pick', tile: ev.kind === 'useful-clue' ? ev.options[0]! : 0, slot: 2 },
      HOST,
    );
    checkViews(h, 'bullet after event');
    h.act({ type: 'place-bullet', slot: 2, item: 1 }, HOST);
    checkViews(h, 'replace');
    expect(inquest.view(h.state, HOST).game!.step).toMatchObject({ kind: 'replace' });
    expect((inquest.view(h.state, HOST).game!.step as { drawn: number }).drawn).toBeGreaterThan(0);
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'dee');
    checkViews(h, 'reversal');
    h.act({ type: 'reversal-tap', target: 'eve' }, 'ben');
    expect(inquest.view(h.state, 'ana').game!.reversal!.accompliceTap).toBe('eve');
    checkViews(h, 'reversal with a tap');
    h.act({ type: 'reversal-tap', target: 'dee' }, 'ana');
    h.act({ type: 'reversal-confirm' }, 'ana');
    checkViews(h, 'over');
    expect(inquest.view(h.state, 'dee').game!.reversal!.murdererTap).toBe('dee');
  });

  it('countdown and testimony steps', () => {
    const h = six();
    toPresentations(h);
    stackPile(h, [EVENT_TILES.countdown]);
    presentAll(h);
    checkViews(h, 'countdown');
    const t = six();
    toPresentations(t);
    stackPile(t, [EVENT_TILES.testimony]);
    presentAll(t);
    checkViews(t, 'testimony');
    // Who is testifying is never named.
    expect(JSON.stringify(inquest.view(t.state, 'dee').game!.event)).not.toContain('cy');
  });

  it('after a handover the old Forensic Scientist still knows, and so does the new one', () => {
    const h = six();
    toPresentations(h);
    h.act({ type: 'hand-over' }, HOST);
    const fs = h.game().fs;
    expect(inquest.view(h.state, HOST).game!.solution).not.toBeNull();
    expect(inquest.view(h.state, fs).game!.solution).not.toBeNull();
    for (const other of ['cy', 'dee', 'eve'].filter((id) => id !== fs))
      expect(inquest.view(h.state, other).game!.solution).toBeNull();
  });
});
