import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EndTabs } from './end-tabs.tsx';

// Rendered on the server, the screen counts as a phone: the strip and one part.
const html = (tabs: Parameters<typeof EndTabs>[0]['tabs']) =>
  renderToStaticMarkup(<EndTabs tabs={tabs} />);

describe('EndTabs', () => {
  it('shows a tab strip and only the first part on a phone', () => {
    const page = html([
      { id: 'scores', label: '🏆 Scores', content: <p>SCORES</p> },
      { id: 'awards', label: '✨ Awards', content: <p>AWARDS</p> },
    ]);
    expect(page).toContain('role="tablist"');
    expect(page).toMatch(/aria-selected="true"[^>]*>🏆 Scores</);
    expect(page).toMatch(/aria-selected="false"[^>]*>✨ Awards</);
    expect(page).toContain('SCORES');
    expect(page).not.toContain('AWARDS');
    expect(page).toContain('role="tabpanel"');
  });

  it('leaves out parts with nothing to show, and needs no strip for one part', () => {
    const page = html([
      { id: 'scores', label: '🏆 Scores', content: <p>SCORES</p> },
      false,
      null,
      undefined,
    ]);
    expect(page).toBe('<p>SCORES</p>');
  });

  it('uses smaller labels when four or more parts share the strip', () => {
    const four = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id, content: id }));
    expect(html(four)).toContain('text-xs');
    expect(html(four.slice(0, 3))).not.toContain('text-xs');
  });
});
