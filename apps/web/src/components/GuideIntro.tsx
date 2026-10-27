import { storageKey } from '@vt/game-sdk';
import { Button, Modal } from '@vt/ui';
import { useCallback, useState } from 'react';
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

/** Whether this browser still gets the game's intro, and how to put it away for good. */
export function useGuideIntro(gameId: string) {
  const [open, setOpen] = useState(() => !seen(gameId));
  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(key(gameId), '1');
    } catch {
      // Storage blocked: it'll show again next time.
    }
  }, [gameId]);
  return { open, close };
}

const skipButton = (onClose: () => void) => (
  <Button variant="ghost" size="sm" className="min-h-11 shrink-0" onClick={onClose}>
    Skip
  </Button>
);

/**
 * The 30-second "how a game goes" stepper, shown once in the lobby to players new to the game
 * (a first-time tip like the games' own). Skip or finish it and it stays away. Phones get it as
 * `IntroButton` in the room's header instead, so it takes no room in the lobby.
 */
export function GuideIntro({
  game,
  onRules,
  onClose,
}: {
  game: ClientGame;
  /** Open the rules (the intro is put away first). */
  onRules: () => void;
  onClose: () => void;
}) {
  const guide = useGameGuide(game);
  return (
    <section aria-label={`New to ${game.name}?`} className="mx-auto mb-4 max-w-xl">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="font-bold">
          <span aria-hidden>👋 </span>New to {game.name}? Here’s the game in 30 seconds.
        </p>
        {skipButton(onClose)}
      </div>
      <Stepper
        guide={guide}
        compact
        onFinish={onClose}
        done={
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11"
            onClick={() => {
              onClose();
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

/**
 * The intro on a phone: an accent "New?" button in the Rules button's place in the room's header
 * (a lobby row of its own pushed tall lobbies past the screen). It opens the steps in a sheet with
 * Skip and the full rules; once put away, the header shows Rules again.
 */
export function IntroButton({
  game,
  onRules,
  onClose,
  className,
  labelClassName,
}: {
  game: ClientGame;
  onRules: () => void;
  onClose: () => void;
  className?: string;
  labelClassName?: string;
}) {
  const guide = useGameGuide(game);
  const [sheet, setSheet] = useState(false);
  const close = () => {
    setSheet(false);
    onClose();
  };
  const rules = () => {
    close();
    onRules();
  };
  return (
    <>
      <Button
        size="sm"
        className={className}
        aria-label="New here? The game in 30 seconds"
        onClick={() => setSheet(true)}
      >
        <span aria-hidden>👋</span>
        <span className={labelClassName}>New?</span>
      </Button>
      <Modal open={sheet} onClose={() => setSheet(false)} title={`${game.name} in 30 seconds`}>
        {sheet && (
          <>
            <Stepper guide={guide} compact onFinish={close} />
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button variant="secondary" size="sm" className="min-h-11" onClick={rules}>
                Read the rules
              </Button>
              {skipButton(close)}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
