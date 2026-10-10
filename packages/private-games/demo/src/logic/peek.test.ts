import { GameError, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { peek } from './index.ts';

const ctx = (by: string, isHost = by === 'h') => ({
  by,
  isHost,
  now: 0,
  rng: createRng(1),
  content: { wordLists: () => [], words: () => [] },
});

describe('peek demo game', () => {
  it('is private and flips cards once the host starts', () => {
    expect(peek.access).toBe('private');
    let s = peek.create(ctx('h'), [{ id: 'h', name: 'H' }]);
    expect(peek.reduce(s, { type: 'next' }, ctx('h'))).toBeInstanceOf(GameError);
    expect(peek.reduce(s, { type: 'start' }, ctx('x', false))).toBeInstanceOf(GameError);
    s = peek.reduce(s, { type: 'start' }, ctx('h')) as typeof s;
    s = peek.reduce(s, { type: 'next' }, ctx('x', false)) as typeof s;
    expect(peek.view(s, 'h')).toMatchObject({ phase: 'playing', card: 1, players: ['H'] });
  });
});
