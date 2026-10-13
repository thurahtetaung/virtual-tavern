import { describe, expect, it } from 'vitest';
import { EVENT_TILES } from '../logic/content.ts';
import { inquest } from '../logic/game.ts';
import {
  HOST,
  commit,
  harness,
  presentAll,
  stackPile,
  startedGame,
  toDiscussion,
  toFinal,
  toPresentations,
} from '../logic/test-utils.ts';
import { endDiscussionLabel, resultLine, solveBlocker, statusFor, waitingOn } from './status.ts';

const six = () => startedGame(6, { murderer: 'ana', accomplice: 'ben', witness: 'cy' });
const say = (h: ReturnType<typeof six>, id: string, secs: number | null = null) =>
  statusFor(inquest.view(h.state, id), id === HOST, undefined, secs);

describe('statusFor', () => {
  it('lobby: what is missing, then Start for the host', () => {
    const h = harness(3);
    expect(statusFor(inquest.view(h.state, 'ana'), false).text).toMatch(/4 players are needed/);
    const full = harness(4);
    expect(statusFor(inquest.view(full.state, HOST), true)).toEqual({
      text: 'Everyone is in. Press Start when you’re ready!',
      yourMove: true,
    });
  });

  it('night: only the Murderer has a move, and nobody else learns who it is', () => {
    const h = six();
    expect(say(h, 'ana')).toEqual({
      text: 'Murderer: pick 1 Clue + 1 Means from your own cards.',
      yourMove: true,
    });
    for (const id of ['ben', 'cy', 'dee', HOST]) {
      const s = say(h, id);
      expect(s.yourMove).toBe(false);
      expect(s.text).toMatch(/Night falls/);
      if (id === 'dee') expect(s.text).not.toMatch(/Ana/);
    }
    expect(waitingOn(inquest.view(h.state, 'dee'))).toEqual({ ids: [], label: 'the Murderer' });
  });

  it('collection: bullet counts for the FS, a role brief for everyone else', () => {
    const h = six();
    commit(h);
    expect(say(h, HOST).text).toBe('Pick the Location tile for this crime.');
    h.act({ type: 'pick-location', tile: 2 }, HOST);
    h.act({ type: 'place-bullet', slot: 0, item: 0 }, HOST);
    expect(say(h, HOST)).toEqual({
      text: 'Place the next bullet (2 of 6) when you’re ready. Take your time; let the table talk.',
      yourMove: true,
    });
    // The line is on screen all the time, so every hidden role reads the same thing.
    expect(waitingOn(inquest.view(h.state, 'dee'))).toEqual({ ids: [HOST] });
    // The Forensic Scientist is public, so it names them.
    const fsName = inquest.view(h.state, 'dee').game!.players.find((p) => p.isFs)!.name;
    for (const id of ['ana', 'ben', 'cy', 'dee']) {
      expect(say(h, id).text).toBe(
        `Talk it over as the bullets land: the order can be a clue. Forensic Scientist ${fsName} is placing bullet 2 of 6.`,
      );
    }
    // Watchers have a "you're watching" banner already, so their line skips that lead.
    expect(statusFor(inquest.view(h.state, null), false).text).toBe(
      `Talk it over as the bullets land: the order can be a clue. Forensic Scientist ${fsName} is placing bullet 2 of 6.`,
    );
    // After the last bullet: the discussion, with a nudge for the Forensic Scientist at 0.
    for (let slot = 1; slot < 6; slot++) h.act({ type: 'place-bullet', slot, item: 0 }, HOST);
    expect(say(h, HOST, 30)).toEqual({
      text: 'The table is discussing the evidence. Tap Start presentations when they’re ready.',
      yourMove: true,
    });
    expect(say(h, HOST, 0)).toEqual({
      text: 'Time’s up: tap Start presentations.',
      yourMove: true,
    });
    expect(say(h, 'dee', 0)).toEqual({
      text: `Discuss the evidence: this round’s new bullets are highlighted. Forensic Scientist ${fsName} starts the presentations.`,
      yourMove: false,
    });
    expect(waitingOn(inquest.view(h.state, 'dee'))).toBeNull();
  });

  it('presentations: your turn with the clock, else who is up next', () => {
    const h = six();
    toPresentations(h);
    expect(say(h, 'ana', 24)).toEqual({ text: 'Your turn to present (0:24).', yourMove: true });
    expect(say(h, 'dee').text).toMatch(/^Ana is presenting\. Up next: Ben\./);
  });

  it('events: the flipper is named; the Witness is not', () => {
    const h = six();
    toPresentations(h);
    stackPile(h, [EVENT_TILES.testimony]);
    presentAll(h);
    expect(say(h, 'cy')).toEqual({
      text: 'Secret: pick a scene tile to have replaced.',
      yourMove: true,
    });
    expect(say(h, 'dee').text).not.toMatch(/Cy/);
    expect(waitingOn(inquest.view(h.state, 'dee'))).toEqual({ ids: [], label: 'the Witness' });
  });

  it('solve is blocked before the first bullet and after the badge is spent', () => {
    const h = six();
    commit(h);
    expect(solveBlocker(inquest.view(h.state, 'dee'))).toMatch(/first bullet/);
    expect(solveBlocker(inquest.view(h.state, HOST))).toMatch(/Only players/);
  });

  it('the result line', () => {
    const h = six();
    const crime = toPresentations(h);
    h.act({ type: 'solve', target: 'ana', clue: crime.clue, means: crime.means }, 'dee');
    expect(say(h, 'ana').yourMove).toBe(true);
    expect(say(h, 'eve').text).toMatch(/one last chance/);
    h.act({ type: 'reversal-tap', target: 'cy' }, 'ana');
    h.act({ type: 'reversal-confirm' }, 'ana');
    expect(resultLine(inquest.view(h.state, 'eve'))).toBe(
      'Dee solved it, but the culprits found the Witness (Cy): the Murderer’s side wins.',
    );
  });

  it('presentations off: the discussion’s button names what comes next', () => {
    const opts = { presentations: false, finalAccusations: true, events: false } as const;
    const h = startedGame(4, {}, opts);
    toDiscussion(h);
    expect(endDiscussionLabel(inquest.view(h.state, HOST))).toBe('Next round');
    expect(say(h, HOST, 30).text).toBe(
      'The table is discussing the evidence. Tap Next round when they’re ready.',
    );
    expect(say(h, 'ben').text).toMatch(/starts the next round\.$/);
    const f = startedGame(4, {}, opts);
    toFinal(f);
    f.state = { ...f.state, game: { ...f.game(), stage: 'discuss', final: null } };
    expect(endDiscussionLabel(inquest.view(f.state, HOST))).toBe('Start final accusations');
    const off = startedGame(4, {}, { ...opts, finalAccusations: false });
    toDiscussion(off);
    off.state = { ...off.state, game: { ...off.game(), round: 3 } };
    expect(endDiscussionLabel(inquest.view(off.state, HOST))).toBe('Close the case');
  });

  it('final accusations: whose turn it is, for everyone; others wait to solve', () => {
    const h = startedGame(
      6,
      { murderer: 'ana', accomplice: 'ben', witness: 'cy' },
      { presentations: false, finalAccusations: true, events: false },
    );
    toFinal(h);
    expect(say(h, 'ana', 25)).toEqual({
      text: 'Final accusations: your turn (0:25). Tap Accuse and name another player’s Clue + Means.',
      yourMove: true,
    });
    for (const id of ['ben', 'dee', HOST])
      expect(say(h, id).text).toBe(
        `Final accusations: Ana is accusing… Up next: ${id === 'ben' ? 'you' : 'Ben'}.`,
      );
    expect(waitingOn(inquest.view(h.state, 'dee'))).toEqual({ ids: ['ana'] });
    expect(solveBlocker(inquest.view(h.state, 'ana'))).toBeNull();
    expect(solveBlocker(inquest.view(h.state, 'dee'))).toBe('Wait for your turn: Ana is accusing.');
    // Everyone misses: the Murderer's side wins.
    for (let i = 0; i < 5 && h.state.phase === 'playing'; i++) {
      const f = h.game().final!;
      const by = f.order[f.index]!;
      const t = h.game().players.find((p) => p.id !== by && p.id !== HOST && p.id !== 'ana')!;
      h.act({ type: 'solve', target: t.id, clue: t.clue[1]!, means: t.means[1]! }, by);
    }
    expect(resultLine(inquest.view(h.state, 'dee'))).toBe(
      'Every final accusation missed: the Murderer’s side wins.',
    );
  });
});
