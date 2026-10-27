import { describe, expect, it } from 'vitest';
import { leftAt } from '../logic/bomb.ts';
import { endCues, musicSection, stingerDue } from './music.ts';

/** Plays a bomb's clock through the music rules, a frame every 100 ms, like the hook's ticks. */
function play(total: number, length: number, strikesAt: number[] = []) {
  const clock = { leftAtAnchor: total, anchorAt: 0, rate: 1, end: null };
  const sections: { t: number; left: number; index: number; now: boolean }[] = [];
  let stinger: { left: number; rate: number } | null = null;
  for (let t = 0; leftAt(clock, t) > 0; t += 100) {
    if (strikesAt.includes(t)) {
      clock.leftAtAnchor = leftAt(clock, t);
      clock.anchorAt = t;
      clock.rate += 0.25;
    }
    const left = leftAt(clock, t);
    const s = musicSection(left, total, length);
    if (sections.at(-1)?.index !== s.index) sections.push({ t, left, ...s });
    if (!stinger && stingerDue(left, clock.rate)) stinger = { left, rate: clock.rate };
  }
  return { sections, stinger };
}

describe('the bomb music', () => {
  it('queues each section in turn over a whole bomb and cuts to the last for the final 30 s', () => {
    const { sections } = play(300_000, 8);
    // The playlist opens on its first clip; the second is queued at once (as the original does).
    expect(sections[0]).toMatchObject({ t: 0, index: 1, now: false });
    expect(sections.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const s of sections.slice(0, -1)) {
      expect(s.now).toBe(false);
      expect(s.left).toBeGreaterThanOrEqual(30_000);
    }
    // Section i (1…6) is asked for once the fraction left falls to (8 − i) / 7.
    for (const s of sections.slice(1, -1))
      expect(s.left).toBeLessThanOrEqual((300_000 * (8 - s.index)) / 7);
    expect(sections.at(-1)).toMatchObject({ index: 7, now: true });
    expect(sections.at(-1)!.left).toBeLessThan(30_000);
    expect(sections.at(-1)!.left).toBeGreaterThan(29_800);
  });

  it('plays the stinger 7 s of bomb time before the last section, sooner after strikes', () => {
    const calm = play(300_000, 8).stinger!;
    expect(calm.left).toBeLessThan(37_000);
    expect(calm.left).toBeGreaterThan(36_800);
    const struck = play(300_000, 8, [60_000, 120_000]).stinger!;
    expect(struck.rate).toBe(1.5);
    expect(struck.left).toBeLessThan(40_500);
    expect(struck.left).toBeGreaterThan(40_000);
  });

  it('goes straight to the last section and the stinger on a 30-second bomb', () => {
    const { sections, stinger } = play(30_000, 7);
    expect(sections).toEqual([{ t: 0, left: 30_000, index: 1, now: false }, expect.anything()]);
    expect(sections[1]).toMatchObject({ t: 100, index: 6, now: true });
    expect(stinger?.left).toBe(30_000);
  });

  it('keeps short playlists in range', () => {
    expect(musicSection(10_000, 60_000, 1)).toEqual({ index: 0, now: false });
    expect(musicSection(60_000, 60_000, 2)).toEqual({ index: 0, now: false });
    expect(musicSection(20_000, 60_000, 2)).toEqual({ index: 1, now: true });
  });

  it('ends with the bomb’s own sound, then the win or lose music after the fades', () => {
    expect(endCues({ how: 'defused', at: 1000 })).toEqual({
      effects: ['bomb-defused', 'gameover-fanfare'],
      music: 'gameover-win',
      musicAt: 11_000,
    });
    expect(endCues({ how: 'strikes', at: 1000 })).toMatchObject({
      effects: ['explode'],
      music: 'gameover-lose',
      musicAt: 5000,
    });
    expect(endCues({ how: 'time', at: 0 }).musicAt).toBe(4000);
  });
});
