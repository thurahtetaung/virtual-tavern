import type { GameRoomInfo } from '@vt/game-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defineHydra } from '../logic/game.ts';
import { guide } from '../logic/guide.ts';
import { PLACEHOLDER_NAMES } from '../logic/names.ts';
import { type Harness, ids, rigged, round } from '../logic/test-utils.ts';
import type { HydraView, Role } from '../logic/types.ts';
import { type Content, contentFor } from './assets.ts';
import { MeTab, type RoleReveal } from './Me.tsx';
import { Seats } from './Seats.tsx';

const ROLES: Role[] = ['blue', 'red', 'leader', 'blue', 'red', 'blue', 'blue'];
const players = ids(ROLES.length);

const editions: [string, Content, Harness][] = [
  ['hydra', contentFor(null), rigged(ROLES)],
  [
    'an edition',
    contentFor(
      { names: { ...PLACEHOLDER_NAMES, blue: 'Owl', blues: 'Owls', red: 'Fox', reds: 'Foxes' } },
      'edition',
    ),
    rigged(ROLES, {
      def: defineHydra({ id: 'edition', name: 'Edition', description: 'x', guide }),
    }),
  ],
];

const reveal = (shown: boolean): RoleReveal => ({
  open: shown,
  setOpen: () => {},
  held: false,
  setHeld: () => {},
  flat: false,
  shown,
});

const me = (view: HydraView, c: Content, shown: boolean) =>
  renderToStaticMarkup(
    <MeTab
      view={view}
      c={c}
      reveal={reveal(shown)}
      showGuide={() => {}}
      moments
      setMoments={() => {}}
      plain={false}
      setPlain={() => {}}
    />,
  );

const room = (you: string): GameRoomInfo => ({
  you,
  hostId: players[0]!,
  isHost: you === players[0],
  players: players.map((id) => ({ id, name: id.toUpperCase(), connected: true })),
  clockOffset: 0,
  wordLists: [],
});

const seats = (view: HydraView, c: Content, showKnown: boolean) =>
  renderToStaticMarkup(
    <Seats
      view={view}
      room={room(view.me!.id)}
      c={c}
      pick={null}
      marks={{}}
      onMark={() => {}}
      onOpen={() => {}}
      onWhy={() => {}}
      showKnown={showKnown}
    />,
  );

describe.each(editions)('the Me tab in %s', (_, c, h) => {
  const check = () => {
    const hidden = players.map((p) => me(h.view(p), c, false));
    // Face down, every seat's Me tab is the same page: no side, no goal, no teammates, no secrets.
    for (const html of hidden) expect(html).toBe(hidden[0]);
    for (const html of hidden) {
      expect(html).not.toContain('role-details"');
      expect(html).not.toContain('What only you saw');
      expect(html).not.toContain(c.roleName('leader'));
      for (const p of players) expect(html).not.toMatch(new RegExp(`>${p.toUpperCase()}<`));
    }
    return hidden;
  };

  it('gives nothing away while the card is down, at the deal and after a session', () => {
    check();
    round(h, players[1]!, 'red');
    expect(h.view(players[0]!).game!.memories.length).toBeGreaterThan(0);
    check();
  });

  it('shows the goal, the teammates and the secrets as soon as the card is up', () => {
    const red = me(h.view(players[1]!), c, true);
    expect(red).toContain('role-details"');
    expect(red).toContain('How you win');
    expect(red).toContain(`>${players[2]!.toUpperCase()}<`);
    expect(red).toContain(c.roleName('leader'));
    const blue = me(h.view(players[0]!), c, true);
    expect(blue).toContain(c.t('{blue}'));
    expect(blue).toContain('What only you saw');
  });

  it('badges your teammates on the seats only while the card is up', () => {
    const view = h.view(players[1]!);
    expect(seats(view, c, false)).not.toContain('Your teammate');
    expect(seats(view, c, true)).toContain('Your teammate');
  });
});
