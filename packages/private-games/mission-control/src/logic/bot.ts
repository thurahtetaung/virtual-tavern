import { type BotCtx, chance, pickOne } from '@vt/game-sdk';
import { type CardId, isTrump, valueOf, winningIndex } from './cards.ts';
import type { Check } from './checks.ts';
import {
  type AttemptView,
  DUMMY,
  type MissionControlAction,
  type MissionControlView,
} from './types.ts';

// A playtest teammate from its own view only: rule heuristics (win your own task cards, feed a
// teammate theirs, never win someone else's, get rid of high cards when out of a colour). It
// never proposes a distress signal and signals now and then.

const low = (cards: readonly CardId[]) =>
  [...cards].sort((a, b) => Number(isTrump(a)) - Number(isTrump(b)) || valueOf(a) - valueOf(b))[0]!;
const high = (cards: readonly CardId[]) =>
  [...cards].sort((a, b) => Number(isTrump(b)) - Number(isTrump(a)) || valueOf(b) - valueOf(a))[0]!;

/** Cards a task wants its holder to win. */
function wanted(c: Check): CardId[] {
  if (c.kind === 'win-cards') return c.cards;
  if (c.kind === 'all') return c.checks.flatMap(wanted);
  return [];
}

/** Who wants each card (open win-cards tasks). */
function wantMap(a: AttemptView): Map<CardId, string> {
  const out = new Map<CardId, string>();
  for (const t of a.tasks) {
    if (t.state !== 'open' || !t.owner) continue;
    for (const c of wanted(t.check)) out.set(c, t.owner);
  }
  return out;
}

function playMove(a: AttemptView, seat: string): MissionControlAction | null {
  const legal = a.legal;
  if (!legal.length) return null;
  const wants = wantMap(a);
  const mine = (c: CardId) => wants.get(c) === seat;
  if (!a.current.length) {
    // Lead a card I need if I hold the top of its colour, else my lowest.
    const own = legal.filter(mine);
    return { type: 'play', card: own.length ? high(own) : low(legal) };
  }
  const cards = a.current.map((p) => p.card);
  const winner = a.current[winningIndex(cards)]!.by;
  const wantedHere = cards.map((c) => wants.get(c)).find((o) => o);
  // Feed a teammate a card they want when they are winning.
  const feed = legal.find((c) => wants.get(c) === winner && winner !== seat);
  if (feed) return { type: 'play', card: feed };
  const beats = (c: CardId) => winningIndex([...cards, c]) === cards.length;
  if (wantedHere === seat || legal.some(mine)) {
    const win = legal.filter(beats);
    if (win.length) return { type: 'play', card: low(win) };
  }
  // Never win a trick holding someone else's card; when it's out of my hands, dump high.
  const safe = legal.filter((c) => !beats(c));
  if (safe.length)
    return { type: 'play', card: wantedHere && wantedHere !== seat ? low(safe) : high(safe) };
  return { type: 'play', card: low(legal) };
}

/** Some volunteer of the split holds no task while there are enough to go round. */
const tasks2 = (a: AttemptView, chosen: string[]) => {
  const tasks = a.tasks.filter((t) => !t.crew);
  const able = chosen.filter((s) => tasks.some((t) => !(t.captainCannot && s === a.captain)));
  return tasks.length >= able.length && able.some((s) => !tasks.some((t) => t.owner === s));
};

