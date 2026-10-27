import { storageKey } from '@vt/game-sdk';
import { Button, Modal } from '@vt/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
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

/** Phones get the intro as one line that opens the steps, so the lobby still fits the screen. */
const PHONE = '(max-width: 639px)';

function subscribe(change: () => void) {
  const q = window.matchMedia(PHONE);
  q.addEventListener('change', change);
  return () => {
    q.removeEventListener('change', change);
  };
}

const usePhone = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );

/**
 * The 30-second "how a game goes" stepper, shown once in the lobby to players new to the game
 * (a first-time tip like the games' own). Skip or finish it and it stays away. On phones it is one
 * line whose button opens the steps in a sheet.
 */
export function GuideIntro({
  game,
  onRules,
  onShown,
}: {
  game: ClientGame;
  onRules: () => void;
  /** Whether the intro is on screen (the rules drawer then opens past its Learn tab). */
  onShown?: (shown: boolean) => void;
}) {
  const guide = useGameGuide(game);
  const [open, setOpen] = useState(() => !seen(game.id));
  const phone = usePhone();
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    onShown?.(open);
    return () => {
      onShown?.(false);
    };
  }, [open, onShown]);
  if (!open) return null;
  const close = () => {
    setSheet(false);
    setOpen(false);
    try {
      localStorage.setItem(key(game.id), '1');
    } catch {
      // Storage blocked: it'll show again next time.
    }
  };
  const stepper = (
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
  );
  const skip = (
    <Button variant="ghost" size="sm" className="min-h-11 shrink-0" onClick={close}>
      Skip
    </Button>
  );
  if (phone)
    return (
      <section
        aria-label={`New to ${game.name}?`}
        className="mb-4 flex items-center gap-2 rounded-2xl bg-card py-1 pr-1 pl-3 shadow-sm ring-1 ring-line"
      >
        <p className="min-w-0 flex-1 text-sm leading-tight font-bold">
          <span aria-hidden>👋 </span>New to {game.name}?
        </p>
        <Button size="sm" className="min-h-11 shrink-0" onClick={() => setSheet(true)}>
          The game in 30 s
        </Button>
        {skip}
        <Modal open={sheet} onClose={() => setSheet(false)} title={`${game.name} in 30 seconds`}>
          {sheet && stepper}
        </Modal>
      </section>
    );
  return (
    <section aria-label={`New to ${game.name}?`} className="mx-auto mb-4 max-w-xl">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="font-bold">
          <span aria-hidden>👋 </span>New to {game.name}? Here’s the game in 30 seconds.
        </p>
        {skip}
      </div>
      {stepper}
    </section>
  );
}
