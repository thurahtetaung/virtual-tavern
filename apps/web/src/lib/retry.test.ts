import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JoinWatch, retryOnce } from './retry.ts';

describe('retryOnce', () => {
  it('tries a failed task once more, and only once', async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValue('room');
    expect(await retryOnce(task)).toBe('room');
    const broken = vi.fn().mockRejectedValue(new Error('down'));
    await expect(retryOnce(broken)).rejects.toThrow('down');
    expect(broken).toHaveBeenCalledTimes(2);
  });

  it('leaves alone failures it is told not to retry', async () => {
    const task = vi.fn().mockRejectedValue(new Error('no such room'));
    await expect(retryOnce(task, () => false)).rejects.toThrow('no such room');
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe('JoinWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the join again when the server does not answer it in 8 s', () => {
    const rejoin = vi.fn();
    const watch = new JoinWatch(rejoin);
    watch.sent();
    vi.advanceTimersByTime(7_999);
    expect(rejoin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(rejoin).toHaveBeenCalledTimes(1);
  });

  it('rejoins when an accepted join brings no room within 10 s', () => {
    const rejoin = vi.fn();
    const watch = new JoinWatch(rejoin);
    watch.sent();
    vi.advanceTimersByTime(5_000);
    watch.accepted();
    vi.advanceTimersByTime(9_999);
    expect(rejoin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(rejoin).toHaveBeenCalledTimes(1);
  });

  it('stands down once the room arrives', () => {
    const rejoin = vi.fn();
    const watch = new JoinWatch(rejoin);
    watch.sent();
    watch.accepted();
    watch.stop();
    vi.advanceTimersByTime(60_000);
    expect(rejoin).not.toHaveBeenCalled();
  });
});
