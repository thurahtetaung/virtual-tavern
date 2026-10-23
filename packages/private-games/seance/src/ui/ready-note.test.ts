import { describe, expect, it } from 'vitest';
import { seance } from '../logic/game.ts';
import { colorOf, sendAll, startedGame } from '../logic/test-utils.ts';
import { PILLARS } from '../logic/cards.ts';
import { READY_NOTE, type ReadyNote, nextReadyNote, readyDrop, readySnap } from './ready-note.ts';

/** A started game with Ana's vision in, Ana guessing and Ready. */
function readyAna() {
  const h = startedGame(4);
  sendAll(h);
  const pillar = PILLARS[h.psychic('ana').step]!;
  const [a, b] = h.game().table[pillar];
  h.act({ type: 'intuition', card: a! }, 'ana');
  h.act({ type: 'ready', on: true }, 'ana');
  const snap = () => readySnap(seance.view(h.state, 'ana'));
  return { h, a: a!, b: b!, snap };
}

describe('the Ready note', () => {
  it('explains a Ready lost to a changed guess, only to that player', () => {
    const { h, b, snap } = readyAna();
    const before = snap();
    const benBefore = readySnap(seance.view(h.state, 'ben'));
    h.act({ type: 'intuition', card: b }, 'ana');
    expect(readyDrop(before, snap())).toBe('guess');
    expect(readyDrop(benBefore, readySnap(seance.view(h.state, 'ben')))).toBeNull();
    expect(READY_NOTE.guess).toBe('You changed your guess: tap Ready again when you’re set.');
  });

  it('explains a Ready lost to a token placed, moved or taken back', () => {
    const { h, snap } = readyAna();
    const ben = colorOf(h, 'ben');
    h.act({ type: 'intuition', card: h.game().table[PILLARS[h.psychic('ben').step]!][0]! }, 'ben');
    h.act({ type: 'ready', on: true }, 'ana');
    let before = snap();
    h.act({ type: 'mark', target: ben, kind: 'yes' }, 'ana');
    expect(readyDrop(before, snap())).toBe('token');
    h.act({ type: 'ready', on: true }, 'ana');
    before = snap();
    h.act({ type: 'mark', target: ben, kind: null }, 'ana');
    expect(readyDrop(before, snap())).toBe('token');
    expect(READY_NOTE.token).toBe('You moved a token: tap Ready again when you’re set.');
  });

  it('says nothing when the player takes Ready back themself', () => {
    const { h, snap } = readyAna();
    const before = snap();
    h.act({ type: 'ready', on: false }, 'ana');
    expect(readyDrop(before, snap())).toBeNull();
  });

  it('goes once they tap Ready again, or the hour ends', () => {
    const { h, b, snap } = readyAna();
    const before = snap();
    h.act({ type: 'intuition', card: b }, 'ana');
    const note = nextReadyNote(null, before, snap());
    expect(note?.reason).toBe('guess');
    // Another change keeps it; Ready clears it.
    expect(nextReadyNote(note, snap(), { ...snap()!, marks: 'x' })).toEqual(note);
    h.act({ type: 'ready', on: true }, 'ana');
    expect(nextReadyNote(note, null, snap())).toBeNull();
    // A new hour (or the verdicts) drops it too.
    const stale: ReadyNote = { reason: 'guess', key: 'old' };
    expect(nextReadyNote(stale, null, { ...snap()!, ready: false })).toBeNull();
    expect(nextReadyNote(note, snap(), null)).toBeNull();
  });
});
