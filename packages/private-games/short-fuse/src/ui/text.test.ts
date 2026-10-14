import { describe, expect, it } from 'vitest';
import { ids, rigged } from '../logic/test-utils.ts';
import type { LogEntry } from '../logic/types.ts';
import { contentFor } from './assets.ts';
import { logLine, statusFor } from './text.ts';

const c = contentFor(null);
const [A, B, C] = ids(3) as [string, string, string];

/** The line each viewer reads for one log entry: the actor, the target and a third player. */
function lines(entry: Omit<LogEntry, 'id' | 'at' | 'turn'>) {
  const h = rigged([['cat1'], ['cat2'], ['cat3']]);
  const e: LogEntry = { id: 1, at: 0, turn: 1, ...entry };
  return Object.fromEntries([A, B, C].map((v) => [v, logLine(h.view(v), c, e)]));
}

describe('log lines address the viewer', () => {
  it('a waiting Twin Bomb sits in front of you, or them', () => {
    const h = rigged([['twin'], [], []], ['cat1', 'cat2'], { settings: { x3: true } });
    h.act({ type: 'play', cards: [h.card(A, 'twin')] }, A);
    const e = h.game().log.at(-1)!;
    expect(e.kind).toBe('twin-wait');
    expect(logLine(h.view(A), c, e)).toBe(
      'You played a Twin Bomb: nobody has the other yet. It waits in front of you.',
    );
    expect(logLine(h.view(B), c, e)).toBe(
      'HOST played a Twin Bomb: nobody has the other yet. It waits in front of them.',
    );
  });

  it('a steal from a Vault Stash names your Stash', () => {
    expect(lines({ kind: 'steal', by: A, target: B, n: 1, from: 'stash' })).toEqual({
      [A]: 'You stole a card from ANA’s Vault Stash.',
      [B]: 'HOST stole a card from your Vault Stash.',
      [C]: 'HOST stole a card from ANA’s Vault Stash.',
    });
  });

  it('a Stash that gives is yours', () => {
    expect(lines({ kind: 'favor', by: A, target: B, n: 1, from: 'stash' })).toEqual({
      [A]: 'Your Vault Stash gave ANA a card.',
      [B]: 'HOST’s Vault Stash gave you a card.',
      [C]: 'HOST’s Vault Stash gave ANA a card.',
    });
  });

  it('three of a kind starts with a capital, whoever was asked', () => {
    expect(lines({ kind: 'ask', by: A, target: B, named: 'attack', hit: true })).toEqual({
      [A]: 'ANA handed over Attack.',
      [B]: 'You handed over Attack.',
      [C]: 'ANA handed over Attack.',
    });
    expect(lines({ kind: 'ask', by: A, target: B, named: 'attack', hit: false })[B]).toBe(
      'You had no Attack.',
    );
  });

  it('an empty pile agrees with you', () => {
    expect(lines({ kind: 'empty', by: A })).toEqual({
      [A]: 'The pile is empty: you draw nothing.',
      [B]: 'The pile is empty: HOST draws nothing.',
      [C]: 'The pile is empty: HOST draws nothing.',
    });
  });

  it('a Mine! taking your draw, and a Mark in your hand', () => {
    expect(lines({ kind: 'mine-took', by: A, target: B, cards: ['cat1'] })).toEqual({
      [A]: 'You took ANA’s draw: a Cat A!',
      [B]: 'HOST took your draw: a Cat A!',
      [C]: 'HOST took ANA’s draw: a Cat A!',
    });
    expect(lines({ kind: 'mark', by: A, target: B, cards: ['cat1'] })[B]).toBe(
      'HOST marked Cat A in your hand.',
    );
  });

  it('cancelled and resolved plays are yours or theirs', () => {
    expect(lines({ kind: 'cancelled', by: A })[A]).toBe('Your play was cancelled.');
    expect(lines({ kind: 'cancelled', by: A })[B]).toBe('HOST’s play was cancelled.');
  });

  it('targeted plays name you as you', () => {
    expect(lines({ kind: 'mine', by: A, target: B })).toEqual({
      [A]: 'You put a Mine! in front of ANA.',
      [B]: 'HOST put a Mine! in front of you.',
      [C]: 'HOST put a Mine! in front of ANA.',
    });
    expect(lines({ kind: 'bark', by: A, target: B, cards: ['twin'] })[B]).toBe(
      'HOST played a Twin Bomb: you had the other one!',
    );
    expect(lines({ kind: 'attacked', by: A, target: B, n: 2 })[B]).toBe('You must take 2 turns.');
  });
});

describe('timeouts and Act for name cards from the manifest', () => {
  const named = contentFor({
    names: { cards: { defuse: 'Off Switch', bomb: 'Boomer' } },
  });
  const h = rigged([['cat1'], ['cat2'], ['cat3']]);
  const line = (e: Omit<LogEntry, 'id' | 'at' | 'turn'>, v = B) =>
    logLine(h.view(v), named, { id: 1, at: 0, turn: 1, ...e });

  it('fills the card tokens in what the table did', () => {
    expect(line({ kind: 'timeout', by: A, did: 'played {c:defuse}' })).toBe(
      '⏱ Time ran out: HOST played Off Switch',
    );
    expect(line({ kind: 'act-for', by: A, target: B, did: 'hid {c:bomb} at random' })).toBe(
      'HOST (host) acted for you: hid Boomer at random.',
    );
  });

  it('shows older plain texts as they are', () => {
    expect(line({ kind: 'timeout', by: A, did: 'used a Defuse' })).toBe(
      '⏱ Time ran out: HOST used a Defuse',
    );
  });
});

describe('status lines address the viewer', () => {
  it('whose turn it is', () => {
    const h = rigged([['cat1'], ['cat2'], ['cat3']]);
    expect(statusFor(h.view(B), c).text).toBe('HOST’s turn.');
    expect(statusFor(h.view(A), c).yourMove).toBe(true);
  });
});
