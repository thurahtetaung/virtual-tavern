import type { Rng } from '@vt/game-sdk';
import { type CardId, DECK, TRUMP, isTrump, suitOf } from './cards.ts';
import type { Check } from './checks.ts';
import type { OrderToken, PickRole } from './content.ts';
import { type Attempt, DUMMY, type TaskInPlay } from './types.ts';

// The one-card task campaigns: every task is "win this colour card", some carry an order token,
// and the missions add their own conditions (a picked crew member's role, the roles of the last
// mission, the crew's conditions). Everything here is mechanics; the mission list is content.

/** The colour cards a deal can hold: Challenge for Three drops green (and the trump 1). */
export const deckFor = (challenge: boolean): CardId[] =>
  challenge ? DECK.filter((c) => suitOf(c) !== 'g' && c !== `${TRUMP}1`) : [...DECK];

export const colourCards = (challenge: boolean) => deckFor(challenge).filter((c) => !isTrump(c));

/** A one-card task: win `card`, maybe with an order token. */
export function cardTask(card: CardId, token: OrderToken | null, omegaLast = false): TaskInPlay {
  const check: Check = {
    kind: 'win-cards',
    cards: [card],
    ...(omegaLast && token === 'o' && { last: true }),
  };
  return {
    key: `card:${card}`,
    check,
    text: `{c:${card}}`,
    difficulty: 0,
    owner: null,
    crew: false,
    prediction: null,
    state: 'open',
    progress: null,
    why: null,
    at: null,
    fedBy: [],
    token,
  };
}

/** Draws `n` one-card tasks with the mission's tokens in order (the test rig names the cards). */
export function drawCardTasks(
  n: number,
  tokens: readonly OrderToken[],
  challenge: boolean,
  omegaLast: boolean,
  rng: Rng,
  fixed?: readonly CardId[],
): TaskInPlay[] {
  const cards = fixed ? [...fixed] : rng.shuffle(colourCards(challenge)).slice(0, n);
  return cards.map((c, i) => cardTask(c, tokens[i] ?? null, omegaLast));
}

/** A condition task held by a seat (not drafted). */
export function heldTask(
  key: string,
  check: Check,
  text: string,
  owner: string | null,
): TaskInPlay {
  return {
    key,
    check,
    text,
    difficulty: 0,
    owner,
    crew: true,
    prediction: null,
    state: 'open',
    progress: null,
    why: null,
    at: null,
    fedBy: [],
    token: null,
  };
}

const NO_TRUMP_WIN: Check = { kind: 'never-wins', match: { suits: [TRUMP] } };

/** What a picked crew member must do (the mute member just can't signal: no task). */
export function pickTask(role: PickRole, seat: string): TaskInPlay | null {
  switch (role) {
    case 'sick':
      return heldTask('pick:sick', { kind: 'trick-count', n: 0 }, 'Win no tricks (sick)', seat);
    case 'one-trick':
      return heldTask(
        'pick:one-trick',
        { kind: 'all', checks: [{ kind: 'trick-count', n: 1 }, NO_TRUMP_WIN] },
        'Win exactly one trick, not with a {trump}',
        seat,
      );
    case 'first-last':
      return heldTask(
        'pick:first-last',
        { kind: 'all', checks: [{ kind: 'tricks', win: [1, 'last'], only: true }, NO_TRUMP_WIN] },
        'Win only the first and the last trick, neither with a {trump}',
        seat,
      );
    case 'mute':
      return null;
  }
}

/**
 * The roles of a roles mission, in the order of its question's replies: 0 wins only the first four
 * tricks, 1 (the rest) wins every trick in between, 2 wins only the last trick.
 */
export function roleTasks(roles: Record<string, number>, names: readonly string[]): TaskInPlay[] {
  const of = (r: number) => Object.keys(roles).filter((s) => roles[s] === r);
  return [
    heldTask(
      'role:0',
      { kind: 'tricks', win: [1, 2, 3, 4], only: true },
      names[0] ?? 'Win only the first four tricks',
      of(0)[0] ?? null,
    ),
    heldTask(
      'role:1',
      { kind: 'span', from: 5, toFromEnd: 1, seats: of(1) },
      names[1] ?? 'Win every trick in between',
      null,
    ),
    heldTask(
      'role:2',
      { kind: 'tricks', win: ['last'], only: true },
      names[2] ?? 'Win only the last trick',
      of(2)[0] ?? null,
    ),
  ];
}

/** Whether the roles are claimed as the mission needs: one first, one last, the rest between. */
export function rolesComplete(roles: Record<string, number>, crew: readonly string[]): boolean {
  const counts = [0, 0, 0];
  for (const s of crew) {
    const r = roles[s];
    if (r === undefined) return false;
    counts[r]!++;
  }
  return counts[0] === 1 && counts[2] === 1 && counts[1]! >= 1;
}

// ---- Order tokens ----

const LABEL: Record<OrderToken, string> = {
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '>': '›',
  '>>': '››',
  '>>>': '›››',
  '>>>>': '››››',
  o: 'Ω',
};
export const tokenLabel = (t: OrderToken) => LABEL[t];
const arrows = (t: OrderToken | null) => (t && t.startsWith('>') ? t.length : 0);
const number = (t: OrderToken | null) => (t && /^[1-5]$/.test(t) ? Number(t) : 0);

