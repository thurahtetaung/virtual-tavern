// The experts' interactive helpers (a host option, off by default): they work from the manual
// the experts hold, so they follow a different manual too. Nothing here sees the bomb.
import { Button, cn } from '@vt/ui';
import { useState } from 'react';
import type { WireColour } from '../logic/data-types.ts';
import {
  type Cell,
  VENN_QUESTION,
  type VennWire,
  mazePath,
  mazesWithCircle,
  pathDirs,
  vennLetter,
} from '../logic/helpers.ts';
import { wiresAnswer } from '../logic/modules.ts';
import type { Rules } from '../logic/rules.ts';
import type { WiresModule } from '../logic/types.ts';

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="mt-4 space-y-2 rounded-xl bg-info-soft p-3 ring-1 ring-info-line"
      data-testid="helper"
    >
      <h4 className="font-semibold">🛠 {title}</h4>
      {children}
    </section>
  );
}

/** The maze tracer: a circle picks the maze, then the light and the triangle give the way. */
export function MazeTracer({ rules }: { rules: Rules }) {
  const [maze, setMaze] = useState<number | null>(null);
  const [start, setStart] = useState<Cell | null>(null);
  const [goal, setGoal] = useState<Cell | null>(null);
  const path = maze !== null && start && goal ? mazePath(maze, start, goal, rules) : null;
  const on = (c: Cell) => path?.some((p) => p[0] === c[0] && p[1] === c[1]);
  const step =
    maze === null
      ? 'Tap a cell with a green circle.'
      : !start
        ? 'Tap where the white light is.'
        : !goal
          ? 'Tap where the red triangle is.'
          : null;
  const tap = (c: Cell) => {
    if (maze === null) {
      const found = mazesWithCircle(rules, c);
      if (found.length) setMaze(found[0]!);
    } else if (!start) setStart(c);
    else if (!goal) setGoal(c);
  };
  const z = maze === null ? null : rules.mazes[maze]!;
  return (
    <Box title="Maze tracer">
      <p className="text-sm" data-testid="tracer-step">
        {step ??
          (path
            ? `Maze ${maze! + 1}: ${pathDirs(path).join(', ')}.`
            : 'No way through: check the cells.')}
      </p>
      <div
        className="grid aspect-square w-full max-w-64 grid-cols-6 rounded-md bg-card p-1 dark:bg-stone-900"
        aria-label="Maze tracer"
      >
        {Array.from({ length: 36 }, (_, i) => {
          const c: Cell = [i % 6, Math.floor(i / 6)];
          const v = z ? parseInt(z.walls[c[1]]![c[0]]!, 16) : 0;
          const circle = z?.circles.some((p) => p[0] === c[0] && p[1] === c[1]);
          const isStart = start && start[0] === c[0] && start[1] === c[1];
          const isGoal = goal && goal[0] === c[0] && goal[1] === c[1];
          return (
            <button
              key={i}
              type="button"
              onClick={() => tap(c)}
              aria-label={`column ${c[0] + 1}, row ${c[1] + 1}`}
              data-testid={`tracer-${c[0]}-${c[1]}`}
              className={cn(
                'flex aspect-square items-center justify-center border-solid border-stone-800 text-sm dark:border-stone-200',
                on(c) && 'bg-success-soft',
              )}
              style={{
                borderTopWidth: v & 1 ? 2 : 0,
                borderRightWidth: v & 2 ? 2 : 0,
                borderBottomWidth: v & 4 ? 2 : 0,
                borderLeftWidth: v & 8 ? 2 : 0,
              }}
            >
              {isStart ? '⚪' : isGoal ? '🔺' : circle ? '◯' : '·'}
            </button>
          );
        })}
      </div>
      {maze !== null && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setMaze(null);
            setStart(null);
            setGoal(null);
          }}
        >
          Start over
        </Button>
      )}
    </Box>
  );
}

