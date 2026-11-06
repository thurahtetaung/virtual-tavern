import { Fragment, type ReactNode, useId, useState, useSyncExternalStore } from 'react';
import { useFitToScreen } from './fit-area.tsx';
import { Tabs, tabPanelProps } from './tabs.tsx';

/** Wider screens (Tailwind's `lg`) show the whole end screen at once, as they always have. */
const WIDE = '(min-width: 1024px)';

const subscribe = (onChange: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const wide = () => typeof window !== 'undefined' && !!window.matchMedia?.(WIDE).matches;

/** Whether the screen is wide enough for a whole end screen (read at once, so nothing flashes). */
export function useWideScreen(): boolean {
  return useSyncExternalStore(subscribe, wide, () => false);
}

export interface EndTab {
  id: string;
  /** Short, with its emoji: "🏆 Scores". */
  label: string;
  content: ReactNode;
}

/**
 * A finished game's end screen on phones: a tab strip and one part at a time (the scores, the
 * awards, the game's own details), so the end, the room's buttons and Play again fit the screen.
 * A part taller than the screen leaves scrolls inside, never the page. Wider screens get every
 * part in order with no strip, exactly as without it. Leave out parts
 * with nothing to show (`null` or `false`); with one part left there is no strip.
 */
export function EndTabs({
  tabs,
  label = 'The end',
  testId = 'end-tabs',
  className,
}: {
  tabs: readonly (EndTab | null | false | undefined)[];
  label?: string;
  testId?: string;
  /** Classes for the strip. */
  className?: string;
}) {
  const parts = tabs.filter((t): t is EndTab => !!t);
  const isWide = useWideScreen();
  const id = useId();
  const [chosen, setChosen] = useState(parts[0]?.id ?? '');
  const current = parts.find((t) => t.id === chosen) ?? parts[0];
  const { box, inner } = useFitToScreen(!isWide && parts.length > 1, current?.id ?? '');
  if (isWide || parts.length < 2)
    return (
      <>
        {parts.map((t) => (
          <Fragment key={t.id}>{t.content}</Fragment>
        ))}
      </>
    );
  return (
    <>
      <Tabs
        id={id}
        label={label}
        testId={testId}
        tabs={parts.map((t) => ({ id: t.id, label: t.label }))}
        value={current?.id ?? ''}
        onChange={setChosen}
        className={className}
      />
      <div
        ref={box}
        {...tabPanelProps(id, current?.id ?? '')}
        aria-label={current?.label}
        className="min-w-0 overflow-y-auto overscroll-contain"
      >
        <div ref={inner} className="p-px">
          {current?.content}
        </div>
      </div>
    </>
  );
}