/**
 * The first broken order token, or null. Tasks met in the same trick count together, in whichever
 * order the tokens need (consecutive tokens in one trick are fine); Ω must be the last task met.
 */
export function orderFailure(tasks: readonly TaskInPlay[]): { i: number; why: string } | null {
  const own = tasks.map((t, i) => ({ t, i })).filter((x) => !x.t.crew);
  const done = own.filter((x) => x.t.state === 'done');
  const tricks = [...new Set(done.map((x) => x.t.at ?? 0))].sort((a, b) => a - b);
  const name = (x: { t: TaskInPlay }) => `${x.t.text} (${tokenLabel(x.t.token!)})`;
  let pos = 0;
  for (const at of tricks) {
    const group = done.filter((x) => (x.t.at ?? 0) === at);
    const start = pos + 1;
    const end = pos + group.length;
    for (const x of group) {
      const k = number(x.t.token);
      if (k && k > end)
        return {
          i: x.i,
          why: `${name(x)} was met too early: it had to be task ${k}, not ${start}.`,
        };
    }
    for (let k = start; k <= end; k++) {
      const owed = own.find((x) => number(x.t.token) === k);
      if (owed && !group.includes(owed))
        return { i: owed.i, why: `${name(owed)} had to be task ${k}, but other tasks came first.` };
    }
    for (const x of group) {
      const r = arrows(x.t.token);
      if (!r) continue;
      const before = own.find(
        (y) => arrows(y.t.token) > 0 && arrows(y.t.token) < r && y.t.state !== 'done',
      );
      if (before) return { i: before.i, why: `${name(x)} was met before ${name(before)}.` };
    }
    const omega = group.find((x) => x.t.token === 'o');
    if (omega) {
      const later = own.find((y) => y.t.state !== 'done' && !group.includes(y));
      if (later)
        return {
          i: omega.i,
          why: `${name(omega)} had to be the last task, but ${later.t.text} was still to come.`,
        };
    }
    pos = end;
  }
  return null;
}

/**
 * One task in each of consecutive tricks: the first break, or null. Two tasks in one trick, or a
 * trick that goes by without one once the run has begun, fail it.
 */
export function rowFailure(
  tasks: readonly TaskInPlay[],
  played: number,
): { i: number; why: string } | null {
  const own = tasks.map((t, i) => ({ t, i })).filter((x) => !x.t.crew);
  const done = own
    .filter((x) => x.t.state === 'done')
    .sort((a, b) => (a.t.at ?? 0) - (b.t.at ?? 0));
  for (let k = 1; k < done.length; k++) {
    if (done[k]!.t.at === done[k - 1]!.t.at)
      return {
        i: done[k]!.i,
        why: `Two tasks were met in trick ${done[k]!.t.at}: one per trick was needed.`,
      };
  }
  const open = own.find((x) => x.t.state !== 'done');
  if (!done.length || !open) return null;
  const last = done.at(-1)!.t.at ?? 0;
  if (played > last)
    return { i: open.i, why: `Trick ${last + 1} went by without a task, before all were met.` };
  return null;
}

// ---- The draw after the first trick ----

/**
 * Everyone draws a random card from the player on their right (all at once). A card drawn from
 * the dummy is one of its face-up cards; the card the dummy draws becomes an extra face-up card.
 * A signalled card that changes hands loses its signal.
 */
export function drawFromRight(a: Attempt, rng: Rng): Attempt {
  const crew = a.crew;
  const right = (s: string) => crew[(crew.indexOf(s) - 1 + crew.length) % crew.length]!;
  const takeFrom = (s: string) => {
    const options =
      s === DUMMY && a.dummy ? a.dummy.up.filter((c): c is CardId => c !== null) : a.hands[s]!;
    return options.length ? options[rng.int(options.length)]! : null;
  };
  const picks = crew.map((s) => ({ to: s, from: right(s), card: takeFrom(right(s)) }));
  const hands = structuredClone(a.hands);
  let dummy = a.dummy && { up: [...a.dummy.up], down: [...a.dummy.down] };
  for (const p of picks) {
    if (!p.card) continue;
    hands[p.from] = hands[p.from]!.filter((c) => c !== p.card);
    if (p.from === DUMMY && dummy) {
      const i = dummy.up.indexOf(p.card);
      // The card under it turns up, as when a card on it is played.
      dummy.up[i] = dummy.down[i] ?? null;
      dummy.down[i] = null;
    }
  }
  const drawn: Record<string, CardId> = {};
  for (const p of picks) {
    if (!p.card) continue;
    hands[p.to]!.push(p.card);
    drawn[p.to] = p.card;
    if (p.to === DUMMY && dummy) dummy = { up: [...dummy.up, p.card], down: [...dummy.down, null] };
  }
  const moved = new Set(picks.map((p) => p.card));
  return {
    ...a,
    hands,
    dummy,
    signals: a.signals.filter((s) => s.played || !moved.has(s.card)),
    extras: {
      ...a.extras,
      drawn,
      notes: [...a.extras.notes, 'Everyone drew a random card from the player on their right.'],
    },
  };
}
