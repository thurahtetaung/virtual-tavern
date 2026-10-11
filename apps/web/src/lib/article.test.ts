import { describe, expect, it } from 'vitest';
import { article } from './article.ts';

describe('article', () => {
  it('goes by sound, not the first letter', () => {
    expect(article('Enigma')).toBe('an');
    expect(article('Echo')).toBe('an');
    expect(article('Hoodwink')).toBe('a');
    expect(article('One Night')).toBe('a');
    expect(article('Unicorn Hunt')).toBe('a');
    expect(article('Hour Glass')).toBe('an');
    expect(article('Codenames')).toBe('a');
  });
});
