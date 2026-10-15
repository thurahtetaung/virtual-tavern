import type { GameRoomInfo } from '@vt/game-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { game, ids, propose, questRound, rigged, voteAll } from '../logic/test-utils.ts';
import type { RoundTableView } from '../logic/types.ts';
import { LadyResult } from './Actions.tsx';
import { Seats } from './Board.tsx';
import { History } from './History.tsx';
import { TopBar, tipFor } from './RoundTableGame.tsx';

const players = ids(8);
const room = (you: string): GameRoomInfo => ({
  you,
  hostId: players[0]!,
  isHost: you === players[0],
  players: players.map((id) => ({ id, name: id.toUpperCase(), connected: true })),
  clockOffset: 0,
  wordLists: [],
});

const table = (view: RoundTableView, shown: boolean) =>
  renderToStaticMarkup(
    <>
      <LadyResult view={view} shown={shown} />
      <Seats
        view={view}
        room={room(view.me!.id)}
        pick={null}
        marks={{}}
        onMark={() => {}}
        showKnown={shown}
      />
      <History view={view} shown={shown} />
    </>,
  );

describe('the table with what you know hidden', () => {
  const h = rigged(
    ['merlin', 'percival', 'morgana', 'servant', 'servant', 'assassin', 'minion', 'servant'],
    { lady: true },
  );
  questRound(h, ['ana', 'cy', 'dee']);
  questRound(h, ['ana', 'cy', 'dee', 'eve']);
  const holder = game(h).ladyState!.holder;
  h.act({ type: 'lady', target: 'ben' }, holder);

  // The same view with every secret taken out: what the hidden table must match exactly.
  const stripped = (v: RoundTableView): RoundTableView => ({
    ...v,
    role: v.role && { ...v.role, known: [] },
    game: v.game && {
      ...v.game,
      lady: v.game.lady && {
        ...v.game.lady,
        mine: v.game.lady.mine.map((m) => ({ ...m, loyalty: 'good' })),
      },
    },
  });

  it('carries nothing secret for any seat: no badges, no Lady answer', () => {
    for (const id of players) {
      const v = h.view(id);
      const html = table(v, false);
      expect(html, id).toBe(table(stripped(v), false));
      expect(html, id).not.toMatch(/>Evil<|>Merlin\??<|>Morgana<|>Good</);
    }
    expect(h.view(holder).game!.lady!.mine).toHaveLength(1);
  });

  it('shows the badges and your check once you peek', () => {
    const evil = table(h.view('ben'), true);
    expect(evil).toMatch(/>Evil</);
    const merlin = table(h.view(players[0]!), true);
    expect(merlin).toMatch(/>Evil</);
    const percival = table(h.view('ana'), true);
    expect(percival).toMatch(/>Merlin\?</);
    const checker = table(h.view(holder), true);
    expect(checker).toMatch(/The Lady shows you/);
  });
});

describe('the header and tips with your role hidden', () => {
  const h = rigged([
    'merlin',
    'percival',
    'morgana',
    'servant',
    'servant',
    'assassin',
    'minion',
    'servant',
  ]);
  const topBar = (id: string) =>
    renderToStaticMarkup(
      <TopBar view={h.view(id)} room={room(id)} yourMove={false} onRole={() => {}} />,
    );

  it('shows the same “My role” button to every seat, with no emblem or role word', () => {
    const html = topBar(players[0]!);
    expect(html).toMatch(/My role/);
    expect(html).not.toMatch(/<svg|Merlin|Evil|Good|Morgana|Assassin/);
    for (const id of players) expect(topBar(id), id).toBe(html);
  });

  it('gives Good and Evil on a quest the same first-time tip', () => {
    propose(h, ['ana', 'ben', 'cy']);
    voteAll(h);
    const team = h.view('ana').game!.quest!.team;
    expect(new Set(team.map((id) => h.view(id).role!.loyalty))).toEqual(new Set(['good', 'evil']));
    const tips = team.map((id) => tipFor(h.view(id), () => true));
    expect(tips[0]).not.toBeNull();
    for (const tip of tips) expect(tip).toEqual(tips[0]);
  });
});
