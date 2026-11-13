import type { GameRoomInfo } from '@vt/game-sdk';
import { clone } from '@vt/game-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { thorns } from '../logic/game.ts';
import { rigStacks, started } from '../logic/test-utils.ts';
import { artFor } from './assets.ts';
import { Table } from './Table.tsx';

const room = (you: string, ids: readonly string[]): GameRoomInfo => ({
  you,
  hostId: 'p1',
  isHost: you === 'p1',
  players: ids.map((id) => ({ id, name: id, connected: true })),
  clockOffset: 0,
  wordLists: [],
});

const render = (h: ReturnType<typeof started>, you: string) =>
  renderToStaticMarkup(
    <Table
      view={thorns.view(h.state, you)}
      room={room(you, ['p1', 'p2', 'p3'])}
      act={() => Promise.resolve(true)}
      art={artFor(null)}
      name={(id) => id ?? 'Someone'}
    />,
  );

describe('Table', () => {
  it('offers the Challenger the flip only while the game is on', () => {
    const h = started(3, { first: 'p1' });
    const s = clone(h.state);
    s.game!.players.p1!.points = 1;
    h.state = s;
    rigStacks(h, { p1: ['rose'], p2: ['rose'], p3: ['thorn'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    expect(render(h, 'p1')).toContain('Turn over the top disc');
    h.act('p1', { type: 'flip', owner: 'p2' });
    expect(h.state.phase).toBe('over');
    expect(h.state.game!.round.stage).toBe('flip');
    const html = render(h, 'p1');
    expect(html).not.toContain('Turn over the top disc');
    expect(html).not.toContain('data-flip=');
  });
});
