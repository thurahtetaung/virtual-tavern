import { describe, expect, it } from 'vitest';
import { ids, rigged } from '../logic/test-utils.ts';
import type { LogEntry } from '../logic/types.ts';
import { contentFor } from './assets.ts';
import { logLine, playNow, statusFor } from './text.ts';

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

describe('the fourth expansion’s lines address the viewer', () => {
  const X4 = { settings: { x4: true } };

  it('a ghost who feeds themself, and a feeding someone else watches', () => {
    expect(lines({ kind: 'fed', by: A, target: A, n: 2 })).toEqual({
      [A]: '👻 You fed yourself 2 cards.',
      [B]: '👻 HOST fed themself 2 cards.',
      [C]: '👻 HOST fed themself 2 cards.',
    });
    expect(lines({ kind: 'fed', by: A, target: B, n: 1 })).toEqual({
      [A]: '👻 You fed ANA 1 card.',
      [B]: '👻 HOST fed you 1 card.',
      [C]: '👻 HOST fed ANA 1 card.',
    });
    expect(lines({ kind: 'play', by: A, target: A, cards: ['feed'], play: 'card' })[A]).toBe(
      'You played Feed the Ghosts NOW on yourself.',
    );
  });

  it('a Second Life brings you, or them, back', () => {
    expect(lines({ kind: 'revive', by: A, target: B })).toEqual({
      [A]: '🧟 You brought ANA back to life!',
      [B]: '🧟 HOST brought you back to life!',
      [C]: '🧟 HOST brought ANA back to life!',
    });
    expect(lines({ kind: 'play', by: A, target: B, cards: ['revive'], play: 'card' })).toEqual({
      [A]: 'You used Second Life on ANA.',
      [B]: 'HOST used Second Life on you.',
      [C]: 'HOST used Second Life on ANA.',
    });
  });

  it('becoming a ghost, Foresight, Look Twice and a Copy', () => {
    expect(lines({ kind: 'explode', by: A, cards: ['bomb'], ghost: true })).toEqual({
      [A]: '👻 You exploded and are a ghost now.',
      [B]: '👻 HOST exploded and is a ghost now.',
      [C]: '👻 HOST exploded and is a ghost now.',
    });
    expect(lines({ kind: 'seer', by: B })[B]).toBe(
      '🔮 You played Foresight NOW: you’ll watch the hiding.',
    );
    expect(lines({ kind: 'seer', by: B })[A]).toBe(
      '🔮 ANA played Foresight NOW: they’ll watch the hiding.',
    );
    expect(lines({ kind: 'dig', by: A })[A]).toBe('You looked at the top card (Look Twice).');
    expect(
      lines({ kind: 'play', by: A, target: B, cards: ['copy'], as: 'favor', play: 'card' }),
    ).toEqual({
      [A]: 'You played Copy as Favor on ANA.',
      [B]: 'HOST played Copy as Favor on you.',
      [C]: 'HOST played Copy as Favor on ANA.',
    });
  });

  it('the ghost’s status line, and the Second Life countdown for each viewer', () => {
    const h = rigged([['skip', 'revive'], ['seer'], ['nope']], ['bomb', 'cat1', 'bomb'], X4);
    h.play(A, ['skip']);
    h.act({ type: 'draw' }, B);
    expect(statusFor(h.view(B), c).text).toBe('👻 You exploded: you’re a ghost now.');
    expect(statusFor(h.view(C), c).text).toBe('👻 ANA exploded and is a ghost now.');
    h.fire();
    expect(statusFor(h.view(B), c).text).toMatch(/^👻 You’re a ghost: .* BEN’s turn\.$/);
    h.act({ type: 'draw' }, C);
    h.act({ type: 'draw' }, A);
    h.act({ type: 'revive', ghost: B }, A);
    expect(statusFor(h.view(A), c).text).toBe(
      'You use Second Life and bring ANA back: no Nope can stop it. The hiding starts after the countdown…',
    );
    expect(statusFor(h.view(B), c).text).toBe(
      'HOST uses Second Life and brings you back. Play Foresight NOW to watch where the bombs go?',
    );
  });
});

describe('the off-turn play button', () => {
  it('says "now" once, even when the card name ends in NOW', () => {
    expect(playNow('Alter the Future (3x) NOW')).toBe('Play Alter the Future (3x) NOW');
    expect(playNow('Feed the Dead NOW')).toBe('Play Feed the Dead NOW');
    expect(playNow('Shuffle Now')).toBe('Play Shuffle Now');
    expect(playNow(c.name('alter3now'))).not.toMatch(/now now/i);
    expect(playNow('Shuffle')).toBe('Play Shuffle now');
    expect(playNow('Snowball')).toBe('Play Snowball now');
  });
});
