import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { inquest } from '../logic/game.ts';
import { HOST, IDS, startedGame, toDiscussion } from '../logic/test-utils.ts';
import type { InquestView } from '../logic/types.ts';
import { contentFor } from './assets.ts';
import { AllSuspects, Suspects } from './Suspects.tsx';

const content = contentFor(null);
const VIEWERS = IDS.slice(0, 6);

function table() {
  const h = startedGame(6, { murderer: 'ana', accomplice: 'ben', witness: 'cy' });
  toDiscussion(h);
  return h;
}

const html = (view: InquestView, showCrime: boolean) =>
  ['phone', 'desktop']
    .map((kind) => {
      const Grid = kind === 'phone' ? Suspects : AllSuspects;
      return renderToStaticMarkup(
        <Grid
          view={view}
          content={content}
          marks={{}}
          setMark={() => {}}
          onOpen={() => {}}
          showCrime={showCrime}
        />,
      );
    })
    .join('\n');

/** The same view with the crime taken out: what the suspects look like to someone who doesn't know. */
const blind = (view: InquestView): InquestView => ({
  ...view,
  game: { ...view.game!, solution: null },
});

describe('the suspects keep the crime off the cards until you peek', () => {
  it('render the same for every viewer while covered as without knowing the crime', () => {
    const h = table();
    for (const viewer of VIEWERS) {
      const view = inquest.view(h.state, viewer);
      if (viewer === HOST) continue; // The Forensic Scientist is a public role: always marked.
      const page = html(view, false);
      expect(page, viewer).toBe(html(blind(view), false));
      expect(page, viewer).not.toMatch(/>KEY<|>MEANS</);
    }
  });

  it('mark the KEY and MEANS cards for the Murderer and the Accomplice once they peek', () => {
    const h = table();
    for (const viewer of ['ana', 'ben']) {
      const page = html(inquest.view(h.state, viewer), true);
      expect(page, viewer).toContain('>KEY<');
      expect(page, viewer).toContain('>MEANS<');
    }
    // Nobody else knows the crime, so peeking marks nothing for them.
    for (const viewer of ['cy', 'dee', 'eve'].filter((v) => VIEWERS.includes(v)))
      expect(html(inquest.view(h.state, viewer), true), viewer).not.toMatch(/>KEY<|>MEANS</);
  });

  it('always mark them for the Forensic Scientist', () => {
    expect(html(inquest.view(table().state, HOST), true)).toContain('>KEY<');
  });
});
