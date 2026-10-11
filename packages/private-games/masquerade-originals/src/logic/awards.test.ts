import { type InsightEvent, fixtureGame, recapEventOf, renderCopy } from '@vt/game-sdk';
import { masqueradeAwards } from '@vt/game-masquerade/logic';
import { describe, expect, it } from 'vitest';
import { masqueradeOriginals } from './index.ts';

describe('originals awards', () => {
  it('shares the Masquerade award module', () => {
    expect(masqueradeOriginals.awards).toBe(masqueradeAwards);
  });

  it('reports location ids, which the copy turns into placeholders the browser names', () => {
    const insights = masqueradeOriginals.insights!.bind(masqueradeOriginals);
    const before = {
      phase: 'playing',
      round: { stage: 'guess', deal: 1 },
    } as unknown as Parameters<typeof insights>[0];
    const after = {
      ...before,
      round: {
        number: 1,
        deal: 1,
        stage: 'reveal',
        players: ['a', 'b', 'c'],
        starter: 'a',
        result: {
          location: 'e1-07',
          spies: ['a'],
          votes: { b: 'a', c: 'a' },
          named: ['a'],
          spyResults: [{ id: 'a', outcome: 'stole', guess: 'e1-07' }],
          points: { a: 2, b: 0, c: 0 },
        },
      },
    } as unknown as Parameters<typeof insights>[0];
    const events: InsightEvent[] = insights(before, after, null, null);
    expect(events[0]).toMatchObject({ type: 'round', props: { location: 'e1-07' } });
    const g = fixtureGame(
      events.map((e, i) => recapEventOf(e, i + 1)),
      { players: ['a', 'b', 'c'] },
    );
    const thief = masqueradeAwards.rules.find((r) => r.id === 'masquerade.last-second-thief')!;
    const [c] = thief.compute!(g);
    expect(renderCopy(thief.copy.wholesome[1]!, c!)).toBe(
      '{p:a} was caught, then guessed {loc:e1-07}',
    );
    expect(masqueradeAwards.history!(g)).toEqual(['Round 1 · {loc:e1-07}: spy {p:a} stole it']);
  });
});
