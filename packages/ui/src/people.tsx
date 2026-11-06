import type { SpectatorPrompt } from '@vt/game-sdk';
import { createContext, useContext, useEffect, useRef } from 'react';
import { cn } from './cn.ts';
import { Badge } from './components.tsx';
import { Icon } from './icon.tsx';
import { PlayerDot, usePlayerColor } from './player-colors.tsx';

/** The crown every player list puts after the host's name. */
export function HostCrown() {
  return <Icon name="crown" size={16} label="host" className="text-accent-text" />;
}

/**
 * The names of a playtest's bot seats, from the room shell (names are unique in a room), so
 * every player list marks them with 🤖 without any game knowing about bots.
 */
export const BotNames = createContext<ReadonlySet<string>>(new Set());

/**
 * A player's name as every list shows it: their colour's dot before it, a crown for the host, "(you)",
 * and a muted name and an "offline" tag while their browser is away, so nobody waits on someone who has gone.
 * The dot comes after the name in the markup, so screen readers say "Leo, teal".
 */
export function PlayerTag({
  name,
  host = false,
  you = false,
  offline = false,
  dot = true,
  className,
}: {
  name: string;
  host?: boolean;
  you?: boolean;
  offline?: boolean;
  /** Off where the game shows its own colour for the player (Séance's psychics). */
  dot?: boolean;
  className?: string;
}) {
  const bot = useContext(BotNames).has(name);
  const color = usePlayerColor(name);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 font-medium', className)}>
      <span className={cn('truncate', offline && 'text-ink-muted')}>{name}</span>
      {dot && color && <PlayerDot color={color} className="order-first mr-0.5" />}
      {bot && (
        <span role="img" aria-label="bot">
          🤖
        </span>
      )}
      {host && <HostCrown />}
      {/* Never smaller than the caption size, and in step with a big name (a table screen's). */}
      {you && (
        <span className="text-[max(var(--text-caption),0.75em)] font-normal text-ink-muted">
          (you)
        </span>
      )}
      {offline && <Badge className="text-[max(var(--text-caption),0.7em)]">offline</Badge>}
    </span>
  );
}

/** Scrolls a seat control into view and focuses it (for "Take a seat" links). */
export function revealElement(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  // A folded section (details) opens first, so the control is actually there to press.
  const details = el.closest('details');
  if (details && !details.open) details.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const focusable = el.matches('button, a, input, select, textarea')
    ? el
    : el.querySelector<HTMLElement>('button, a, input, select, textarea');
  focusable?.focus({ preventScroll: true });
}

/**
 * Reports to the room shell whether the viewer is watching, so it can show the shared
 * "You're watching" banner with the game's own seat action. Pass `null` while they play.
 * The action may change on every render; only the text and label re-report.
 */
export function useSpectatorPrompt(
  setSpectator: ((prompt: SpectatorPrompt | null) => void) | undefined,
  prompt: SpectatorPrompt | null,
) {
  const action = useRef(prompt?.action);
  useEffect(() => {
    action.current = prompt?.action;
  });
  const watching = prompt !== null;
  const hasAction = prompt?.action !== undefined;
  const text = prompt?.text;
  const actionLabel = prompt?.actionLabel;
  useEffect(() => {
    setSpectator?.(
      watching
        ? { text, actionLabel, action: hasAction ? () => action.current?.() : undefined }
        : null,
    );
  }, [setSpectator, watching, hasAction, text, actionLabel]);
  useEffect(() => {
    return () => {
      setSpectator?.(null);
    };
  }, [setSpectator]);
}
