import { type GameGuide, type GuideContext } from '@vt/game-sdk';
import { guide as hydra } from '@vt/private-hydra/guide';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuideView } from './GuideView.tsx';

const render = (guide: GameGuide, context: GuideContext) =>
  renderToStaticMarkup(<GuideView guide={guide} compact inRoom context={context} />);

describe('the rules drawer with a secret role', () => {
  const ctx: GuideContext = {
    summary: '7 players',
    you: { name: 'Zebra role', text: 'You know the Yak team.', now: 'You wake at step 4' },
    stepNotes: { 0: 'You were dealt the Zebra role.' },
    lists: { x: { title: 'Wake order', items: [{ label: 'Zebra', you: true }] } },
    secret: true,
  };

  it('shows the public room but nothing of the role until the viewer peeks', () => {
    const html = render(hydra, ctx);
    expect(html).toContain('In your room: 7 players');
    expect(html).toContain('Hold to see my role');
    expect(html).toContain('Show my role');
    expect(html).not.toMatch(/Zebra|Yak|You were dealt|step 4/);
  });

  it('shows a public card (a hero everyone sees) as it is', () => {
    const html = render(hydra, { ...ctx, secret: false });
    expect(html).toContain('Zebra role');
    expect(html).not.toContain('Hold to see my role');
  });
});
