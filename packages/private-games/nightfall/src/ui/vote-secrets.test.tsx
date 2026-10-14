import type { GameRoomInfo } from '@vt/game-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { table } from '../logic/test-utils.ts';
import { deckFor } from './assets.ts';
import { Day } from './Play.tsx';
import { statusFor } from './status.ts';

const W = 'werewolf';
const V = 'villager';

const room = (you: string, ids: readonly string[]): GameRoomInfo => ({
  you,
  hostId: 'A',
  isHost: you === 'A',
  players: ids.map((id) => ({ id, name: id, connected: true })),
  clockOffset: 0,
  wordLists: [],
});

/** The vote's status line, peek and table of buttons, as `you` sees them. */
function votePanel(h: ReturnType<typeof table>, you: string) {
  const view = h.view(you);
  const r = room(you, h.ids);
  const html = renderToStaticMarkup(
    <Day
      view={view}
      room={r}
      act={() => Promise.resolve(true)}
      status={statusFor(view, r)}
      deck={deckFor(null, () => '')}
      lines={[]}
      sound={null}
    />,
  );
  const status = /<p role="status"[^>]*>(.*?)<\/p>/.exec(html)?.[1];
  const from = html.indexOf('Hold to see what your pick does');
  const list = /<ul[^>]*aria-label="The table"[^>]*>.*?<\/ul>/.exec(html)?.[0];
  return { html, status, peek: from >= 0, list };
}

describe('the Bodyguard’s vote stays secret', () => {
  it('shows a dealt Bodyguard the same status, peek and buttons as everyone else', () => {
    const h = table({ players: ['bodyguard', W, V] });
    h.dawn();
    for (const id of h.ids) h.act({ type: 'ready-to-vote', ready: true }, id);
    expect(h.state.stage).toBe('vote');
    // A (the Bodyguard) and C (a villager) both pick B, so their tables read alike.
    h.act({ type: 'vote', target: 'B' }, 'A');
    h.act({ type: 'vote', target: 'B' }, 'C');
    const guard = votePanel(h, 'A');
    const villager = votePanel(h, 'C');
    expect(guard.status).toBe(villager.status);
    expect(guard.peek).toBe(true);
    expect(villager.peek).toBe(true);
    // Each player's own row is the one without a button; strip it so the lists compare.
    const others = (list: string | undefined, me: string) =>
      (list ?? '').replace(new RegExp(`<li><div[^>]*>.*?${me} \\(you\\).*?</li>`), '');
    expect(others(guard.list, 'A')).not.toBe('');
    expect(others(guard.list, 'A')).toContain('Vote for B');
    for (const page of [guard.html, villager.html]) {
      expect(page).not.toContain('Protect');
      expect(page).not.toContain('PROTECTS');
      expect(page).not.toContain('🛡️');
      expect(page).not.toMatch(/bg-success/);
    }
  });

  it('offers no peek when nobody’s pick can protect', () => {
    const h = table({ players: [W, V, V] });
    h.dawn();
    for (const id of h.ids) h.act({ type: 'ready-to-vote', ready: true }, id);
    expect(votePanel(h, 'B').peek).toBe(false);
  });
});
