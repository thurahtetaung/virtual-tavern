import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contentFor } from './assets.ts';
import { HandPanel } from './GhostShell.tsx';

const content = contentFor('unavailable');
const hand = [11, 22, 33];
const panel = (props: Partial<Parameters<typeof HandPanel>[0]>) =>
  renderToStaticMarkup(
    <HandPanel
      hand={hand}
      content={content}
      sub=""
      picked={[]}
      onToggle={() => undefined}
      pickLabel="Pick"
      pickedLabel="✓ Picked"
      raven={false}
      onRaven={() => undefined}
      ravenDisabled
      ravenLabel="Raven"
      refusal="test"
      {...props}
    />,
  );

describe('the ghost’s hand: looking and picking are separate', () => {
  it('without anything to pick, the cards only open to look', () => {
    const page = panel({});
    expect(page.match(/data-card="vision-\d+"/g)).toHaveLength(3);
    expect(page).not.toContain('data-pick');
    expect(page).not.toMatch(/<button[^>]*aria-pressed[^>]*data-card/);
  });

  it('picking is its own button beside each card, never the card itself', () => {
    const page = panel({ picked: [22], pickable: () => true });
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
    const page = panel({ picked: [11], pickable: () => false });
    expect(page).toMatch(/aria-pressed="true"[^>]*data-pick="vision-11"/);
    expect(page).toMatch(/data-pick="vision-22"[^>]*disabled=""/);
    expect(page).not.toMatch(/data-pick="vision-11"[^>]*disabled=""/);
  });
});
