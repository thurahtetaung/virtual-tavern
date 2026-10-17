import type { GameUiProps } from '@vt/game-sdk';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { type GameComponent, lazyUi } from './lazy-ui.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const props = {} as GameUiProps<any, any>;

describe('lazyUi', () => {
  it('loads the code once, however often it is preloaded or rendered', async () => {
    const load = vi.fn(() => Promise.resolve({ default: (() => 'game') as GameComponent }));
    const Ui = lazyUi(load);
    expect(load).not.toHaveBeenCalled();
    await Promise.all([Ui.preload(), Ui.preload()]);
    renderToString(createElement(Ui, props));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('renders preloaded code at once, without suspending', async () => {
    const Ui = lazyUi(() => Promise.resolve({ default: (() => 'the table') as GameComponent }));
    await Ui.preload();
    expect(renderToString(createElement(Ui, props))).toBe('the table');
  });

  it('suspends until code that was not preloaded arrives', () => {
    const Ui = lazyUi(() => new Promise(() => {}));
    expect(() => renderToString(createElement(Ui, props))).toThrow();
  });
});
