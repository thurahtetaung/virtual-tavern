import {
  EDITIONS,
  type Role,
  type RoyalPostAction,
  type RoyalPostView,
} from '@vt/private-royal-post/logic';
import type { TestClient } from './helpers.ts';

const rank = (view: RoyalPostView, role: Role) =>
  EDITIONS[view.settings.edition].cards.find((c) => c.role === role)?.rank ?? 0;

/**
 * A simple legal move for whoever's turn it is: the Countess when forced, else the first of
 * `prefer` in hand, else the lower card, never the Princess. Guards name the Priest.
 */
export function royalPostMove(
  view: RoyalPostView,
  prefer: Role[] = ['priest', 'guard', 'handmaid'],
): RoyalPostAction {
  const round = view.round!;
  const me = view.me!.id;
  const hand = view.hand;
  if (round.stage === 'chancellor') {
    return { type: 'chancellor-keep', keep: hand[0]!, bottomOrder: hand.slice(1) };
  }
  const forced = hand.includes('countess') && (hand.includes('king') || hand.includes('prince'));
  const options: Role[] = hand.filter((c) => c !== 'princess');
  const card: Role = forced
    ? 'countess'
    : (prefer.find((c) => options.includes(c)) ??
      [...options].sort((a, b) => rank(view, a) - rank(view, b))[0]!);
  const others = round.players.filter((p) => !p.out && !p.protected && p.id !== me);
  const targeted = ['guard', 'priest', 'baron', 'prince', 'king'].includes(card);
  const target = !targeted ? undefined : (others[0]?.id ?? (card === 'prince' ? me : undefined));
  return {
    type: 'play',
    card,
    ...(target ? { target } : {}),
    ...(card === 'guard' && target ? { guess: 'priest' as const } : {}),
  };
}

/** Changes with every move: a play logs something, a Chancellor's keep passes the turn. */
const turnKey = (v: RoyalPostView) =>
  JSON.stringify([v.phase, v.round?.number, v.round?.current, v.round?.stage, v.log.at(-1)?.id]);

export const royalPostView = (c: TestClient) => c.latest()!.game as RoyalPostView;

/** Has whoever's turn it is make `royalPostMove`; returns who moved and what they did. */
export async function playRoyalPostTurn(clients: TestClient[], prefer?: Role[]) {
  const findMover = () =>
    clients.find((c) => {
      const v = royalPostView(c);
      return v.round && v.round.stage !== 'over' && v.round.current === v.me?.id;
    });
  // The turn can pass (or the round end) in a later update than the one the last move waited
  // for, so give the clients a moment to catch up before deciding nobody can move.
  let mover = findMover();
  for (let i = 0; !mover && i < 100; i++) {
    if (clients.some((c) => royalPostView(c).round?.stage === 'over')) return null;
    await new Promise((resolve) => setTimeout(resolve, 10));
    mover = findMover();
  }
  if (!mover) throw new Error('nobody to move');
  const view = royalPostView(mover);
  const action = royalPostMove(view, prefer);
  const before = turnKey(view);
  // Stay under the per-socket rate limit (20 actions a second) over a long game.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const ack = await mover.call('game:action', action);
  if (!ack.ok) throw new Error(`move refused: ${JSON.stringify(ack)}`);
  // Wait until every client has seen the move.
  await Promise.all(
    clients.map((c) => c.until((s) => turnKey(s.game as RoyalPostView) !== before)),
  );
  return { mover, view, action };
}
