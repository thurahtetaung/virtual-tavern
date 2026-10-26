import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShowTargets, ShowTargetsProvider } from './blocks.tsx';
import { Choosers, RevealCard } from './reveal.tsx';
import type { LoadedRig } from './rig.ts';

// A made-up rig: a card with two parts (one with art), a chooser with a name and points.
const pose = [1, 0, 0, 1, 0, 0, 1] as [number, number, number, number, number, number, number];
const rig: LoadedRig = {
  fps: 30,
  stage: [1280, 720],
  symbols: { 'card-ramp': '<path d="M0 0h10v10H0z"/>' },
  tracks: {
    'card-ramp': { Appear: { ms: 33, frames: [pose] } },
    'card-bubble': { Appear: { ms: 33, frames: [pose] } },
    'chooser-playerName': { Appear: { ms: 33, frames: [pose] } },
    'chooser-points': { Appear: { ms: 33, frames: [pose] } },
  },
  places: {},
  textures: {},
};

function render(node: React.ReactNode) {
  const targets = new ShowTargets();
  return renderToStaticMarkup(<ShowTargetsProvider targets={targets}>{node}</ShowTargetsProvider>);
}

describe('RevealCard', () => {
  it('draws a hidden layer per card part: the rig’s art, or the game’s live content', () => {
    const html = render(<RevealCard rig={rig} live={{ 'card-bubble': <b>the answer</b> }} />);
    expect(html).toContain('<path');
    expect(html).toContain('<b>the answer</b>');
    expect(html.match(/opacity:0/g)?.length).toBe(2);
  });
});

describe('Choosers', () => {
  it('holds every chip the reveal can name, each with a dot, a name and its points', () => {
    const html = render(<Choosers rig={rig} />);
    expect(html.match(/vt-chip-dot/g)?.length).toBe(7);
    expect(html.match(/class="vt-chip"/g)?.length).toBe(7);
  });
});
