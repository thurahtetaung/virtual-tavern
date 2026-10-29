import { describe, expect, it } from 'vitest';
import { footerOf, genreName, namesOf } from './manifest.ts';

// A made-up manifest with neutral words.
describe('manifest names', () => {
  it('falls back to plain words without a manifest', () => {
    const n = namesOf(null);
    expect(n.title).toBe('Cliffhanger');
    expect(n.styles.quote).toBe('Quote It');
    expect(genreName(n, 'crime', 'tv')).toBe('Crime');
    expect(footerOf(null)).toBeUndefined();
  });

  it('reads styles by id or by the board’s words, and genre names per deck', () => {
    const n = namesOf({
      names: {
        styles: { 'one-word': 'Single', 'quote-it': 'Say a line', 'act-it': 'Mime' },
        genres: { action: 'Bangs' },
        tvGenres: { action: 'TV bangs' },
      },
    });
    expect(n.styles).toMatchObject({ 'one-word': 'Single', quote: 'Say a line', act: 'Mime' });
    expect(n.styles['describe-badly']).toBe('Describe It Badly');
    expect(genreName(n, 'action', 'films')).toBe('Bangs');
    expect(genreName(n, 'action', 'tv')).toBe('TV bangs');
  });

  it('takes a credit as one line of text or as a block', () => {
    expect(footerOf({ credit: 'Art from a box.' })).toEqual({
      title: 'Credits',
      paragraphs: ['Art from a box.'],
    });
    expect(
      footerOf({
        credit: { title: 'Thanks', paragraphs: ['A'], links: [{ label: 'x', href: 'http://no' }] },
      }),
    ).toEqual({ title: 'Thanks', paragraphs: ['A'] });
  });
});