const LETTER_SAYS = {
  C: 'Cut it.',
  D: 'Do not cut it.',
  S: 'Cut it if the serial’s last digit is even.',
  P: 'Cut it if there is a parallel port.',
  B: 'Cut it if there are two or more batteries.',
};

/** The Complicated Wires lookup: one wire's four features, its instruction. */
export function VennLookup({ rules }: { rules: Rules }) {
  const [w, setW] = useState<VennWire>({ red: false, blue: false, star: false, led: false });
  const letter = vennLetter(w, rules);
  const toggles: [keyof VennWire, string][] = [
    ['red', 'Red'],
    ['blue', 'Blue'],
    ['star', '★ Star'],
    ['led', '💡 Light on'],
  ];
  return (
    <Box title="Wire lookup">
      <p className="text-sm">Mark what one wire has:</p>
      <div className="flex flex-wrap gap-1.5">
        {toggles.map(([k, label]) => (
          <Button
            key={k}
            size="sm"
            variant={w[k] ? 'primary' : 'secondary'}
            aria-pressed={w[k]}
            onClick={() => setW({ ...w, [k]: !w[k] })}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="font-semibold" data-testid="venn-answer">
        {LETTER_SAYS[letter]}
      </p>
      {VENN_QUESTION[letter] && (
        <p className="text-sm text-ink-muted">Ask the defuser: {VENN_QUESTION[letter]}</p>
      )}
    </Box>
  );
}

const WIRE_COLOURS: WireColour[] = ['red', 'blue', 'yellow', 'black', 'white'];

/** The Wires lookup: the wires top to bottom (and the serial), which one to cut. */
export function WiresLookup({ rules }: { rules: Rules }) {
  const [wires, setWires] = useState<WireColour[]>(['red', 'blue', 'yellow']);
  const [odd, setOdd] = useState(false);
  const [letter, setLetter] = useState(false);
  const n = wires.length as 3 | 4 | 5 | 6;
  const asks = rules.wires[n].flatMap((r) => r.when);
  const needsOdd = asks.some((c) => 'serialOdd' in c);
  const needsLetter = asks.some((c) => 'serialLetter' in c);
  const m = {
    wires: wires.map((colour, slot) => ({ slot, colour, cut: false })),
  } as WiresModule;
  const serial = `${letter ? 'A' : '1'}00AA${odd ? '1' : '2'}`;
  const cut = wiresAnswer(m, { serial, widgets: [], strikes: 0, timerText: () => '', rules });
  const next = (c: WireColour) =>
    WIRE_COLOURS[(WIRE_COLOURS.indexOf(c) + 1) % WIRE_COLOURS.length]!;
  return (
    <Box title="Wire table lookup">
      <p className="text-sm">Set the wires from the top (tap to change a colour):</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {wires.map((c, i) => (
          <Button
            key={i}
            size="sm"
            variant="secondary"
            onClick={() => setWires(wires.map((x, j) => (j === i ? next(x) : x)))}
            data-testid={`lookup-wire-${i}`}
          >
            {i + 1}. {c}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={wires.length <= 3}
          onClick={() => setWires(wires.slice(0, -1))}
          aria-label="One wire fewer"
        >
          −
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={wires.length >= 6}
          onClick={() => setWires([...wires, 'red'])}
          aria-label="One wire more"
        >
          ＋
        </Button>
      </div>
      {(needsOdd || needsLetter) && (
        <div className="flex flex-wrap gap-1.5">
          {needsOdd && (
            <Button size="sm" variant={odd ? 'primary' : 'secondary'} onClick={() => setOdd(!odd)}>
              Serial ends odd: {odd ? 'yes' : 'no'}
            </Button>
          )}
          {needsLetter && (
            <Button
              size="sm"
              variant={letter ? 'primary' : 'secondary'}
              onClick={() => setLetter(!letter)}
            >
              Serial starts with a letter: {letter ? 'yes' : 'no'}
            </Button>
          )}
        </div>
      )}
      <p className="font-semibold" data-testid="wires-answer">
        Cut the {ORD[cut]} wire ({wires[cut]}).
      </p>
    </Box>
  );
}
