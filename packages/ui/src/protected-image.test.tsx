import type { SyntheticEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_RETRY_MS, ProtectedImage, imageError } from './protected-image.tsx';

const event = {} as SyntheticEvent<HTMLImageElement>;

describe('ProtectedImage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a first failed load once, after a pause, without telling the caller', () => {
    const retry = vi.fn();
    const onError = vi.fn();
    imageError(0, retry, onError)(event);
    vi.advanceTimersByTime(IMAGE_RETRY_MS - 1);
    expect(retry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(retry).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('gives up on the second failure and calls the caller’s onError', () => {
    const retry = vi.fn();
    const onError = vi.fn();
    imageError(1, retry, onError)(event);
    vi.runAllTimers();
    expect(retry).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(event);
  });

  it('keeps the exact URL and the copy deterrents', () => {
    const page = renderToStaticMarkup(
      <ProtectedImage src="/api/backroom/assets/reverie/cards/001.jpg" alt="Card 1" />,
    );
    expect(page).toContain('src="/api/backroom/assets/reverie/cards/001.jpg"');
    expect(page).toContain('draggable="false"');
  });
});
