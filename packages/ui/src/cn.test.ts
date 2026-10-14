import { describe, expect, it } from 'vitest';
import { cn } from './cn.ts';

describe('cn', () => {
  it('drops falsy parts', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('lets a later class override a conflicting default', () => {
    expect(cn('h-9 px-3', 'h-11')).toBe('px-3 h-11');
    expect(cn('bg-card ring-1 ring-line', 'bg-panel')).toBe('ring-1 ring-line bg-panel');
    expect(cn('text-ink-muted', 'text-danger-ink')).toBe('text-danger-ink');
  });

  it('keeps classes from different groups, including the semantic tokens', () => {
    expect(cn('text-sm text-ink-muted')).toBe('text-sm text-ink-muted');
    expect(cn('ring-2 ring-accent-line')).toBe('ring-2 ring-accent-line');
    expect(cn('bg-white dark:bg-stone-900', 'bg-panel')).toBe('dark:bg-stone-900 bg-panel');
  });
});
