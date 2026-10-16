import { PLAYER_COLOR_NAMES, PLAYER_COLORS } from '@vt/game-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayerTag } from './people.tsx';
import { ColorPicker, PLAYER_DOT, PlayerColors, PlayerDot } from './player-colors.tsx';

const tag = (props: Partial<Parameters<typeof PlayerTag>[0]> = {}) =>
  renderToStaticMarkup(
    <PlayerColors.Provider value={new Map([['Leo', 'teal']])}>
      <PlayerTag name="Leo" {...props} />
    </PlayerColors.Provider>,
  );

describe('player colours', () => {
  it('gives every colour a name and its own dot in light and dark', () => {
    expect(PLAYER_COLORS).toHaveLength(16);
    expect(PLAYER_COLORS.slice(0, 2)).toEqual(['red', 'blue']);
    const dots = PLAYER_COLORS.map((c) => PLAYER_DOT[c]);
    expect(new Set(dots).size).toBe(PLAYER_COLORS.length);
    for (const c of PLAYER_COLORS) {
      expect(PLAYER_COLOR_NAMES[c]).toMatch(/^[a-z ]+$/);
      expect(PLAYER_DOT[c]).toMatch(/^bg-\S+ dark:bg-\S+$/);
    }
  });

  it("shows the player's dot before their name and says the colour after it", () => {
    const page = tag({ you: true });
    expect(page).toMatch(
      />Leo<\/span><span data-color="teal" role="img" aria-label="teal"[^>]*order-first/,
    );
    expect(tag({ name: 'Ana' })).not.toContain('data-color');
    expect(tag({ dot: false })).not.toContain('data-color');
  });

  it('hides the dot from screen readers where the colour is said already', () => {
    expect(renderToStaticMarkup(<PlayerDot color="sky" label={false} />)).toContain(
      'aria-hidden="true"',
    );
  });

  it("ticks the viewer's colour and says whose the taken ones are", () => {
    const page = renderToStaticMarkup(
      <ColorPicker value="red" taken={new Map([['blue', 'Ana']])} onPick={() => {}} />,
    );
    expect(page.match(/role="radio"/g)).toHaveLength(16);
    expect(page).toMatch(/aria-checked="true" aria-label="red"/);
    expect(page).toContain('aria-label="blue, taken by Ana"');
    expect(page).toContain('aria-label="sky blue"');
    expect(page).not.toContain('disabled=""');
    expect(
      renderToStaticMarkup(
        <ColorPicker value="red" taken={new Map()} onPick={() => {}} disabled />,
      ).match(/disabled=""/g),
    ).toHaveLength(16);
  });
});
