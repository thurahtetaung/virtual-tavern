import { describe, expect, it } from 'vitest';
import { nameTaken, uniqueName } from './names.ts';

describe('room names', () => {
  it('keeps a free name as it is', () => {
    expect(uniqueName('Ana', ['Ben'])).toBe('Ana');
  });

  it('numbers a clashing name, ignoring case and spacing', () => {
    expect(uniqueName('ana', ['Ana'])).toBe('ana 2');
    expect(uniqueName('Ana', ['Ana', 'ana 2', 'Ben'])).toBe('Ana 3');
    expect(nameTaken('Mary  Jo', ['mary jo'])).toBe(true);
  });

  it('stays within the name length limit', () => {
    const long = 'Bartholomew Fitzwilliams';
    expect(long).toHaveLength(24);
    const next = uniqueName(long, [long]);
    expect(next).toBe('Bartholomew Fitzwillia 2');
    expect(next.length).toBeLessThanOrEqual(24);
  });
});
