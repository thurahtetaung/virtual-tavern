import type { Rng } from '@vt/game-sdk';
import type { HintKind, Sender } from './types.ts';

/**
 * Our own plain wording for every hint kind, used when no lines pack is imported (and for any kind
 * a pack leaves out). The informative kinds say exactly what is true; the rest is light chatter.
 */
export const FALLBACK_LINES: Record<HintKind, readonly string[]> = {
  intro: [
    'I sent you what I’d pay for three of the drawings: see your wish list. Every price on it is true.',
  ],
  firstLoan: ['Loan approved. Enjoy the $1,000, and remember you owe us $1,500.'],
  thirdLoan: ['That’s your third loan. We can’t lend you any more.'],
  prankCall: ['You called the bank and then took nothing. We noticed.'],
  topStillOut: ['Psst: the most valuable drawing of the game hasn’t been sold yet.'],
  bankReminder: ['Short on cash? You can call the bank during any lot.'],
  goodBuy: ['Nice buy last lot: that was a real bargain.'],
  revenge: ['{player} screwed you into that last buy. You still have your screw…'],
  brokeEven: ['Last lot: you paid about what it was worth. Fair enough.'],
  badBuy: ['Ouch: you paid well over the odds for that last one.'],
  secondLot: ['Keep your wish list in mind: one of those could be up any moment.'],
  yourArt: ['This one is yours. Nobody else knows… yet.'],
  someoneKnows: ['{player} knows what this one is worth. Watch them!'],
  leader: ['{player} is way out in front right now.'],
  poorPlayer: ['{player} is running low on cash. Remember your screw.'],
  wantArt: ['I need a drawing by {player}! I’ll pay {value} for it!'],
  notBidding: ['You haven’t bid yet. Art doesn’t buy itself!'],
  notBuying: ['You don’t own a single drawing yet. Time to start buying.'],
  rivalry: ['Between you and me, I’d love to see {player} lose this one.'],
  dog: ['Woof!'],
  cameoA: ['Wrong number, sorry.'],
  cameoB: ['Hello? Is this the auction? Never mind.'],
  filler: [
    'Lovely weather for an auction.',
    'Just checking in. Carry on.',
    'I’m only here for the snacks.',
    'Bid with your heart. Or don’t.',
  ],
};

/** Who sends each kind (buyers take turns). */
export function senderOf(kind: HintKind, rng: Rng): Sender {
  if (
    kind === 'firstLoan' ||
    kind === 'thirdLoan' ||
    kind === 'prankCall' ||
    kind === 'bankReminder'
  )
    return 'bank';
  if (kind === 'dog') return 'dog';
  if (kind === 'cameoA' || kind === 'cameoB') return 'caller';
  return (['buyer1', 'buyer2', 'buyer3'] as const)[rng.int(3)]!;
}

const RANDOM_CHARS = 'abcdefghijklmnopqrstuvwxyz!?#&*%$';

export const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US')}`;

/** A line with its placeholders filled. */
export function fillLine(
  line: string,
  vars: { player?: string; value?: number },
  rng: Rng,
): string {
  return line
    .replaceAll('{player}', vars.player ?? 'someone')
    .replaceAll('{value}', vars.value === undefined ? 'a lot' : money(vars.value))
    .replaceAll('{random}', () =>
      Array.from({ length: 6 }, () => RANDOM_CHARS[rng.int(RANDOM_CHARS.length)]).join(''),
    );
}
