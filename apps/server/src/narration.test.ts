import { describe, expect, it } from 'vitest';
import { NARRATION_REFRESH_MS, NarrationLengths } from './narration.ts';

const MANIFEST = {
  narration: { 'seer:wake': ['audio/a.ogg', 'audio/b.ogg'] },
  durations: { 'audio/a.ogg': 1000, 'audio/b.ogg': 500 },
};

describe('narration lengths from the manifest', () => {
  it('answers null until the manifest is read, then from memory, and reads it again later', async () => {
    let now = 0;
    const reads: string[] = [];
    const store = {
      json: (key: string) => {
        reads.push(key);
        return Promise.resolve(MANIFEST);
      },
    };
    const lengths = new NarrationLengths(store, () => now);
    expect(lengths.get('nightfall')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(lengths.get('nightfall')).toEqual({ 'seer:wake': 1500 });
    expect(reads).toEqual(['nightfall/manifest.json']);
    now = NARRATION_REFRESH_MS;
    expect(lengths.get('nightfall')).toEqual({ 'seer:wake': 1500 });
    expect(reads).toHaveLength(2);
  });

  it('stays null for a game with no manifest or no durations, and survives a failed read', async () => {
    const errors: string[] = [];
    const lengths = new NarrationLengths(
      {
        json: (key) =>
          key.startsWith('broken') ? Promise.reject(new Error('down')) : Promise.resolve(null),
      },
      Date.now,
      (_err, id) => errors.push(id),
    );
    await lengths.load('broken');
    await lengths.load('other');
    expect(lengths.get('broken')).toBeNull();
    expect(lengths.get('other')).toBeNull();
    expect(errors).toEqual(['broken']);
  });
});
