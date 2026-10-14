import { describe, expect, it } from 'vitest';
import { royalPost } from '../logic/game.ts';
import { FOUR, HOST, NOW, rig, startedGame } from '../logic/test-utils.ts';
import { roleLabel } from './assets.ts';
import {
  describeLog,
  describeNote,
  notesByRound,
  plainText,
  roundEndingNotes,
  spyBonusLine,
  tiebreakLine,
  tokensLine,
  unseenCounts,
} from './text.ts';

describe('described lines', () => {
  it('keeps card names apart so they can be tapped', () => {
    const h = startedGame();
    rig(h, { hands: { [HOST]: ['guard', 'priest'], ana: ['king'], ben: ['baron'] } });
    h.act({ type: 'play', card: 'guard', target: 'ana', guess: 'king' });
    const view = royalPost.view(h.state, 'ben');
    const out = view.log.at(-1)!;
    const guard = view.log.at(-2)!;
    const line = describeLog(view, guard);
    expect(line.filter((s) => typeof s !== 'string')).toEqual([
      { card: 'guard' },
      { card: 'king' },
    ]);
    expect(plainText(line, roleLabel)).toBe('HOST played Guard on ANA, naming King: right!');
    expect(plainText(describeLog(view, out), roleLabel)).toBe(
      'ANA is out of the round, holding King (HOST’s Guard named it).',
    );
  });

  it('names both cards of a private comparison', () => {
    const h = startedGame();
    rig(h, { hands: { [HOST]: ['baron', 'princess'], ana: ['guard'], ben: ['priest'] } });
    h.act({ type: 'play', card: 'baron', target: 'ana' });
    const view = royalPost.view(h.state, HOST);
    expect(plainText(describeNote(view, view.notes.at(-1)!), roleLabel)).toBe(
      'You compared hands with ANA: your Princess against their Guard. Yours is higher: ANA is out of the round.',
    );
    const lost = royalPost.view(h.state, 'ana');
    expect(plainText(describeLog(lost, lost.log.at(-1)!), roleLabel)).toBe(
      'You are out of the round, holding Guard (HOST won the Baron comparison).',
    );
  });
});

describe('timed-out and Prince lines', () => {
  it('says when the timer played a card, in the log and in the private note', () => {
    const h = startedGame(undefined, 'classic', { turnSeconds: 30, timerMode: 'strict' });
    rig(h, { hands: { [HOST]: ['king', 'baron'], ana: ['guard'], ben: ['guard'] } });
    h.state = royalPost.onDeadline!(h.state, NOW + 30_000);
    const mine = royalPost.view(h.state, HOST);
    const play = mine.log.find((e) => e.kind === 'play')!;
    expect(plainText(describeLog(mine, play), roleLabel)).toMatch(
      /^⏱ Time ran out, so a card was played for you: you played Baron to compare hands with (ANA|BEN)\.$/,
    );
    expect(plainText(describeNote(mine, mine.notes.at(-1)!), roleLabel)).toMatch(
      /^⏱ Time ran out, so a card was played for you\. You compared hands/,
    );
    const theirs = royalPost.view(h.state, 'ben');
    expect(plainText(describeLog(theirs, play), roleLabel)).toMatch(
      /^⏱ Time ran out, so a card was played for HOST: HOST played Baron/,
    );
  });

  it('names who discarded to a Prince', () => {
    const h = startedGame();
    rig(h, {
      hands: { [HOST]: ['prince', 'priest'], ana: ['guard'], ben: ['baron'] },
      deck: ['king', 'spy', 'handmaid'],
    });
    h.act({ type: 'play', card: 'prince', target: 'ana' });
    const view = royalPost.view(h.state, 'ben');
    expect(plainText(describeLog(view, view.log.at(-1)!), roleLabel)).toBe(
      'HOST played Prince on ANA: ANA discarded Guard and drew a new card.',
    );
    const ana = royalPost.view(h.state, 'ana');
    expect(plainText(describeLog(ana, ana.log.at(-1)!), roleLabel)).toBe(
      'HOST played Prince on you: you discarded Guard and drew a new card.',
    );
  });
});

