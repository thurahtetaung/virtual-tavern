import { describe, expect, it } from 'vitest';
import { masqueradeOriginals } from './index.ts';
import { ORIGINALS_PACK, locationNumber, placeholderName } from './pack.ts';

describe('the originals pack', () => {
  it('holds ids only: 30 in edition 1 and 20 in edition 2', () => {
    const [e1, e2] = ORIGINALS_PACK.editions;
    expect(e1!.locations).toHaveLength(30);
    expect(e1!.locations[0]).toBe('e1-01');
    expect(e1!.locations.at(-1)).toBe('e1-30');
    expect(e2!.locations).toHaveLength(20);
    expect(e2!.locations.at(-1)).toBe('e2-20');
    for (const id of [...e1!.locations, ...e2!.locations]) expect(id).toMatch(/^e[12]-\d{2}$/);
  });

  it('numbers placeholders across both editions', () => {
    expect(locationNumber('e1-01')).toBe(1);
    expect(locationNumber('e2-01')).toBe(31);
    expect(placeholderName('e2-20')).toBe('Location 50');
    expect(placeholderName('odd')).toBe('odd');
  });

  it('is a private game that lets the host pick editions', () => {
    expect(masqueradeOriginals.access).toBe('private');
    expect(masqueradeOriginals.id).toBe('masquerade-originals');
  });
});
