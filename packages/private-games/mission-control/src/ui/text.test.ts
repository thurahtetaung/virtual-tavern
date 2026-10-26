import { describe, expect, it } from 'vitest';
import { paragraphsOf } from './text.ts';

describe('logbook paragraphs', () => {
  it('splits at blank lines and keeps single line breaks', () => {
    expect(paragraphsOf('Day one.\nCalm.\n\n\nDay two.\r\n\r\n*Storm.*')).toEqual([
      'Day one.\nCalm.',
      'Day two.',
      '*Storm.*',
    ]);
    expect(paragraphsOf('One paragraph only.')).toEqual(['One paragraph only.']);
  });
});
