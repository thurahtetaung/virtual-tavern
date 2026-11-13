import { storageKey } from '@vt/game-sdk';
import { Button, Icon, Modal } from '@vt/ui';
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

/** The steps in a sheet, with the full rules and Skip at the foot (phones' header button and the
 * desktop banner both open it). */
function IntroSheet({
  game,
  open,
  onDismiss,
  onRules,
  onClose,
}: {
  game: ClientGame;
  open: boolean;
  /** Close the sheet only (the intro stays). */
  onDismiss: () => void;
  onRules: () => void;
  /** Put the intro away for good. */
  onClose: () => void;
}) {
  const guide = useGameGuide(game);
  const close = () => {
    onDismiss();
    onClose();
  };
  return (
    <Modal open={open} onClose={onDismiss} title={`${game.name} in 30 seconds`}>
      {open && (
        <>
          <Stepper guide={guide} compact onFinish={close} />
          <div className="mt-3 flex items-center justify-between gap-2">
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
            {skipButton(close)}
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * The 30-second "how a game goes" intro, shown once in the lobby to players new to the game (a
 * first-time tip like the games' own). On wider screens it is one line above the game's lobby,
 * opening the steps in a sheet, so the lobby's own controls (teams, Join, Start) stay in view on a
 * first visit. Skip or finish it and it stays away. Phones get it as `IntroButton` in the room's
 * header instead, so it takes no room in the lobby.
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
  const [sheet, setSheet] = useState(false);
  return (
    <section
      aria-label={`New to ${game.name}?`}
      className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-accent-soft px-4 py-2 ring-1 ring-accent-line"
    >
      <p className="min-w-0 flex-1 font-bold text-ink">
        <span aria-hidden>👋 </span>New to {game.name}? Here’s the game in 30 seconds.
      </p>
      <Button size="sm" className="min-h-11 shrink-0" onClick={() => setSheet(true)}>
        Show me
      </Button>
      {skipButton(onClose)}
      <IntroSheet
        game={game}
        open={sheet}
        onDismiss={() => setSheet(false)}
        onRules={onRules}
        onClose={onClose}
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
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <Button
        size="sm"
        className={className}
        aria-label="New here? The game in 30 seconds"
        onClick={() => setSheet(true)}
      >
        <Icon name="info" size={24} />
        <span className={labelClassName}>New?</span>
      </Button>
      <IntroSheet
        game={game}
        open={sheet}
        onDismiss={() => setSheet(false)}
        onRules={onRules}
        onClose={onClose}
      />
    </>
  );
}
