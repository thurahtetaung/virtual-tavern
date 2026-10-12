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
  toPresentations,
} from '../logic/test-utils.ts';
import { resultLine, solveBlocker, statusFor, waitingOn } from './status.ts';

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
    expect(say(h, HOST)).toEqual({ text: 'Place bullet 2 of 6.', yourMove: true });
    // The line is on screen all the time, so every hidden role reads the same thing.
    for (const id of ['ana', 'ben', 'cy', 'dee']) {
      expect(say(h, id).text).toBe('Listen, study the suspects, and tap Solve when you’re sure.');
    }
    expect(waitingOn(inquest.view(h.state, 'dee'))).toEqual({ ids: [HOST] });
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
});
