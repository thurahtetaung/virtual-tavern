import { describe, expect, it } from 'vitest';
import { narrationLengths } from './narration.ts';

describe('narration lengths', () => {
  it('adds up each line’s clips from the manifest’s durations', () => {
    expect(
      narrationLengths({
        narration: { 'a:wake': ['audio/a1.ogg', 'audio/a2.ogg'], 'a:close': ['audio/x.ogg'] },
        durations: { 'audio/a1.ogg': 1200.4, 'audio/a2.ogg': 800 },
      }),
    ).toEqual({ 'a:wake': 2000, 'a:close': 0 });
  });

  it('is null without narration or durations', () => {
    expect(narrationLengths(null)).toBeNull();
    expect(narrationLengths({ narration: { a: ['x.ogg'] } })).toBeNull();
    expect(narrationLengths({ durations: { 'x.ogg': 1 } })).toBeNull();
  });
});
