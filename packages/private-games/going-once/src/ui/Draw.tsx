import type { GameRoomInfo } from '@vt/game-sdk';
import { Countdown, DrawingPad, DrawingView, Panel, PlayerTag, useSecondsLeft } from '@vt/ui';
import type { GoingOnceView } from '../logic/types.ts';
import type { Act } from './act.ts';
import { HowTo } from './Extras.tsx';
import { PadFrame, RigIcon } from './PhoneShow.tsx';

/** How long before the drawing clock ends a pad sends whatever is on it. */
const SEND_EARLY_MS = 1200;

/** The drawing stage: your titles one at a time, then who is still drawing. */
/**
 * Room on a phone for everything but the sheet (the site's bar, the status line, the title, the
 * pens and Send; the auctioneer's words too unless a table screen shows them), so the sheet is as
 * big as the screen allows with all of it in view, never too small to draw on.
 */
const AROUND_PX = { quiet: 480, full: 575 };

export function Draw({
  view,
  room,
  act,
  quiet = false,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  /** A table screen shows the auctioneer's words. */
  quiet?: boolean;
}) {
  const g = view.game!;
  const mine = view.mine;
  const deadline = g.until;
  // As the original, the clock shows only once it starts (after the voice's instructions), at
  // its full length; drawing is open meanwhile.
  const startsIn = useSecondsLeft(g.drawFrom, room.clockOffset);
  const clock = (startsIn ?? 0) <= 0;
  if (!mine)
    return (
      <Panel className="flex flex-col items-center gap-2 text-center">
        <p>Everyone is drawing.</p>
        {clock && <Countdown deadline={deadline} clockOffset={room.clockOffset} label="to draw" />}
      </Panel>
    );
  const index = mine.prompts.findIndex((p) => !p.sent);
  const todo = index >= 0 ? mine.prompts[index]! : null;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      {todo ? (
        <Panel className="flex flex-col gap-2 p-3">
          {/* Phones: the status line above says what to draw and which of the two it is. */}
          <div className="flex items-baseline justify-between gap-2 max-lg:sr-only">
            <h2 className="min-w-0 text-lg font-bold">
              <span className="text-sm font-medium text-ink-muted dark:text-stone-400">Draw: </span>
              <span data-testid="go-title">{todo.title}</span>
            </h2>
            <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-xs font-semibold ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700">
              {index + 1} of {mine.prompts.length}
            </span>
          </div>
          <div
            style={{
              ['--sheet' as string]: `max(13rem, calc((100svh - ${quiet ? AROUND_PX.quiet : AROUND_PX.full}px) * 0.8))`,
            }}
          >
            <PadFrame>
              <DrawingPad
                key={todo.item}
                className="max-lg:[&>div:first-child]:max-w-(--sheet)"
                draftKey={`go.draft.${todo.item}`}
                sendBy={deadline - room.clockOffset - SEND_EARLY_MS}
                onSubmit={(drawing) =>
                  act({ type: 'draw', item: todo.item, drawing }, { anchor: 'go-draw' })
                }
                submitLabel={index + 1 < mine.prompts.length ? 'Send, next title' : 'Send'}
                footer={
                  clock && (
                    <span className="flex items-center gap-1.5">
                      <RigIcon symbol="hourglass" className="h-9 w-7 shrink-0" />
                      <Countdown
                        deadline={deadline}
                        clockOffset={room.clockOffset}
                        label="for both"
                        atZero="whatever is drawn is sent"
                      />
                    </span>
                  )
                }
              />
            </PadFrame>
          </div>
          <p className="text-xs text-ink-muted dark:text-stone-400">
            Keep it simple: others drew lookalike titles.
            <span className="max-lg:hidden"> Nobody sees your title until it sells.</span>
          </p>
        </Panel>
      ) : (
        <Panel className="flex flex-col gap-3">
          <p className="font-semibold">Thanks for the drawings!</p>
          {/* Off the clock: the room's first game explains the auction while the others draw. */}
          <HowTo view={view} />
          <div className="grid grid-cols-2 gap-3">
            {mine.prompts.map((p) => (
              <figure key={p.item} className="flex flex-col gap-1">
                <DrawingView drawing={p.drawing} label={`Your drawing of ${p.title}`} />
                <figcaption className="truncate text-center text-sm">{p.title}</figcaption>
              </figure>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-ink-muted dark:text-stone-400">Still drawing:</span>
            {g.players
              .filter((p) => !p.drawn && !p.left)
              .map((p) => (
                <PlayerTag
                  key={p.id}
                  name={p.name}
                  offline={room.players.find((x) => x.id === p.id)?.connected === false}
                />
              ))}
          </div>
          {clock && (
            <Countdown deadline={deadline} clockOffset={room.clockOffset} label="left to draw" />
          )}
        </Panel>
      )}
    </div>
  );
}
