import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, DrawingPad, DrawingView, Panel, RefusalSlot, useConfirm } from '@vt/ui';
import { useState } from 'react';
import type { SketchyView } from '../logic/types.ts';
import type { Act } from './act.ts';

/** How long before a strict drawing clock ends the pad sends whatever is on it. */
const SEND_EARLY_MS = 1200;
const DRAW_ANCHOR = 'sketchy-draw';

/** The drawing stage: your secret prompt and the pad, then your drawing while the others finish. */
export function Draw({ view, room, act }: { view: SketchyView; room: GameRoomInfo; act: Act }) {
  const g = view.game!;
  const strict = view.settings.timerMode === 'strict';
  const [confirm, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);
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
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      {dialog}
      <Panel className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 text-lg leading-snug font-bold">
            <span className="block text-sm font-medium text-ink-muted">
              Draw this (only you see it):
            </span>
            <span data-testid="sketchy-prompt" className="break-words">
              {g.myPrompt}
            </span>
          </h2>
          {g.canReroll && (
            <Button
              variant="secondary"
              className="h-11 shrink-0 px-3"
              disabled={busy}
              onClick={() => void reroll()}
            >
              🎲 New prompt
            </Button>
          )}
        </div>
        <DrawingPad
          key={draftKey}
          draftKey={draftKey}
          sendBy={
            strict && g.deadline !== null ? g.deadline - room.clockOffset - SEND_EARLY_MS : null
          }
          onSubmit={(drawing) => act({ type: 'draw', drawing }, { anchor: DRAW_ANCHOR })}
          submitLabel="Send drawing"
          footer={clock('to draw')}
        />
        <RefusalSlot anchor={DRAW_ANCHOR} />
        <p className="text-xs text-ink-muted">
          Draw so the others can tell what it is: you score 1,000 for everyone who finds your title.
        </p>
      </Panel>
    </div>
  );
}
