import type { RoundTableView } from '@vt/game-round-table/logic';
import { expect } from 'vitest';
import type { TestClient } from './helpers.ts';

export const roundTableView = (c: TestClient) => c.latest()!.game as RoundTableView;

const ok = { ok: true };

/**
 * Plays one five-player Percival & Morgana game over sockets: everyone reads their card, the
 * first team is rejected by all, then each leader sends only Good players, everyone approves and
 * every quest succeeds. At the assassination the Assassin names Merlin (`hit`) or a servant.
 * Returns every view each client was sent.
 */
export async function playRoundTable(clients: TestClient[], hit: boolean) {
  const [host] = clients as [TestClient];
  const seen = new Map<TestClient, RoundTableView[]>(clients.map((c) => [c, []]));
  for (const c of clients) c.on('room:state', (s) => seen.get(c)!.push(s.game as RoundTableView));
  expect(
    await host.call('game:action', { type: 'update-settings', preset: 'percival-morgana' }),
  ).toEqual(ok);
  expect(await host.call('game:action', { type: 'start' })).toEqual(ok);
  await Promise.all(
    clients.map((c) => c.until((s) => (s.game as RoundTableView).stage === 'reveal')),
  );
  for (const c of clients) expect(await c.call('game:action', { type: 'ready' })).toEqual(ok);
  await Promise.all(
    clients.map((c) => c.until((s) => (s.game as RoundTableView).stage === 'propose')),
  );
  const byId = new Map(clients.map((c) => [c.latest()!.you, c]));
  const role = (id: string) => roundTableView(byId.get(id)!).role!;
  const good = [...byId.keys()].filter((id) => role(id).loyalty === 'good');
  const leaderOf = () => byId.get(roundTableView(host).game!.leader)!;
  const settled = (stage: string, proposals: number) =>
    Promise.all(
      clients.map((c) =>
        c.until(
          (s) =>
            (s.game as RoundTableView).stage === stage &&
            (s.game as RoundTableView).game!.proposals.length === proposals,
        ),
      ),
    );

  // The first team is voted down by everyone.
  const first = roundTableView(host).game!;
  const size = first.quests[first.slot!]!.size;
  expect(
    await leaderOf().call('game:action', { type: 'propose', team: good.slice(0, size) }),
  ).toEqual(ok);
  expect(await leaderOf().call('game:action', { type: 'call-vote' })).toEqual(ok);
  for (const c of clients)
    expect(await c.call('game:action', { type: 'vote', approve: false })).toEqual(ok);
  await settled('propose', 1);

  for (let quest = 0; quest < 3; quest++) {
    const g = roundTableView(host).game!;
    const team = good.slice(0, g.quests[g.slot!]!.size);
    expect(await leaderOf().call('game:action', { type: 'propose', team })).toEqual(ok);
    expect(await leaderOf().call('game:action', { type: 'call-vote' })).toEqual(ok);
    for (const c of clients)
      expect(await c.call('game:action', { type: 'vote', approve: true })).toEqual(ok);
    await settled('quest', g.proposals.length + 1);
    for (const id of team)
      expect(await byId.get(id)!.call('game:action', { type: 'play', card: 'success' })).toEqual(
        ok,
      );
    await host.until((s) => (s.game as RoundTableView).game!.results.length === quest + 1);
  }
  await Promise.all(
    clients.map((c) => c.until((s) => (s.game as RoundTableView).stage === 'assassinate')),
  );
  const assassin = [...byId.keys()].find((id) => role(id).assassin)!;
  const merlin = [...byId.keys()].find((id) => role(id).role === 'merlin')!;
  const servant = good.find((id) => id !== merlin)!;
  expect(
    await byId
      .get(assassin)!
      .call('game:action', { type: 'assassinate', target: hit ? merlin : servant }),
  ).toEqual(ok);
  const final = await Promise.all(
    clients.map(
      async (c) =>
        (await c.until((s) => (s.game as RoundTableView).phase === 'over')).game as RoundTableView,
    ),
  );
  return { seen, final, assassin, merlin };
}
