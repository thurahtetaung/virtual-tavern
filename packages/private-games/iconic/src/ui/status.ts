import type { IconicView } from '../logic/types.ts';

export type NameOf = (id: string | null | undefined) => string;

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function andList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export interface Status {
  text: string;
  /** The viewer is expected to act now (the tab title shows it). */
  yourMove: boolean;
}

/** The always-visible line: what is happening, and what the viewer should do. */
export function statusFor(view: IconicView, you: string, name: NameOf): Status {
  const g = view.game;
  if (!g) return { text: '', yourMove: false };
  const r = g.round;
  const givers = andList(r.givers.map(name));
  const isGiver = r.givers.includes(you);
  const inGame = g.order.includes(you);
  const secret = r.secret;
  if (view.phase === 'over') {
    const w = g.winners.map((id) => (id === you ? 'You' : name(id)));
    if (!w.length) return { text: 'Game over: no words were guessed.', yourMove: false };
    if (w.length === 1)
      return { text: w[0] === 'You' ? 'You win! 🎉' : `${w[0]} wins! 🎉`, yourMove: false };
    return { text: `${andList(w)} share the win! 🎉`, yourMove: false };
  }
  if (r.stage === 'choose') {
    if (!isGiver)
      return {
        text: `${givers} ${r.givers.length > 1 ? 'are' : 'is'} choosing a secret word…`,
        yourMove: false,
      };
    const partner = name(r.givers.find((id) => id !== you));
    if (r.givers.length === 1)
      return { text: 'Pick a word for the others to guess.', yourMove: true };
    if (secret?.proposal?.by === you)
      return { text: `Waiting for ${partner} to agree or veto your word.`, yourMove: false };
    if (secret?.proposal)
      return { text: `${partner} proposes a word: agree or veto it.`, yourMove: true };
    if (secret?.picker && secret.picker !== you)
      return { text: `You vetoed: ${partner} picks the word now.`, yourMove: false };
    if (secret?.picker === you)
      return { text: 'Your partner vetoed: you pick the word now.', yourMove: true };
    return {
      text: `Pick a word with ${partner}: the first pick is a proposal.`,
      yourMove: true,
    };
  }
  if (r.stage === 'reveal' && r.result) {
    const res = r.result;
    if (res.outcome === 'guessed')
      return {
        text: `${res.guesser === you ? 'You' : name(res.guesser)} guessed it: “${res.word}”!`,
        yourMove: false,
      };
    return { text: `Nobody got it. The word was “${res.word}”.`, yourMove: false };
  }
  // Placing pieces and guessing.
  const word = secret?.answer?.word;
  if (isGiver) {
    if (secret?.award)
      return {
        text: 'Marked right! Undo in the next few seconds if that was a slip.',
        yourMove: false,
      };
    const open = r.guesses.filter((x) => x.mark === null).length;
    return {
      text: `Describe “${word}” with pieces on the board${open ? `, and judge the ${open === 1 ? 'new guess' : `${open} new guesses`}` : ''}.`,
      yourMove: open > 0,
    };
  }
  if (r.helper === you)
    return { text: `You’re helping: add pieces for “${word}”.`, yourMove: false };
  if (!inGame)
    return {
      text: `${givers} ${r.givers.length > 1 ? 'are' : 'is'} giving clues.`,
      yourMove: false,
    };
  if (r.gaveUp.includes(you))
    return {
      text: 'You gave up on this one. You can still guess, or take it back.',
      yourMove: false,
    };
  return { text: `Read ${givers}’s clues and type your guesses.`, yourMove: false };
}
