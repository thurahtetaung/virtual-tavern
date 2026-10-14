import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import type { LogEntry, ShortFuseAction, ShortFuseState } from './types.ts';

/**
 * Stats events, read off the public log (so nothing secret is reported while the game is on) and,
 * at the end, the hidden placements from the truth log. Card types go out as plain ids; the stats
 * page and the recap name them through `{card:…}` placeholders.
 *
 *   play       {cards, kind, target}            a card or combo was played
 *   nope       {n}                              a Nope (n = its place in the chain)
 *   noped      {chain, kind, card}              a play was cancelled by Nopes
 *   yup        {chain}                          a play survived a chain of Nopes
 *   attack     {victim, owed}                   an attack landed
 *   draw       {from}                           a safe draw
 *   bomb       {kind, saved}                    a Bomb or Black Hole came up (saved: defuse | none | void)
 *   explode    {kind, turn, left, placedBy}     somebody exploded (left: cards still in the pile)
 *   steal      {how, victim, hit}               favor, pair or three of a kind
 *   placement  {kind, position, of, drawnBy, killed}   at the end, from the truth log
 *   timeout    {did}                            a strict timer or the host acted for someone
 *   mark       {target, card}  curse {victim}  cured {}  lost {card}  stack {n}  vault {}
 *   bark       {target}        mine {target}   mine-took {victim, bomb}  pooled {kind, n}
 *   self-attack {owed}         (steal events carry `stash: true` when the Vault paid)
 *   outcome    {players, turns, eliminated, preset, x1, faster, longestChain, maxOwed, maxOwedBy}
 */
export function insights(
  before: ShortFuseState,
  after: ShortFuseState,
  _action: ShortFuseAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const sameGame =
    before.game !== null &&
    before.phase !== 'lobby' &&
    !(before.phase === 'over' && after.phase === 'playing');
  const lastId = sameGame ? (before.game!.log.at(-1)?.id ?? 0) : 0;
  const fresh = g.log.filter((e) => e.id > lastId);
  const out: InsightEvent[] = fresh.flatMap((e) => eventOf(e, after));
  if (before.phase === 'playing' && after.phase === 'over') {
    for (const t of g.truth) {
      const killed = g.dead.some((d) => g.front[d.id]?.includes(t.card));
      out.push({
        type: 'placement',
        playerId: t.by,
        props: {
          kind: t.kind,
          position: t.position,
          of: t.of,
          drawnBy: t.drawnBy ?? null,
          killed,
        },
      });
    }
    out.push({
      type: 'outcome',
      playerId: g.winner,
      winners: g.winner ? [g.winner] : [],
      props: {
        players: g.players.length,
        turns: g.turn.n,
        eliminated: g.dead.map((d) => d.id),
        preset: g.core === 'party' ? 'party' : g.art === 'adult' ? 'adult' : 'classic',
        x1: g.x1,
        draws: g.stats.draws,
        longestChain: g.stats.longestChain,
        maxOwed: g.stats.maxOwed,
        maxOwedBy: g.stats.maxOwedBy,
      },
    });
  }
  return out;
}

function eventOf(e: LogEntry, after: ShortFuseState): InsightEvent[] {
  const g = after.game!;
  const by = e.by ?? null;
  switch (e.kind) {
    case 'play':
      return [
        {
          type: 'play',
          playerId: by,
          props: { cards: e.cards ?? [], kind: e.play ?? 'card', target: e.target ?? null },
        },
      ];
    case 'nope':
      return [{ type: 'nope', playerId: by, props: { n: e.n ?? 1 } }];
    case 'cancelled':
      return [
        {
          type: 'noped',
          playerId: by,
          props: { chain: e.n ?? 1, kind: e.play ?? 'card', card: e.cards?.[0] ?? null },
        },
      ];
    case 'resolved':
      return [{ type: 'yup', playerId: by, props: { chain: e.n ?? 0 } }];
    case 'attacked':
      return [
        { type: 'attack', playerId: by, props: { victim: e.target ?? null, owed: e.n ?? 2 } },
      ];
    case 'draw':
      return [{ type: 'draw', playerId: by, props: { from: e.from ?? 'top' } }];
    case 'drew-bomb':
      return [];
    case 'defuse':
      return [{ type: 'bomb', playerId: by, props: { kind: 'bomb', saved: 'defuse' } }];
    case 'void-up':
      return [{ type: 'bomb', playerId: by, props: { kind: 'void', saved: 'void' } }];
    case 'explode': {
      const kind = e.cards?.[0] ?? 'bomb';
      const bomb = g.front[by ?? '']?.at(-1);
      const placed = g.truth.findLast((t) => t.card === bomb);
      // A Twin Bombs' bark: whoever set it off.
      const bark =
        kind === 'twin' ? g.log.findLast((x) => x.kind === 'bark' && x.target === by) : null;
      return [
        { type: 'bomb', playerId: by, props: { kind, saved: 'none' } },
        {
          type: 'explode',
          playerId: by,
          props: {
            kind,
            turn: e.turn,
            left: g.pile.length,
            placedBy: placed && placed.by !== by ? placed.by : null,
            barkedBy: bark?.by ?? null,
          },
        },
      ];
    }
    case 'favor':
      return e.n
        ? [
            {
              type: 'steal',
              playerId: e.target ?? null,
              props: { how: 'favor', victim: by, hit: true, stash: e.from === 'stash' },
            },
          ]
        : [];
    case 'steal':
      return [
        {
          type: 'steal',
          playerId: by,
          props: { how: 'pair', victim: e.target ?? null, hit: !!e.n, stash: e.from === 'stash' },
        },
      ];
    case 'ask':
      return [
        {
          type: 'steal',
          playerId: by,
          props: { how: 'triple', victim: e.target ?? null, hit: !!e.hit, named: e.named ?? null },
        },
      ];
    case 'mark':
      return [
        {
          type: 'mark',
          playerId: by,
          props: { target: e.target ?? null, card: e.cards?.[0] ?? null },
        },
      ];
    case 'blind':
      return [{ type: 'curse', playerId: by, props: { victim: e.target ?? null } }];
    case 'cured':
      return [{ type: 'cured', playerId: by, props: {} }];
    case 'lost':
      return e.cards?.length ? [{ type: 'lost', playerId: by, props: { card: e.cards[0]! } }] : [];
    case 'stack':
      return [{ type: 'stack', playerId: by, props: { n: e.n ?? 0 } }];
    case 'vault':
      return [{ type: 'vault', playerId: by, props: {} }];
    case 'bark':
      return [{ type: 'bark', playerId: by, props: { target: e.target ?? null } }];
    case 'mine':
      return [{ type: 'mine', playerId: by, props: { target: e.target ?? null } }];
    case 'mine-took':
      return [
        {
          type: 'mine-took',
          playerId: by,
          props: { victim: e.target ?? null, bomb: !!e.cards?.length },
        },
      ];
    case 'pooled':
      return [{ type: 'pooled', playerId: by, props: { kind: e.cards?.[0] ?? null, n: e.n ?? 0 } }];
    case 'self-attack':
      return [{ type: 'self-attack', playerId: by, props: { owed: e.n ?? 3 } }];
    case 'timeout':
    case 'act-for':
      return [
        {
          type: 'timeout',
          playerId: e.kind === 'timeout' ? by : (e.target ?? null),
          props: { did: e.did ?? '', host: e.kind === 'act-for' },
        },
      ];
    default:
      return [];
  }
}
