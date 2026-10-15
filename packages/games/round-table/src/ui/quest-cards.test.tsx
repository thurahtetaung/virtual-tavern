import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { propose, rigged, voteAll } from '../logic/test-utils.ts';
import { QuestPanel } from './Actions.tsx';

describe('the quest card buttons', () => {
  const h = rigged(['merlin', 'servant', 'assassin', 'minion', 'percival']);
  // ana is a Loyal Servant, ben the Assassin.
  propose(h, ['ana', 'ben']);
  voteAll(h);
  const panel = (id: string) =>
    renderToStaticMarkup(<QuestPanel view={h.view(id)} act={() => Promise.resolve(true)} />);

  it('look the same for Good and Evil, apart from Good’s disabled Fail', () => {
    const good = panel('ana');
    const evil = panel('ben');
    expect(good).toContain('aria-disabled="true"');
    expect(evil).not.toContain('aria-disabled');
    expect(good.replace(' aria-disabled="true"', '')).toBe(evil);
    expect(good).toMatch(/aria-disabled="true"[^>]*>✕ Fail/);
    expect(good).not.toContain('Loyal');
  });
});
