import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  DrawingPad,
  DrawingView,
  Panel,
  cn,
  useConfirm,
  useFitSize,
  useWideScreen,
} from '@vt/ui';
import { useRef, useState } from 'react';
import type { SketchyView } from '../logic/types.ts';
import type { Act } from './act.ts';

/**
 * The smallest sheet on a phone. Low, so on a short screen the sheet shrinks before the tools or
 * Send would have to scroll out of the play area.
 */
const PHONE_MIN = 120;
/** How long before a strict drawing clock ends the pad sends whatever is on it. */
const SEND_EARLY_MS = 1200;
const DRAW_ANCHOR = 'sketchy-draw';
/** Prompts longer than this are set smaller, so even the longest takes two lines on a phone. */
const LONG_PROMPT = 36;

/** The drawing stage: your secret prompt and the pad, then your drawing while the others finish. */
export function Draw({ view, room, act }: { view: SketchyView; room: GameRoomInfo; act: Act }) {
  const g = view.game!;
  const strict = view.settings.timerMode === 'strict';
  const [confirm, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const wide = useWideScreen();
  // The sheet is as big as the window allows with the prompt, the tools, the clock and Send in
  // view, never too small to draw on (`useFitSize`; on a phone, within the play area).
  const pad = useRef<HTMLDivElement>(null);
  useFitSize(pad, { min: wide ? 192 : PHONE_MIN, max: wide ? 720 : 360, step: 1 });
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
    <div ref={pad} className="mx-auto flex w-full max-w-md flex-col gap-1.5 lg:max-w-none lg:gap-3">
      {dialog}
      {/* Desktops show the prompt in the tool column (the pad's `aside`), phones above the sheet. */}
      {!wide && (
        // One row: the prompt, and New prompt beside it (the status line above already says
        // nobody else sees it), so the sheet gets the height.
        <div className="flex min-h-9 items-center justify-between gap-2 max-[380px]:min-h-8">
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
              className="h-9 min-h-9 shrink-0 px-3 max-[380px]:h-8 max-[380px]:min-h-8"
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
        sheetClassName="max-w-(--vt-fit) lg:w-(--vt-fit)"
        sendBy={
          strict && g.deadline !== null ? g.deadline - room.clockOffset - SEND_EARLY_MS : null
        }
        onSubmit={(drawing) => act({ type: 'draw', drawing }, { anchor: DRAW_ANCHOR })}
        submitLabel="Send drawing"
        footer={clock('to draw')}
        refusal={DRAW_ANCHOR}
        bar
        dense
        // Desktops only: on a phone the sheet needs the height (the guide says how scoring works).
        note={
          wide &&
          'Draw so the others can tell what it is: you score 1,000 for everyone who finds your title.'
        }
        aside={
          wide && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-ink-muted">Draw this (only you see it):</p>
              <p
                data-testid="sketchy-prompt"
                className="font-display text-xl leading-snug font-semibold break-words"
              >
                {g.myPrompt}
              </p>
              {g.canReroll && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-9 min-h-9 self-start"
                  disabled={busy}
                  onClick={() => void reroll()}
                >
                  🎲 New prompt
                </Button>
              )}
            </div>
          )
        }
      />
    </div>
  );
}
