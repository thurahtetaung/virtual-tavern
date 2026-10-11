import { describe, expect, it } from 'vitest';
import { royalPost } from '../logic/game.ts';
import { HOST, rig, startedGame } from '../logic/test-utils.ts';
import { roleLabel } from './assets.ts';
import { describeLog, describeNote, plainText, unseenCounts } from './text.ts';

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
    expect(plainText(describeLog(view, out), roleLabel)).toBe('ANA is out, holding King.');
  });

  it('names both cards of a private comparison', () => {
    const h = startedGame();
    rig(h, { hands: { [HOST]: ['baron', 'princess'], ana: ['guard'], ben: ['priest'] } });
    h.act({ type: 'play', card: 'baron', target: 'ana' });
    const view = royalPost.view(h.state, HOST);
    expect(plainText(describeNote(view, view.notes.at(-1)!), roleLabel)).toBe(
      'You compared hands with ANA: your Princess against their Guard. You win.',
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
