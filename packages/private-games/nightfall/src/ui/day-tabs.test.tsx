import type { GameRoomInfo } from '@vt/game-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { table } from '../logic/test-utils.ts';
import { deckFor } from './assets.ts';
import { Day } from './Play.tsx';
import { statusFor } from './status.ts';

const room = (you: string, ids: readonly string[]): GameRoomInfo => ({
  you,
  hostId: 'A',
  isHost: you === 'A',
  players: ids.map((id) => ({ id, name: id, connected: true })),
  clockOffset: 0,
  wordLists: [],
});

/** The day as `you` first sees it (a phone, on the Table tab). */
function day(h: ReturnType<typeof table>, you: string) {
  const view = h.view(you);
  const r = room(you, h.ids);
  return renderToStaticMarkup(
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
}

describe('the day’s sections', () => {
  const seerDay = () => {
    const h = table({ players: ['seer', 'werewolf', 'villager'] });
    h.toStep('seer');
    h.night('A', { players: ['B'] });
    h.dawn();
    expect(h.state.stage).toBe('day');
    return day(h, 'A');
  };

  it('never renders what you learned until you open it', () => {
    const html = seerDay();
    expect(html).not.toContain('What you learned tonight');
    expect(html).not.toContain('Where you stand now');
  });

  it('wires every tab to its panel', () => {
    const html = seerDay();
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      const id = /\bid="([^"]+)"/.exec(tab)![1]!;
      const controls = /aria-controls="([^"]+)"/.exec(tab)![1]!;
      expect(html).toContain(`role="tabpanel" id="${controls}" aria-labelledby="${id}"`);
      expect(tab).toContain('min-h-11');
    }
    expect(tabs.filter((t) => t.includes('aria-selected="true"'))).toHaveLength(1);
  });
});
