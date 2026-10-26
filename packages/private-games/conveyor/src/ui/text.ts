import { TYPES, typeOf } from '../logic/cards.ts';
import type { Names } from '../logic/manifest.ts';
import type { ConveyorView, GameView, LogEntry, Part } from '../logic/types.ts';

export type NameOf = (id: string | null | undefined) => string;

export interface Status {
  text: string;
  yourMove: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Ana’s" / "your". */
export const poss = (name: string, start = false) =>
  name === 'You' ? (start ? 'Your' : 'your') : `${name}’s`;

/** "you" mid-sentence for the viewer, else the name. */
export const obj = (name: string) => (name === 'You' ? 'you' : name);

/** "Ana is" / "You are"; a list of several names "are". */
const is = (names: string[]) => (names.length > 1 || names[0] === 'You' ? 'are' : 'is');

/** "Ana wins" / "You win". */
const wins = (names: string[]) => (names.length > 1 || names[0] === 'You' ? 'win' : 'wins');

/** "a tempura" / "an egg nigiri". */
export const a = (word: string) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

/** The one line that says what is happening and what the viewer should do. */
export function statusFor(view: ConveyorView, you: string, name: NameOf, n: Names): Status {
  const g = view.game;
  const f = (text: string, yourMove = false) => ({ text, yourMove });
  if (!g) return f('');
  const me = g.players.find((p) => p.id === you);
  if (view.phase === 'over') {
    const w = g.winners;
    const score = (id: string) => g.players.find((p) => p.id === id)?.score ?? 0;
    if (w.length > 1)
      return f(
        `${w.map((id) => name(id)).join(' and ')} share the win with ${plural(score(w[0]!), 'point')}!`,
      );
    const who = w[0]!;
    return who === you
      ? f(`You win with ${plural(score(you), 'point')}!`)
      : f(`${name(who)} wins with ${plural(score(who), 'point')}!`);
  }
  const round = `Round ${g.round} of ${g.rounds}`;
  if (g.stage === 'scores')
    return me && !me.done
      ? f(`${round} is scored. Tap Ready when you’ve seen it.`, true)
      : f(`${round} is scored. The next round starts when everyone is ready.`);
  if (g.stage === 'pick') {
    const turn = `${round}, turn ${g.turn} of ${g.turns}`;
    if (me && !me.done) return f(`${turn}: pick a card to keep, then lock it in.`, true);
    if (me) return f(`${turn}: locked in. You can change it until everyone has picked.`);
    return f(`${turn}: everyone is picking.`);
  }
  const step = g.step;
  if (!step) return f('Resolving…');
  switch (step.kind) {
    case 'chop':
      return step.players.includes(you) && !step.done.includes(you)
        ? f(`Your ${n.type('chopsticks')}: pick a second card from your hand.`, true)
        : f(
            `${step.players.map(name).join(' and ')} ${is(step.players.map(name))} using ${n.type('chopsticks')}.`,
          );
    case 'spoon':
      return step.by === you
        ? f(
            `Your ${n.type('spoon')}: ask for a dish. The first player to your left holding one gives it to you.`,
            true,
          )
        : f(`${name(step.by)} is using a ${n.type('spoon')}.`);
    case 'give':
      return step.from === you
        ? f(
            `${poss(name(step.by), true)} ${n.type('spoon')} asks you for a card: choose which to give.`,
            true,
          )
        : f(`${name(step.from)} is choosing which card to give ${obj(name(step.by))}.`);
    case 'menu':
      return step.by === you
        ? f(`Your ${n.type('menu')}: play one of the four cards drawn.`, true)
        : f(`${name(step.by)} is ordering from the ${n.type('menu')}.`);
    case 'copy':
      return step.by === you
        ? f(`Your ${n.type('order')}: choose which of your cards it copies.`, true)
        : f(`${name(step.by)} is choosing what a ${n.type('order')} copies.`);
    case 'takeout':
      return step.by === you
        ? f(
            `Your ${n.type('takeout')}: turn any earlier cards face down (2 points each), or none.`,
            true,
          )
        : f(`${name(step.by)} is filling a ${n.type('takeout')}.`);
  }
}

const autoMark = (e: LogEntry) =>
  e.auto === 'timer' ? ' ⏱' : e.auto === 'host' ? ' (host)' : e.auto === 'left' ? ' (away)' : '';

/** A log entry as a line, or null for entries not worth a line. */
export function logLine(e: LogEntry, name: NameOf, n: Names): string | null {
  const c = (k: string) => n.card(k);
  const line = (s: string) => s + autoMark(e);
  switch (e.kind) {
    case 'round':
      return `Round ${e.round} is dealt.`;
    case 'reveal':
      return `Turn ${e.turn}: ${e.plays
        .map(
          (p) =>
            `${name(p.by)} ${p.copy ? `${c('order')} (as ${c(p.copy)})` : c(p.k)}${p.bonus ? ` + ${n.type(typeOf(p.bonus))}` : ''}${p.auto ? (p.auto === 'timer' ? ' ⏱' : p.auto === 'host' ? ' (host)' : ' (away)') : ''}`,
        )
        .join(', ')}.`;
    case 'wasabi':
      return `${poss(name(e.by), true)} ${c(e.k)} lands on ${n.type('wasabi')}: triple!`;
    case 'steal':
      return `${name(e.by)} took ${a(c(e.k))} ${obj(name(e.from))} needed (+${e.worth} for ${name(e.from) === 'You' ? 'you' : 'them'}).`;
    case 'chop':
      return line(`${name(e.by)} used ${n.type('chopsticks')} for ${a(c(e.k))}.`);
    case 'spoon':
      return line(
        e.from && e.k
          ? `${poss(name(e.by), true)} ${n.type('spoon')} took ${a(c(e.k))} from ${name(e.from)}.`
          : `${poss(name(e.by), true)} ${n.type('spoon')} found nobody holding it.`,
      );
    case 'menu':
      return line(
        e.k
          ? `${name(e.by)} ordered ${a(c(e.k))} from the ${n.type('menu')}.`
          : `${poss(name(e.by), true)} ${n.type('menu')} had nothing to play.`,
      );
    case 'copy':
      return line(
        e.k
          ? `${poss(name(e.by), true)} ${n.type('order')} copies ${a(c(e.k))}.`
          : `${poss(name(e.by), true)} ${n.type('order')} had nothing to copy.`,
      );
    case 'takeout':
      return line(
        e.ks.length
          ? `${name(e.by)} turned ${plural(e.ks.length, 'card')} face down (${e.ks.map(c).join(', ')}).`
          : `${poss(name(e.by), true)} ${n.type('takeout')} stayed empty.`,
      );
    case 'uramaki':
      return e.claims
        .map((x) => `${name(x.by)} reached ${x.icons} ${n.type('uramaki')} icons: +${x.points}.`)
        .join(' ');
    case 'miso':
      return `${n.type('miso')} clash! ${[...new Set(e.by)].map(name).join(' and ')} played one at once: all discarded.`;
    case 'end':
      return `Round ${e.round} scored.`;
    case 'left':
      return `${name(e.player)} left: the table picks for them.`;
    case 'back':
      return `${name(e.player)} ${is([name(e.player)])} back.`;
    case 'over':
      return `${e.winners.map(name).join(' and ')} ${e.winners.length > 1 ? 'share the win' : wins(e.winners.map(name))}.`;
  }
}

/** A score part in plain words: "Tempura 5 (1 pair)". */
export function partLine(p: Part, n: Names): string {
  const what =
    p.key === 'flipped'
      ? 'Face-down cards'
      : p.key === 'uramaki'
        ? n.type('uramaki')
        : n.type(p.key);
  return `${what}${p.note ? ` (${p.note})` : ''}`;
}

/** Live: the round points each tray would score now. */
export type LivePoints = Record<string, number>;

/** The card types a tray holds, in menu order, with their cards. */
export function groups<T extends { k: string }>(
  cards: readonly T[],
  order: readonly string[],
): [string, T[]][] {
  const by = new Map<string, T[]>();
  for (const c of cards) {
    const t = typeOf(c.k);
    by.set(t, [...(by.get(t) ?? []), c]);
  }
  return [...by.entries()].sort(([x], [y]) => order.indexOf(x) - order.indexOf(y));
}

export const dessertType = (g: GameView) => g.menu.find((t) => TYPES[t].group === 'desserts')!;
