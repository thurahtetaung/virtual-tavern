import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  DrawingPad,
  DrawingView,
  Panel,
  cn,
  useConfirm,
  useWideScreen,
} from '@vt/ui';
import { type CSSProperties, useLayoutEffect, useState } from 'react';
import type { SketchyView } from '../logic/types.ts';
import type { Act } from './act.ts';

/** How long before a strict drawing clock ends the pad sends whatever is on it. */
const SEND_EARLY_MS = 1200;
const DRAW_ANCHOR = 'sketchy-draw';
/** The prompt's row on a phone (a one-line prompt and New prompt), in px, which the sheet's size allows for. */
const ONE_LINE = 36;

/** How much taller than that the header is (0 while it fits). */
function useExtraLines() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [extra, setExtra] = useState(0);
  // Measured before the first paint (so the sheet never shows at the one-line size), then again
  // whenever the header wraps differently.
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setExtra(Math.max(0, Math.round(el.offsetHeight - ONE_LINE)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [el]);
  return [setEl, extra] as const;
}

/** Prompts longer than this are set smaller, so even the longest takes two lines on a phone. */
const LONG_PROMPT = 36;

/** The drawing stage: your secret prompt and the pad, then your drawing while the others finish. */
export function Draw({ view, room, act }: { view: SketchyView; room: GameRoomInfo; act: Act }) {
  const g = view.game!;
  const strict = view.settings.timerMode === 'strict';
  const [confirm, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [heading, extra] = useExtraLines();
  const wide = useWideScreen();
  const clock = (label: string) => (
    <Countdown
      deadline={g.deadline}
      clockOffset={room.clockOffset}
      label={label}
      soft={!strict}
      atZero="whatever is drawn is sent"
      expiredHint="Just a reminder: the game waits for every drawing."
    />
  );
  if (g.myPrompt === null) {
    return (
      <Panel className="flex flex-col items-center gap-2 text-center">
        <p>Everyone is drawing their secret prompt.</p>
        {clock('to draw')}
      </Panel>
    );
  }
  if (g.myDrawing) {
    return (
      <Panel className="mx-auto flex w-full max-w-md flex-col items-center gap-3 text-center">
        <p className="font-semibold">Thanks! Your drawing is in.</p>
        <DrawingView
          drawing={g.myDrawing}
          label={`Your drawing of ${g.myPrompt}`}
          className="w-48"
        />
        <p className="text-sm text-ink-muted">
          You drew <span className="font-semibold text-ink">“{g.myPrompt}”</span>. Keep it to
          yourself!
        </p>
        {clock('left to draw')}
      </Panel>
    );
  }
  const reroll = async () => {
    if (
      !(await confirm({
        title: 'Swap for a new prompt?',
        body: 'You get one new prompt per game, and your drawing so far is cleared.',
        confirmLabel: 'New prompt',
      }))
    )
      return;
    setBusy(true);
    await act({ type: 'reroll' }, { anchor: DRAW_ANCHOR });
    setBusy(false);
  };
  // A new prompt is a new sheet: the draft is kept per prompt.
  const draftKey = `sketchy.draft.${g.round}.${g.myPrompt}`;
  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col gap-3 lg:max-w-4xl"
      style={{ '--extra': `${extra}px` } as CSSProperties}
    >
      {dialog}
      <Panel className="flex flex-col gap-2 p-3 lg:p-5">
        {/* Desktops show the prompt beside the sheet (the pad's `aside`), phones above it. */}
        {!wide && (
          // One row: the prompt, and New prompt beside it (the status line above already says
          // nobody else sees it), so the sheet gets the height.
          <div ref={heading} className="flex min-h-9 items-center justify-between gap-2">
            <p className="sr-only">Draw this (only you see it):</p>
            <h2
              data-testid="sketchy-prompt"
              className={cn(
                'min-w-0 leading-snug font-bold break-words',
                g.myPrompt.length > LONG_PROMPT ? 'text-base' : 'text-lg',
              )}
            >
              {g.myPrompt}
            </h2>
            {g.canReroll && (
              <Button
                variant="secondary"
                size="sm"
                className="h-9 shrink-0 px-3"
                disabled={busy}
                onClick={() => void reroll()}
              >
                🎲 New prompt
              </Button>
            )}
          </div>
        )}
        <DrawingPad
          key={draftKey}
          draftKey={draftKey}
          sendBy={
            strict && g.deadline !== null ? g.deadline - room.clockOffset - SEND_EARLY_MS : null
          }
          onSubmit={(drawing) => act({ type: 'draw', drawing }, { anchor: DRAW_ANCHOR })}
          submitLabel="Send drawing"
          footer={clock('to draw')}
          refusal={DRAW_ANCHOR}
          bar
          beside
          aside={
            wide && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-ink-muted">Draw this (only you see it):</p>
                <p
                  data-testid="sketchy-prompt"
                  className="font-display text-heading leading-snug font-semibold break-words"
                >
                  {g.myPrompt}
                </p>
                {g.canReroll && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    disabled={busy}
                    onClick={() => void reroll()}
                  >
                    🎲 New prompt
                  </Button>
                )}
              </div>
            )
          }
          // The sheet is as big as the screen allows with everything else in view (on a phone
          // about 520 px of room, tabs, the prompt's row, both rows of pens and Send around it, plus
          // the prompt's extra lines; on a desktop, with the prompt, pens and Send beside it, about
          // 340 px of site and room header, round line and the note under it), never too small.
          className="max-lg:[&>div:first-child]:max-w-[max(12rem,calc((100svh_-_520px_-_var(--extra))_*_0.8))] lg:[&>div:first-child]:max-w-[min(36rem,max(16rem,calc((100svh_-_340px)_*_0.8)))]"
        />
        {/* Desktops only: on a phone the sheet needs the height (the guide says how scoring works). */}
        <p className="text-xs text-ink-muted max-lg:hidden">
          Draw so the others can tell what it is: you score 1,000 for everyone who finds your title.
        </p>
      </Panel>
    </div>
  );
}
