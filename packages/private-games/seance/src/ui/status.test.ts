import { describe, expect, it } from 'vitest';
import { seance } from '../logic/game.ts';
import {
  HOST,
  colorOf,
  guessAll,
  harness,
  readyAll,
  readyOnly,
  sendAll,
  startedGame,
  toFinal,
} from '../logic/test-utils.ts';
import { resultLine, statusFor, stepOf } from './status.ts';

const people = (ids: string[]) => ({
  hostId: HOST,
  players: ids.map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), connected: true })),
});

describe('status line', () => {
  it('guides the lobby', () => {
    const h = harness(2);
    expect(statusFor(seance.view(h.state, HOST), true).text).toMatch(/3 players are needed/);
    const ok = harness(4);
    expect(statusFor(seance.view(ok.state, HOST), true)).toEqual({
      text: 'Everyone is in. Press Start when you’re ready!',
      yourMove: true,
    });
    expect(statusFor(seance.view(ok.state, 'ana'), false, people(['host', 'ana'])).text).toBe(
      'All set. Waiting for Host (host) to start…',
    );
  });

  it('tells the ghost who still needs a vision, and the psychics what to do', () => {
    const h = startedGame(4);
    const ids = ['host', 'ana', 'ben', 'cy'];
    const ghost = statusFor(seance.view(h.state, HOST), true, people(ids));
    expect(ghost.yourMove).toBe(true);
    expect(ghost.text).toContain('send a vision to each psychic (3 waiting)');
    expect(statusFor(seance.view(h.state, 'ana'), false, people(ids))).toEqual({
      text: 'Hour I: waiting for your vision from the ghost…',
      yourMove: false,
    });
    h.act({ type: 'send', to: colorOf(h, 'ana'), cards: [h.game().hand[0]!] }, HOST);
    expect(statusFor(seance.view(h.state, 'ana'), false)).toEqual({
      text: 'Your vision is here: which suspect does it point to?',
      yourMove: true,
    });
    sendAll(h);
    expect(statusFor(seance.view(h.state, HOST), true).text).toMatch(/every vision is out/);
    guessAll(h);
    expect(statusFor(seance.view(h.state, 'ana'), false).text).toBe(
      'Discussion time: talk the visions over out loud, then tap Ready.',
    );
    h.act({ type: 'ready', on: true }, 'ana');
    expect(statusFor(seance.view(h.state, 'ana'), false, people(ids)).text).toBe(
      'You’re ready. Waiting for: Ben and Cy.',
    );
    readyOnly(h);
    expect(statusFor(seance.view(h.state, 'ana'), false).text).toMatch(
      /^Everyone’s ready: waiting for the ghost to reveal\./,
    );
    expect(statusFor(seance.view(h.state, HOST), true)).toEqual({
      text: 'Hour I: everyone is Ready. Reveal the verdicts when you are.',
      yourMove: true,
    });
    h.act({ type: 'reveal' }, HOST);
    expect(statusFor(seance.view(h.state, 'ana'), false).text).toBe('Right! Next, your place.');
  });

  it('names each step, discussion included', () => {
    const h = startedGame(4);
    expect(stepOf(seance.view(h.state, 'ana').game!).id).toBe('visions');
    sendAll(h);
    expect(stepOf(seance.view(h.state, 'ana').game!)).toMatchObject({ title: 'Discussion' });
    guessAll(h);
    readyAll(h);
    expect(stepOf(seance.view(h.state, 'ana').game!).id).toBe('verdicts');
    h.act({ type: 'continue' }, HOST);
    toFinal(h);
    expect(stepOf(seance.view(h.state, 'ana').game!).id).toBe('lineup');
    h.act({ type: 'shared', group: 0, cards: h.game().hand.slice(0, 3) }, HOST);
    expect(stepOf(seance.view(h.state, 'ana').game!).title).toBe('Silent vote');
  });

  it('stages the vote and says how it ended', () => {
    const h = startedGame(4);
    toFinal(h);
    expect(statusFor(seance.view(h.state, HOST), true).yourMove).toBe(true);
    expect(statusFor(seance.view(h.state, 'ana'), false).text).toMatch(/The ghost is choosing/);
    h.act({ type: 'shared', group: 0, cards: h.game().hand.slice(0, 3) }, HOST);
    expect(statusFor(seance.view(h.state, 'ana'), false)).toMatchObject({ yourMove: true });
    h.act({ type: 'vote', group: 0 }, 'ana');
    expect(statusFor(seance.view(h.state, 'ana'), false).text).toMatch(/Your vote is in/);
    h.act({ type: 'vote', group: 0 }, 'ben');
    h.act({ type: 'vote', group: 0 }, 'cy');
    expect(resultLine(seance.view(h.state, 'ana').game!)).toMatch(/Everyone wins!/);
  });

  it('says when the ghost’s seat is empty', () => {
    const h = startedGame(4);
    h.state = seance.playerLeft(h.state, HOST, h.now);
    expect(statusFor(seance.view(h.state, 'ana'), false).text).toMatch(/ghost’s seat is empty/);
  });
});
