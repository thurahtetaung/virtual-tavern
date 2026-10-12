import { afterEach, describe, expect, it } from 'vitest';
import { setStorageSeat, storageKey } from './storage.ts';

describe('storageKey', () => {
  afterEach(() => setStorageSeat(null));

  it('leaves keys alone outside a playtest', () => {
    expect(storageKey('vt.round-table.tips')).toBe('vt.round-table.tips');
  });

  it('keeps each playtest seat apart', () => {
    setStorageSeat('seatA');
    const a = storageKey('vt.round-table.tips');
    setStorageSeat('seatB');
    const b = storageKey('vt.round-table.tips');
    expect(a).toBe('vt.round-table.tips:seatA');
    expect(b).not.toBe(a);
    setStorageSeat(null);
    expect(storageKey('vt.round-table.tips')).toBe('vt.round-table.tips');
  });
});
