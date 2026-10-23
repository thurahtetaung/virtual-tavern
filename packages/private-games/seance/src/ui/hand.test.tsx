import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contentFor } from './assets.ts';
import { HandCards } from './Ghost.tsx';

const content = contentFor('unavailable');
const hand = [11, 22, 33];

describe('the ghost’s hand: looking and picking are separate', () => {
  it('without anything to pick, the cards only open to look', () => {
    const page = renderToStaticMarkup(<HandCards hand={hand} content={content} picked={[]} />);
    expect(page.match(/data-card="vision-\d+"/g)).toHaveLength(3);
    expect(page).not.toContain('data-pick');
    expect(page).not.toContain('aria-pressed');
  });

  it('picking is its own button beside each card, never the card itself', () => {
    const page = renderToStaticMarkup(
      <HandCards hand={hand} content={content} picked={[22]} onToggle={() => undefined} />,
    );
    expect(page.match(/<button[^>]*data-pick="vision-\d+"/g)).toHaveLength(3);
    // The card buttons carry no pressed state: a tap on them only looks.
    for (const n of hand)
      expect(page).not.toMatch(new RegExp(`<button[^>]*aria-pressed[^>]*data-card="vision-${n}"`));
    expect(page).toMatch(/aria-pressed="true"[^>]*data-pick="vision-22"/);
    expect(page).toMatch(/aria-pressed="false"[^>]*data-pick="vision-11"/);
    // Picks never sit inside the card's own button.
    expect(page).not.toMatch(/<button[^>]*data-card[^>]*>(?:(?!<\/button>).)*data-pick/);
  });

  it('a full pick (the shared vision’s 3) stops more picks but lets you unpick', () => {
    const page = renderToStaticMarkup(
      <HandCards
        hand={hand}
        content={content}
        picked={[11]}
        canPick={() => false}
        onToggle={() => undefined}
      />,
    );
    expect(page).toMatch(/aria-pressed="true"[^>]*data-pick="vision-11"/);
    expect(page).toMatch(/data-pick="vision-22"[^>]*disabled=""/);
    expect(page).not.toMatch(/data-pick="vision-11"[^>]*disabled=""/);
  });
});
