import { describe, expect, it } from 'vitest';
import { nameGuide } from './guide.ts';
import { PLAIN_WORDS, reword, wordsOf } from './names.ts';

describe('the action’s word', () => {
  it('is “recruit” without a manifest', () => {
    expect(wordsOf(null)).toBe(PLAIN_WORDS);
    expect(reword('Recruit & Show', PLAIN_WORDS)).toBe('Recruit & Show');
  });

  it('takes the manifest’s word in every form and case', () => {
    const w = wordsOf({ names: { recruit: 'Enlist' } });
    expect(w).toEqual({
      recruit: 'enlist',
      recruits: 'enlists',
      recruited: 'enlisted',
      recruiting: 'enlisting',
    });
    expect(
      reword('Recruit & Show. Ana recruits the 6; recruited cards; Recruiting the 2.', w),
    ).toBe('Enlist & Show. Ana enlists the 6; enlisted cards; Enlisting the 2.');
    expect(wordsOf({ names: { recruit: 'hire' } }).recruited).toBe('hired');
    // Nonsense is ignored.
    expect(wordsOf({ names: { recruit: '<b>x</b>' } })).toBe(PLAIN_WORDS);
  });

  it('rewords the whole named guide', () => {
    const text = JSON.stringify(nameGuide({ names: { recruit: 'enlist' } }));
    expect(text).not.toMatch(/recruit/i);
    expect(text).toContain('Enlist & Show');
  });
});
