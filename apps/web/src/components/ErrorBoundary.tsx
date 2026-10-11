import { Button } from '@vt/ui';
import { Component, type ReactNode } from 'react';
import { isChunkLoadError, reloadOnce } from '../lib/chunk-reload.ts';

/** Last line of defence: a friendly message instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    // A new release replaced the code this page was about to load: fetch it once, quietly.
    if (isChunkLoadError(error) && reloadOnce()) return;
    console.error(error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="text-5xl" aria-hidden>
          🫗
        </p>
        <h1 className="text-2xl font-bold">Oops, something spilled.</h1>
        <p className="text-stone-600 dark:text-stone-400">
          Reloading usually fixes it. You will rejoin your room right where you were.
        </p>
        <Button size="lg" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
