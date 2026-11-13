import type { GameRoomInfo } from '@vt/game-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { goingOnce } from '../logic/definition.ts';
import { started } from '../logic/test-utils.ts';
import type { GoingOnceView } from '../logic/types.ts';
import { Draw } from './Draw.tsx';

const room = { clockOffset: 0, players: [] } as unknown as GameRoomInfo;

/** The drawing screen p1 sees, with the pads opening `inMs` from now. */
function screen(inMs: number) {
  const h = started(3);
  const view = goingOnce.view(h.state, 'p1');
  const g = view.game!;
  const at = Date.now() + inMs;
  const shifted: GoingOnceView = {
    ...view,
    game: { ...g, drawFrom: at, until: at + (g.until - g.drawFrom) },
  };
  return renderToStaticMarkup(
    <Draw view={shifted} room={room} act={() => Promise.resolve(true)} />,
  );
}

describe('the drawing screen', () => {
  it('shows your titles on a waiting card, with no board, until the auctioneer calls', () => {
    const html = screen(30_000);
    expect(html).toContain('data-testid="go-waiting"');
    expect(html).toContain('Listen — the auctioneer will call for the drawings.');
    expect(html).toMatch(/1\. .+ · 2\. .+</);
    expect(html).not.toContain('data-testid="drawing-pad"');
  });

  it('puts the board and its tools in its place once the drawings are called for', () => {
    const html = screen(-1000);
    expect(html).not.toContain('data-testid="go-waiting"');
    expect(html).toContain('data-testid="drawing-pad"');
    expect(html).toContain('aria-label="Line width"');
  });
});
