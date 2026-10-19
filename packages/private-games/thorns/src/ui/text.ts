import { type Names, discName, fillNames } from '../logic/names.ts';
import type { LogEntry, ThornsView } from '../logic/types.ts';

export type NameOf = (id: string | null | undefined) => string;

export interface Status {
  text: string;
  /** The viewer is expected to act now. */
  yourMove: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one line that says what is happening and what the viewer should do. */
export function statusFor(view: ThornsView, you: string, name: NameOf, names: Names): Status {
  const g = view.game;
  const f = (text: string, yourMove = false) => ({ text: fillNames(text, names), yourMove });
  if (!g) return f('');
  if (view.phase === 'over') {
    const w = g.winners;
    if (!w.length) return f('The game is over.');
    if (w.includes(you))
      return f(g.how === 'last' ? 'You win: the last one standing!' : 'You win with two points!');
    return f(
      `${w.map(name).join(' and ')} ${g.how === 'last' ? 'wins as the last one standing' : 'wins with two points'}!`,
    );
  }
  const r = g.round;
  const me = g.players.find((p) => p.id === you);
  const mine = view.mine;
  const inGame = !!me && !me.out;
  const high = r.bids.at(-1);
  switch (r.stage) {
    case 'place':
      if (inGame && mine && mine.stack.length === 0)
        return f('Put your first disc face down: tap one of your discs below.', true);
      return f(
        `Everyone puts a first disc down. Waiting for ${g.players
          .filter((p) => !p.out && p.stack === 0)
          .map((p) => name(p.id))
          .join(', ')}.`,
      );
    case 'turns':
      if (r.current === you)
        return mine?.hand.length
          ? f('Your turn: add a disc to your stack, or open the bidding.', true)
          : f('Your turn: no discs left in hand, so open the bidding.', true);
      return f(`${name(r.current)}’s turn: add a disc or open the bidding.`);
    case 'bid':
      if (r.current === you)
        return f(
          `${name(high?.by)} bid ${high?.amount}. Raise, or pass for the rest of the round.`,
          true,
        );
      return f(`${name(high?.by)} bid ${high?.amount}. ${name(r.current)} to raise or pass.`);
    case 'flip': {
      const bid = high?.amount ?? 0;
      const done = r.flips.length;
      if (r.challenger === you) {
        const own = Math.min(bid, me?.stack ?? 0);
        if ((me?.flipped.length ?? 0) < own)
          return f(`Turn over your own discs first: tap your stack (${done} of ${bid}).`, true);
        return f(`Pick a stack to turn over its top disc (${done} of ${bid}).`, true);
      }
      return f(`${name(r.challenger)} is turning over ${plural(bid, 'disc')}: ${done} so far.`);
    }
    case 'lose':
      if (r.challenger === you)
        return f(
          'You hit your own {thorn}: choose a disc to lose for good. Nobody else will know which.',
          true,
        );
      return f(`${name(r.challenger)} hit their own {thorn} and is choosing a disc to lose.`);
    case 'starter':
      if (r.challenger === you) return f('You’re out. Name who starts the next round.', true);
      return f(`${name(r.challenger)} is out and names who starts the next round.`);
    case 'result': {
      const res = r.result;
      if (!res) return f('');
      const c = res.challenger === you ? 'You' : name(res.challenger);
      if (res.outcome === 'won')
        return f(
          `${c} turned over ${plural(res.bid, 'disc')} without a {thorn} and ${res.challenger === you ? 'score' : 'scores'} a point!`,
        );
      const whose =
        res.thornBy === res.challenger
          ? res.challenger === you
            ? 'your own'
            : 'their own'
          : res.thornBy === you
            ? 'your'
            : `${name(res.thornBy)}’s`;
      const out = res.eliminated ? (res.challenger === you ? ' You’re out.' : ' They’re out.') : '';
      return f(
        `${c} hit ${whose} {thorn} and ${res.challenger === you ? 'lose' : 'loses'} a disc.${out}`,
      );
    }
  }
}

/** A log entry as a line, or null for entries not worth a line. */
export function logLine(e: LogEntry, name: NameOf, names: Names): string | null {
  const t = e.auto === 'timer' ? ' ⏱' : e.auto === 'host' ? ' (host)' : '';
  const line = (s: string) => fillNames(s, names) + t;
  switch (e.kind) {
    case 'round':
      return line(`Round ${e.round}: ${name(e.starter)} starts.`);
    case 'placed':
      return e.auto ? line(`${name(e.by)}’s disc was put down for them.`) : null;
    case 'bid':
      return line(`${name(e.by)} bids ${e.amount}.`);
    case 'pass':
      return line(`${name(e.by)} passes.`);
    case 'challenge':
      return line(`${name(e.by)} must turn over ${plural(e.amount, 'disc')}.`);
    case 'flip':
      return line(
        `${name(e.by)} turns over ${e.owner === e.by ? 'their own' : `${name(e.owner)}’s`} disc: ${e.disc === 'thorn' ? '💀' : e.disc === 'chance' ? '🍀' : '🌹'} ${discName(names, e.disc)}.`,
      );
    case 'won':
      return line(`${name(e.by)} made it: ${e.points === 1 ? 'one point' : 'two points'}.`);
    case 'failed':
      return line(
        `${name(e.by)} hit ${e.thornBy === e.by ? 'their own' : `${name(e.thornBy)}’s`} {thorn}.`,
      );
    case 'lost':
      return line(
        `${name(e.player)} ${e.chance ? `loses the {chance} and their last disc` : `loses a disc${e.chose ? ' of their choice' : ' at random'}`}: ${plural(e.left, 'disc')} left.`,
      );
    case 'out':
      return line(
        e.cause === 'left'
          ? `${name(e.player)} left the game.`
          : e.cause === 'lone'
            ? `${name(e.player)}’s last disc was their {thorn}: they’re out.`
            : `${name(e.player)} is out.`,
      );
    case 'chance':
      return line(`${name(e.player)} gets the {chance} for the next round.`);
    case 'shown':
      return line(`${name(e.player)} shows their stack.`);
    case 'starter':
      return line(`${name(e.by)} names ${name(e.starter)} to start.`);
    case 'void':
      return line(`${name(e.player)} left, so the round starts again.`);
    case 'end':
      return line(
        `${e.winners.map(name).join(' and ')} ${e.how === 'last' ? 'is the last one standing' : 'wins with two points'}.`,
      );
  }
}