export function missionControlBot(
  view: MissionControlView,
  ctx: BotCtx,
): MissionControlAction | null {
  const me = ctx.me;
  if (view.phase === 'lobby') {
    if (view.me && !view.me.playing && view.seats.filter((s) => s.playing).length < 5)
      return { type: 'sit', playing: true };
    return null;
  }
  const a = view.attempt;
  if (!a || !a.crew.some((c) => c.id === me)) return null;
  const controls = a.controls;
  switch (a.stage) {
    case 'briefing':
      return a.ready.includes(me) ? null : { type: 'ready' };
    case 'draft': {
      const d = a.draft;
      const sel = a.mission.selection;
      const free =
        sel === 'free' || sel === 'all-to-one' || (sel === 'crew-wanted' && d.chosen.length > 1);
      if (free) {
        const open = a.tasks.filter((t) => !t.crew && t.owner === null);
        if (sel === 'all-to-one') {
          if (open.length) {
            const first = a.crew.find(
              (c) => c.id !== DUMMY && !(c.captain && a.tasks.some((t) => t.captainCannot)),
            );
            return first?.id === me ? { type: 'take-all' } : null;
          }
        } else {
          const can = (seat: string) =>
            (sel !== 'crew-wanted' || d.chosen.includes(seat)) &&
            open.some((t) => !(t.captainCannot && seat === a.captain));
          const counts = (seat: string) => a.tasks.filter((t) => t.owner === seat).length;
          const takers = a.crew
            .map((c) => c.id)
            .filter(can)
            .sort((x, y) => counts(x) - counts(y));
          const seat = takers[0];
          if (seat && controls.includes(seat)) {
            const t = open.find((x) => !(x.captainCannot && seat === a.captain))!;
            return {
              type: 'claim',
              task: t.index,
              on: true,
              ...(seat === DUMMY && { for: DUMMY }),
            };
          }
          if (open.length) return null;
          // The split: a volunteer with none waits for one with two or more to hand one back.
          if (sel === 'crew-wanted' && tasks2(a, d.chosen)) {
            const giver = d.chosen.find((x) => controls.includes(x) && counts(x) >= 2);
            const t = giver && a.tasks.find((x) => x.owner === giver && !x.captainCannot);
            if (t)
              return {
                type: 'claim',
                task: t.index,
                on: false,
                ...(giver === DUMMY && { for: DUMMY }),
              };
          }
        }
        const waiting =
          a.tasks.some((t) => !t.crew && t.owner === null) ||
          (sel === 'crew-wanted' && tasks2(a, d.chosen));
        return d.ready.includes(me) || waiting ? null : { type: 'ready' };
      }
      if (!d.turn || !controls.includes(d.turn)) return null;
      if (
        sel === 'crew-wanted' ||
        (sel === 'captain-offers' && d.order.includes(d.turn) && !(d.turn in d.answers))
      ) {
        const left = d.order.length - d.order.indexOf(d.turn);
        const must = sel === 'crew-wanted' && a.mission.wanted - d.chosen.length >= left;
        return { type: 'answer', yes: must || chance(ctx.rng, 0.5) };
      }
      if (sel === 'captain-offers') {
        const yes = Object.entries(d.answers).flatMap(([s, y]) => (y ? [s] : []));
        const keep = !a.tasks.some((t) => t.captainCannot);
        const to =
          keep && (yes.length === 0 || chance(ctx.rng, 0.5))
            ? a.captain
            : (pickOne(ctx.rng, yes) ?? a.captain);
        return { type: 'give', to };
      }
      if (d.canPass && chance(ctx.rng, 0.3)) return { type: 'pass' };
      const t = a.tasks.find(
        (x) => !x.crew && x.owner === null && !(x.captainCannot && d.turn === a.captain),
      );
      if (
        a.mission.selection === 'hardest-first' &&
        d.turn === a.captain &&
        a.tasks.every((x) => x.owner === null)
      ) {
        const options = a.tasks.filter((x) => !x.crew && !x.captainCannot);
        const top = options.reduce((b, x) => (x.difficulty > b.difficulty ? x : b), options[0]!);
        return { type: 'take', task: top.index };
      }
      return t ? { type: 'take', task: t.index } : d.canPass ? { type: 'pass' } : null;
    }
    case 'distress':
      if (a.distress.proposal)
        return a.distress.accepted.includes(me) ? null : { type: 'distress-answer', yes: true };
      return a.distress.dive.includes(me) ? null : { type: 'dive' };
    case 'pass': {
      for (const seat of controls) {
        if (seat in a.distress.myPass) continue;
        const cards =
          seat === DUMMY
            ? (a.dummy?.up.filter((c): c is CardId => c !== null) ?? [])
            : (a.hand ?? []);
        const give = cards.filter((c) => !isTrump(c));
        if (give.length)
          return { type: 'pass-card', card: low(give), ...(seat === DUMMY && { for: DUMMY }) };
      }
      return null;
    }
    case 'predict': {
      const t = a.tasks.find(
        (x) =>
          x.owner &&
          controls.includes(x.owner) &&
          x.prediction === null &&
          x.check.kind === 'predict',
      );
      if (!t) return null;
      const hand =
        t.owner === DUMMY
          ? (a.dummy?.up.filter((c): c is CardId => c !== null) ?? [])
          : (a.hand ?? []);
      const strong = hand.filter((c) => (isTrump(c) ? valueOf(c) >= 3 : valueOf(c) >= 9)).length;
      return { type: 'predict', task: t.index, n: Math.min(a.total, strong) };
    }
    case 'play': {
      if (!a.current.length && !a.signalBlock && chance(ctx.rng, 0.25)) {
        const options = Object.entries(a.signalable);
        const pick = pickOne(ctx.rng, options);
        if (pick)
          return {
            type: 'signal',
            card: pick[0],
            pos: a.comms === 'currents' ? null : pick[1][0]!,
          };
      }
      if (!controls.includes(a.turn)) return null;
      if (!a.current.length && a.holds.length) return null;
      return playMove(a, a.turn);
    }
    default:
      return null;
  }
}