describe('unseenCounts', () => {
  it('counts out every discard and your own hand', () => {
    const h = startedGame();
    rig(h, {
      hands: { [HOST]: ['guard', 'princess'], ana: ['guard'], ben: ['priest'] },
      discards: { ana: ['guard', 'handmaid'] },
    });
    const counts = unseenCounts(royalPost.view(h.state, HOST));
    const of = (role: string) => counts.find((c) => c.role === role)!;
    expect(of('guard')).toMatchObject({ total: 5, unseen: 3 });
    expect(of('princess')).toMatchObject({ total: 1, unseen: 0 });
    expect(of('handmaid')).toMatchObject({ total: 2, unseen: 1 });
    expect(of('king')).toMatchObject({ total: 1, unseen: 1 });
  });
});

describe('round results', () => {
  it('says why nobody got the Spy bonus', () => {
    const h = startedGame(undefined, '2019');
    rig(h, {
      hands: { [HOST]: ['handmaid', 'priest'], ana: ['king'], ben: ['baron'] },
      discards: { ana: ['spy'], ben: ['spy'] },
      deck: [],
    });
    h.act({ type: 'play', card: 'handmaid' });
    const v = royalPost.view(h.state, 'ben');
    expect(plainText(spyBonusLine(v)!, roleLabel)).toBe(
      'Both ANA and you played a Spy, so nobody gets the bonus.',
    );
    expect(tokensLine(v)).toBe('5 tokens to win: ANA 1, HOST 0, You 0.');
  });

  it('says a Classic tie still tied on discards gives each tied player a token', () => {
    const h = startedGame();
    rig(h, {
      hands: { [HOST]: ['handmaid', 'baron'], ana: ['baron'], ben: ['guard'] },
      discards: { ana: ['priest', 'priest'] },
      deck: [],
    });
    h.act({ type: 'play', card: 'handmaid' });
    expect(tiebreakLine(royalPost.view(h.state, 'ben'))).toBe(
      'Tied cards were settled on discards: HOST 4, ANA 4. Still tied on discards, so each of them wins a token.',
    );
  });

  it('shows a note from the round’s last move in the result, not as a pop-up', () => {
    const h = startedGame();
    rig(h, {
      hands: { [HOST]: ['baron', 'princess'], ana: ['guard'], ben: [] },
      out: ['ben'],
    });
    h.act({ type: 'play', card: 'baron', target: 'ana' });
    expect(h.state.round!.stage).toBe('over');
    const v = royalPost.view(h.state, HOST);
    expect(roundEndingNotes(v).map((n) => n.kind)).toEqual(['compare']);
    expect(roundEndingNotes(royalPost.view(h.state, 'ben'))).toEqual([]);
  });
});

describe('notes', () => {
  it('describes the Chancellor’s bottom cards and a Priest on you', () => {
    const h = startedGame(FOUR, '2019');
    rig(h, {
      hands: { [HOST]: ['chancellor', 'guard'], ana: ['priest'], ben: ['baron'], cy: ['king'] },
      deck: ['princess', 'king', 'spy', 'guard'],
    });
    h.act({ type: 'play', card: 'chancellor' });
    h.act({ type: 'chancellor-keep', keep: 'guard', bottomOrder: ['princess', 'king'] });
    const v = royalPost.view(h.state, HOST);
    expect(plainText(describeNote(v, v.notes.at(-1)!), roleLabel)).toBe(
      'You put Princess, then King (the very bottom), at the bottom of the deck.',
    );
    const of = (role: string) => unseenCounts(v).find((c) => c.role === role)!;
    expect(of('princess')).toMatchObject({ unseen: 1, inDeck: 1 });
    expect(of('countess')).toMatchObject({ inDeck: 0 });
    h.act({ type: 'play', card: 'priest', target: HOST }, 'ana');
    const mine = royalPost.view(h.state, HOST);
    expect(plainText(describeNote(mine, mine.notes.at(-1)!), roleLabel)).toBe(
      'ANA looked at your card with the Priest: they know you hold Guard.',
    );
  });

  it('keeps earlier rounds’ notes apart from this round’s', () => {
    const h = startedGame();
    rig(h, { hands: { [HOST]: ['priest', 'guard'], ana: ['king'], ben: ['baron'] } });
    h.act({ type: 'play', card: 'priest', target: 'ana' });
    const first = royalPost.view(h.state, HOST);
    expect(notesByRound(first).current).toHaveLength(1);
    h.state = { ...h.state, round: { ...h.state.round!, number: 2 } };
    const later = notesByRound(royalPost.view(h.state, HOST));
    expect(later.current).toEqual([]);
    expect(later.earlier).toHaveLength(1);
  });
});
