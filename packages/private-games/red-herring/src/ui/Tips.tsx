import { storageKey } from '@vt/game-sdk';
import { Button, Fold, usePhone } from '@vt/ui';
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
  const phone = usePhone();
  if (seen) return null;
  const tips = (
    <ul className="list-disc space-y-0.5 pl-5">
      <li>
        Your notebook, under the round line, shows your role: the word if you’re a Detective, or
        that you’re the Conspirator.
      </li>
      <li>Tap any card on the table to see it full screen.</li>
      <li>At the vote, tap a player’s place on the table to accuse them.</li>
      <li>Tap the dot by a name to keep a private 🤔 / 👍 mark. Only you see it.</li>
    </ul>
  );
  const gotIt = (
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
  );
  // Phones keep the play screen to one screen: the tips wait in a closed fold.
  if (phone) {
    return (
      <Fold
        summary="New here? Three things to know"
        testId="rh-tips"
        bodyClassName="flex flex-col gap-1 text-sm"
      >
        {tips}
        {gotIt}
      </Fold>
    );
  }
  return (
    <aside
      className="flex flex-col gap-1 rounded-2xl bg-info-soft px-3 py-2 text-sm text-info-ink ring-1 ring-info-line"
      data-testid="rh-tips"
    >
      <p className="font-semibold">New here? Three things to know</p>
      {tips}
      {gotIt}
    </aside>
  );
}
