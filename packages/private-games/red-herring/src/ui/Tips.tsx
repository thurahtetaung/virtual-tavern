import { storageKey } from '@vt/game-sdk';
import { Button } from '@vt/ui';
import { useState } from 'react';

const TIPS_KEY = 'red-herring.tips.v1';

/** First-time tips, until dismissed (per seat in a playtest). Every role sees the same ones. */
export function Tips() {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
    } catch {
      return true;
    }
  });
  if (seen) return null;
  return (
    <aside
      className="flex flex-col gap-1 rounded-2xl bg-info-soft px-3 py-2 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30"
      data-testid="rh-tips"
    >
      <p className="font-semibold">New here? Three things to know</p>
      <ul className="list-disc space-y-0.5 pl-5">
        <li>Hold your notebook to read the word. A blank page: you’re the Conspirator.</li>
        <li>Tap any card on the table to see it full screen.</li>
        <li>Tap the dot by a name to keep a private 🤔 / 👍 mark. Only you see it.</li>
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="self-end"
        onClick={() => {
          try {
            localStorage.setItem(storageKey(TIPS_KEY), '1');
          } catch {
            // Storage blocked: the tips just close for now.
          }
          setSeen(true);
        }}
      >
        Got it
      </Button>
    </aside>
  );
}
