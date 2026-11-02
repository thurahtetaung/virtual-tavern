import { describe, expect, it } from 'vitest';
import { redHerring } from '../logic/game.ts';
import {
  FOUR,
  type Harness,
  playAll,
  playFirst,
  round,
  setWord,
  startedGame,
  talkAll,
  voteAll,
} from '../logic/test-utils.ts';
import { type Cue, cueStep } from './cues.ts';

/** Follows one seat's views as a device would, collecting every cue it plays. */
function listener(h: Harness, id: string) {
  let seen: ReadonlySet<string> | null = null;
  const played: Cue[] = [];
  const look = () => {
    const step = cueStep(seen, redHerring.view(h.state, id));
    seen = step.seen;
    played.push(...step.play);
    return step.play;
  };
  return { look, played };
}

describe('the sound cues', () => {
  it('play the new word once a round, when it is written, and the winner once at the end', () => {
    const h = startedGame(FOUR, 5);
    const seats = FOUR.map((id) => listener(h, id));
    const look = () => seats.map((s) => s.look());
    look(); // The page opens: nothing replays.
    const rounds = h.state.game!.rounds;
    for (let n = 1; n <= rounds; n++) {
      expect(look()).toEqual(FOUR.map(() => []));
      playFirst(h); // The word-picker's card.
      expect(look()).toEqual(FOUR.map(() => []));
      h.act({ type: 'word', word: `Word ${n}` }, round(h).picker);
      expect(look()).toEqual(FOUR.map(() => ['newWord']));
      while (round(h).stage === 'play') {
        playFirst(h);
        expect(look()).toEqual(FOUR.map(() => []));
      }
      talkAll(h);
      expect(look()).toEqual(FOUR.map(() => []));
      voteAll(h);
      expect(round(h).stage).toBe('reveal');
      expect(look()).toEqual(FOUR.map(() => []));
      h.act({ type: 'next-round' });
      expect(look()).toEqual(FOUR.map(() => (n === rounds ? ['winner'] : [])));
    }
    expect(h.state.phase).toBe('over');
    for (const s of seats)
      expect(s.played).toEqual([...Array.from({ length: rounds }, () => 'newWord'), 'winner']);
  });

  it('play again in the next game, from its first word to its winner', () => {
    const h = startedGame(FOUR, 5);
    const host = listener(h, FOUR[0]!);
    const playing = () => h.state.phase === 'playing';
    host.look();
    while (playing()) {
      setWord(h);
      playAll(h);
      talkAll(h);
      voteAll(h);
      h.act({ type: 'next-round' });
      host.look();
    }
    expect(host.played.at(-1)).toBe('winner');
    const before = host.played.length;
    h.act({ type: 'play-again' });
    expect(host.look()).toEqual([]);
    while (playing()) {
      setWord(h);
      host.look();
      playAll(h);
      talkAll(h);
      voteAll(h);
      host.look();
      h.act({ type: 'next-round' });
      host.look();
    }
    expect(host.played.slice(before)).toEqual([
      ...Array.from({ length: h.state.game!.rounds }, () => 'newWord'),
      'winner',
    ]);
  });

  it('never replay on a page opened mid-round', () => {
    const h = startedGame(FOUR, 5);
    setWord(h);
    const late = listener(h, FOUR[1]!);
    expect(late.look()).toEqual([]);
    playAll(h);
    expect(late.look()).toEqual([]);
  });
});
