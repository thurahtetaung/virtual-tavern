import type { GameRoomInfo } from '@vt/game-sdk';
import { Countdown, DrawingPad, DrawingView, Panel, PlayerTag } from '@vt/ui';
import type { GoingOnceView } from '../logic/types.ts';
import type { Act } from './act.ts';
import { HowTo } from './Extras.tsx';

/** How long before the drawing clock ends a pad sends whatever is on it. */
const SEND_EARLY_MS = 1200;

/** The drawing stage: your titles one at a time, then who is still drawing. */
export function Draw({ view, room, act }: { view: GoingOnceView; room: GameRoomInfo; act: Act }) {
  const g = view.game!;
  const mine = view.mine;
  const deadline = g.until;
  if (!mine)
    return (
      <Panel className="flex flex-col items-center gap-2 text-center">
        <p>Everyone is drawing.</p>
        <Countdown deadline={deadline} clockOffset={room.clockOffset} label="to draw" />
      </Panel>
    );
  const index = mine.prompts.findIndex((p) => !p.sent);
  const todo = index >= 0 ? mine.prompts[index]! : null;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      {todo ? (
        <Panel className="flex flex-col gap-2 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="min-w-0 text-lg font-bold">
              <span className="text-sm font-medium text-ink-muted dark:text-stone-400">Draw: </span>
              <span data-testid="go-title">{todo.title}</span>
            </h2>
            <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-xs font-semibold ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700">
              {index + 1} of {mine.prompts.length}
            </span>
          </div>
          <DrawingPad
            key={todo.item}
            draftKey={`go.draft.${todo.item}`}
            sendBy={deadline - room.clockOffset - SEND_EARLY_MS}
            onSubmit={(drawing) =>
              act({ type: 'draw', item: todo.item, drawing }, { anchor: 'go-draw' })
            }
            submitLabel={index + 1 < mine.prompts.length ? 'Send, next title' : 'Send'}
            footer={
              <Countdown
                deadline={deadline}
                clockOffset={room.clockOffset}
                label="for both"
                atZero="whatever is drawn is sent"
              />
            }
          />
          <p className="text-xs text-ink-muted dark:text-stone-400">
            Others drew lookalike titles: keep it simple. Nobody sees your title until it sells.
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
          <Countdown deadline={deadline} clockOffset={room.clockOffset} label="left to draw" />
        </Panel>
      )}
    </div>
  );
}
