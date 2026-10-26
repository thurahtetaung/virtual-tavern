import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, PlayerTag, RefusalSlot } from '@vt/ui';
import { useState } from 'react';
import { lineTile, scoreAt, wallSpaces } from '../logic/rules.ts';
import { COLOUR_NAME } from '../logic/tiles.ts';
import type { MosaicView } from '../logic/types.ts';
import type { Art } from './assets.ts';
import { useConfirmSetting } from './PickSheet.tsx';
import { BoardView, Tile, useMatch } from './Pieces.tsx';
import type { Act } from './Table.tsx';
import type { NameOf } from './text.ts';

const ANCHOR = 'mo-wall';

/**
 * The wall stage: players with a choice (the grey wall, a line of jokers alone) put each full
 * line's tile on a lit space of its row, top line first; everyone sees who is still choosing.
 */
export function WallStage({
  view,
  room,
  act,
  art,
  name,
}: {
  view: MosaicView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  const grey = !!view.settings.grey;
  const wide = useMatch('(min-width: 1024px)');
  const [confirm] = useConfirmSetting();
  const [chosen, setChosen] = useState<{ row: number; col: number } | null>(null);
  const me = g.players.find((p) => p.id === room.you && !p.removed);
  const row = g.walls?.[room.you]?.row ?? null;
  const choosing = Object.entries(g.walls ?? {}).flatMap(([id, w]) =>
    w.row === null ? [] : [{ id, row: w.row }],
  );
  const place = async (col: number) => {
    if (row === null) return;
    if (await act({ type: 'wall', row, col }, { anchor: ANCHOR })) setChosen(null);
  };

  const mine =
    me && row !== null
      ? (() => {
          const line = me.lines[row]!;
          const tile = lineTile(line);
          const cols = wallSpaces(me.wall, row, line, grey);
          const pickCol = chosen?.row === row ? chosen.col : null;
          const points = pickCol === null ? null : scoreAt(me.wall, row, pickCol).points;
          const colour = line.colour;
          const why = !colour
            ? `A line of jokers alone: the joker goes on any free space of row ${row + 1}.${grey ? '' : ` That space’s colour can’t go in line ${row + 1} again.`}`
            : grey
              ? `${tile === 'joker' ? `The joker stands in for ${COLOUR_NAME[colour]}: it` : `The ${COLOUR_NAME[colour]} tile`} goes on any lit space of row ${row + 1}. On this blank wall no colour may appear twice in a row or a column.`
              : `Row ${row + 1}.`;
          return (
            <div className="flex flex-col items-center gap-2" data-testid="mo-wall-choice">
              <p className="flex items-center gap-1.5 self-stretch text-sm">
                <Tile colour={tile} art={art} size={22} />
                <span>
                  <strong>Line {row + 1}</strong>: {why}
                </span>
              </p>
              <BoardView
                board={me}
                art={art}
                size={wide ? 'lg' : 'md'}
                owner={me.id}
                grey={grey}
                spaces={{
                  row,
                  cols,
                  chosen: pickCol,
                  onPick: (col) => {
                    if (confirm) setChosen({ row, col });
                    else void place(col);
                  },
                }}
              />
              {confirm && (
                <Button
                  className="w-full sm:w-auto"
                  disabled={pickCol === null}
                  onClick={() => pickCol !== null && void place(pickCol)}
                  data-testid="mo-wall-place"
                >
                  {pickCol === null
                    ? 'Tap a lit space'
                    : `Place in column ${pickCol + 1} (+${points})`}
                </Button>
              )}
              <RefusalSlot anchor={ANCHOR} />
            </div>
          );
        })()
      : null;

  return (
    <section
      aria-label={`Round ${g.round}: choosing wall spaces`}
      className="mo-rise flex flex-col gap-2 rounded-2xl bg-card/90 p-2.5 shadow-sm ring-1 ring-line dark:bg-stone-900/85 dark:ring-stone-800"
      data-testid="mo-wall"
    >
      <h2 className="font-bold">Round {g.round}: wall-tiling, top line first</h2>
      {mine ?? (
        <p className="text-sm text-ink-muted dark:text-stone-400">
          {me
            ? 'Your wall is done. The scores show once everyone has placed their tiles.'
            : 'Some players are choosing where their tiles go on the wall.'}
        </p>
      )}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label="Still choosing">
        {choosing
          .filter((c) => c.id !== room.you)
          .map((c) => (
            <li key={c.id} className="flex items-center gap-1">
              <PlayerTag name={name(c.id)} />
              <span className="text-ink-muted dark:text-stone-400">line {c.row + 1}…</span>
            </li>
          ))}
      </ul>
    </section>
  );
}
