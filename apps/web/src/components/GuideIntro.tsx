import { storageKey } from '@vt/game-sdk';
import { Button } from '@vt/ui';
import { useState } from 'react';
import type { ClientGame } from '../games/registry.ts';
import { Stepper, useGameGuide } from './GuideView.tsx';

/** Seen per game, so each game's intro shows once in this browser. */
const key = (gameId: string) => storageKey(`vt.guide.intro.${gameId}`);

function seen(gameId: string): boolean {
  try {
    return localStorage.getItem(key(gameId)) === '1';
  } catch {
    return false;
  }
}

/**
 * The 30-second "how a game goes" stepper, shown once in the lobby to players new to the game
 * (a first-time tip like the games' own). Skip or finish it and it stays away.
 */
export function GuideIntro({ game, onRules }: { game: ClientGame; onRules: () => void }) {
  const guide = useGameGuide(game);
  const [open, setOpen] = useState(() => !seen(game.id));
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(key(game.id), '1');
    } catch {
      // Storage blocked: it'll show again next time.
    }
  };
  return (
    <section aria-label={`New to ${game.name}?`} className="mx-auto mb-4 max-w-xl">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="font-bold">
          <span aria-hidden>👋 </span>New to {game.name}? Here’s the game in 30 seconds.
        </p>
        <Button variant="ghost" size="sm" className="min-h-11 shrink-0" onClick={close}>
          Skip
        </Button>
      </div>
      <Stepper
        guide={guide}
        compact
        onFinish={close}
        done={
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11"
            onClick={() => {
              close();
              onRules();
            }}
          >
            Read the rules
          </Button>
        }
      />
    </section>
  );
}
