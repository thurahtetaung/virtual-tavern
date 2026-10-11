import type { NightfallAction, NightfallView, RoleId } from '@vt/private-nightfall/logic';
import type { RoomSnapshot } from '@vt/protocol';
import { expect } from 'vitest';
import type { TestClient } from './helpers.ts';

export const nightfallView = (c: TestClient) => c.latest()!.game as NightfallView;

/** `until` with room for a whole night (each wait gives up after 3 s, so keep asking). */
async function patient(
  c: TestClient,
  p: (s: RoomSnapshot) => boolean,
  ms = 45_000,
): Promise<RoomSnapshot> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await c.until(p);
    } catch (err) {
      if (Date.now() > end) throw err;
    }
  }
}

/** The first legal answer to whatever the player is asked at night, or null. */
export function nightMove(v: NightfallView): NightfallAction | null {
  const night = v.night;
  const pr = night?.acting?.prompt;
  if (!night || !pr) return null;
  if (pr.sides) return { type: 'night', step: night.index, side: 'left' };
  if (pr.players)
    return { type: 'night', step: night.index, players: pr.players.ids.slice(0, pr.players.min) };
  if (pr.center)
    return { type: 'night', step: night.index, center: pr.center.slots.slice(0, pr.center.min) };
  return null;
}

/**
 * Plays one Nightfall game over sockets: the host sets the cards and step length and deals,
 * everyone gets ready, each player acts whenever their step comes (first legal choice), everyone
 * is ready to vote, then `vote` says who votes for whom (by index). Returns every view each
 * client was sent, and the final views.
 */
export async function playNightfall(
  clients: TestClient[],
  roles: RoleId[],
  vote: (i: number, ids: string[]) => number,
) {
  const [host] = clients as [TestClient];
  const seen = new Map<TestClient, NightfallView[]>(clients.map((c) => [c, []]));
  for (const c of clients) c.on('room:state', (s) => seen.get(c)!.push(s.game as NightfallView));
  const ok = { ok: true };
  expect(
    await host.call('game:action', {
      type: 'update-settings',
      roles,
      stepSeconds: 3,
      daySeconds: 30,
    }),
  ).toEqual(ok);
  expect(await host.call('game:action', { type: 'start' })).toEqual(ok);
  await Promise.all(
    clients.map((c) => c.until((s) => (s.game as NightfallView).phase === 'ready')),
  );
  for (const c of clients) expect(await c.call('game:action', { type: 'ready' })).toEqual(ok);
  await Promise.all(
    clients.map((c) => patient(c, (s) => (s.game as NightfallView).phase === 'night')),
  );

  // Each player acts as their steps come, until daybreak.
  await Promise.all(
    clients.map(async (c) => {
      let done = '';
      for (;;) {
        const s = await patient(c, (x) => {
          const v = x.game as NightfallView;
          if (v.phase !== 'night') return true;
          const move = nightMove(v);
          return move !== null && `${v.night!.index}:${JSON.stringify(move)}` !== done;
        });
        const v = s.game as NightfallView;
        if (v.phase !== 'night') return;
        const move = nightMove(v)!;
        done = `${v.night!.index}:${JSON.stringify(move)}`;
        // A step can end between the view and the action: that refusal is fine.
        await c.call('game:action', move);
      }
    }),
  );
  await Promise.all(
    clients.map((c) => patient(c, (s) => (s.game as NightfallView).phase === 'day')),
  );
  for (const c of clients)
    expect(await c.call('game:action', { type: 'ready-to-vote', ready: true })).toEqual(ok);
  await Promise.all(clients.map((c) => c.until((s) => (s.game as NightfallView).phase === 'vote')));
  const ids = nightfallView(host).table!.map((p) => p.id);
  for (const [i, c] of clients.entries())
    expect(await c.call('game:action', { type: 'vote', target: ids[vote(i, ids)]! })).toEqual(ok);
  await Promise.all(
    clients.map((c) => c.until((s) => (s.game as NightfallView).phase === 'reveal')),
  );
  return { seen, ids, final: clients.map(nightfallView) };
}
