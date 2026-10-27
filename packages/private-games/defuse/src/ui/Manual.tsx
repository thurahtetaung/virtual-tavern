import { Button, PlayerTag, ProtectedImage, cn } from '@vt/ui';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  BUTTON_RULES,
  GLYPHS,
  INDICATOR_LABELS,
  KEYPAD_COLUMNS,
  KNOB,
  MAZES,
  MEMORY_RULES,
  MORSE,
  MORSE_ALPHABET,
  PASSWORDS,
  RELEASE_DIGIT,
  SEQUENCE,
  SIMON_MAP,
  VENN,
  WIRE_RULES,
  WOF_DISPLAYS,
  WOF_LISTS,
} from '../logic/data.ts';
import type { ButtonCond, WireCond } from '../logic/data-types.ts';
import { NEEDY, type PageId, SOLVABLE } from '../logic/types.ts';
import type { DefuseView } from '../logic/view.ts';
import type { Art } from './assets.ts';
import { PORT_NAME } from './Bomb.tsx';

export const PAGES: PageId[] = [...SOLVABLE, ...NEEDY, 'appendix'];

export const pageName = (art: Art, p: PageId) =>
  p === 'appendix' ? 'The edges (appendix)' : art.names[p];

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const POS = ['top left', 'top right', 'middle left', 'middle right', 'bottom left', 'bottom right'];

function wireCond(c: WireCond): string {
  if ('serialOdd' in c) return 'the last digit of the serial number is odd';
  if ('last' in c) return `the last wire is ${c.last}`;
  if ('is' in c)
    return c.is === 0 ? `there are no ${c.count} wires` : `there is exactly one ${c.count} wire`;
  return `there is more than one ${c.count} wire`;
}

function buttonCond(c: ButtonCond): string {
  if ('colour' in c) return `the button is ${c.colour}`;
  if ('label' in c) return `the button says “${c.label[0]!.toUpperCase()}${c.label.slice(1)}”`;
  if ('batteriesOver' in c)
    return `there is more than ${c.batteriesOver} batter${c.batteriesOver === 1 ? 'y' : 'ies'} on the bomb`;
  return `there is a lit indicator labelled ${c.lit}`;
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className="border-b border-line px-2 py-1 text-left font-semibold dark:border-stone-700"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-panel/60 dark:odd:bg-stone-800/40">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Glyph({ n, art }: { n: number; art: Art }) {
  const src = art.glyph(n);
  return src ? (
    <ProtectedImage
      src={src}
      alt={GLYPHS[n]?.name ?? ''}
      className="mx-auto size-9 object-contain dark:invert"
    />
  ) : (
    <span className="font-serif text-2xl" title={GLYPHS[n]?.name}>
      {GLYPHS[n]?.glyph}
    </span>
  );
}

/** A maze drawn from its walls (the page image takes over when the manifest has one). */
function MazeGrid({ i }: { i: number }) {
  const z = MAZES[i]!;
  return (
    <div
      className="grid aspect-square w-full max-w-48 grid-cols-6 bg-card p-1 dark:bg-stone-900"
      aria-label={`maze ${i + 1}`}
    >
      {z.walls.flatMap((row, y) =>
        [...row].map((h, x) => {
          const v = parseInt(h, 16);
          const circle = z.circles.some((c) => c[0] === x && c[1] === y);
          const edge = 'border-stone-800 dark:border-stone-200';
          return (
            <span
              key={`${x},${y}`}
              className={cn(
                'flex aspect-square items-center justify-center border-transparent',
                edge,
              )}
              style={{
                borderTopWidth: v & 1 ? 2 : 0,
                borderRightWidth: v & 2 ? 2 : 0,
                borderBottomWidth: v & 4 ? 2 : 0,
                borderLeftWidth: v & 8 ? 2 : 0,
                borderStyle: 'solid',
              }}
            >
              <span
                className={cn(
                  'rounded-full',
                  circle ? 'size-3 ring-2 ring-success' : 'size-1 bg-stone-400',
                )}
              />
            </span>
          );
        }),
      )}
    </div>
  );
}

/** Each module's page, rebuilt from the manual's tables, in the manual's typewriter face when the manifest has it. */
function PageBody({ page, art }: { page: PageId; art: Art }) {
  return (
    <div
      style={art.fonts.manual ? { fontFamily: art.fonts.manual } : undefined}
      data-testid="manual-text"
    >
      <PageContent page={page} art={art} />
    </div>
  );
}

function PageContent({ page, art }: { page: PageId; art: Art }) {
  switch (page) {
    case 'wires':
      return (
        <div className="space-y-3">
          <p>
            Wires are counted from the top. Find the count, then use the first rule that applies.
          </p>
          {([3, 4, 5, 6] as const).map((n) => (
            <div key={n}>
              <h4 className="font-semibold">{n} wires</h4>
              <ul className="list-disc space-y-0.5 pl-5">
                {WIRE_RULES[n].map((r, i) => {
                  const what =
                    r.cut === 'last'
                      ? r.of
                        ? `the last ${r.of} wire`
                        : 'the last wire'
                      : `the ${ORD[r.cut]} wire`;
                  return (
                    <li key={i}>
                      {r.when.length
                        ? `If ${r.when.map(wireCond).join(' and ')}, cut ${what}.`
                        : `Otherwise, cut ${what}.`}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      );
    case 'button':
      return (
        <div className="space-y-3">
          <p>Use the first rule that applies.</p>
          <ol className="list-decimal space-y-0.5 pl-5">
            {BUTTON_RULES.map((r, i) => (
              <li key={i}>
                {r.when.length ? `If ${r.when.map(buttonCond).join(' and ')}, ` : 'Otherwise, '}
                {r.hold ? 'hold the button (see below).' : 'press and immediately release it.'}
              </li>
            ))}
          </ol>
          <h4 className="font-semibold">Releasing a held button</h4>
          <p>
            Hold it: a strip lights up beside it. Let go when the timer shows this digit anywhere:
          </p>
          <Table
            head={['Strip', 'Release on a']}
            rows={Object.entries(RELEASE_DIGIT).map(([c, d]) => [
              c === 'other' ? 'Any other colour' : cap(c),
              d,
            ])}
          />
        </div>
      );
    case 'keypad':
      return (
        <div className="space-y-3">
          <p>
            Find the one column holding all four symbols. Press the four keys in that column’s
            order, top to bottom.
          </p>
          <div className="grid grid-cols-6 gap-1 text-center">
            {KEYPAD_COLUMNS.map((col, i) => (
              <div key={i} className="space-y-1 rounded-md bg-panel p-1 dark:bg-stone-800">
                {col.map((n) => (
                  <div key={n} className="flex h-10 items-center justify-center">
                    <Glyph n={n} art={art} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      );
    case 'simon':
      return (
        <div className="space-y-3">
          <p>
            Each flash means press a colour. Enter the whole sequence so far each time it grows. The
            answer depends on a vowel in the serial number and the strikes so far.
          </p>
          {(['vowel', 'none'] as const).map((k) => (
            <div key={k}>
              <h4 className="font-semibold">
                {k === 'vowel' ? 'Serial number has a vowel' : 'No vowel in the serial number'}
              </h4>
              <Table
                head={['Strikes', 'Red →', 'Blue →', 'Green →', 'Yellow →']}
                rows={(['0', '1', '2'] as const).map((s) => [
                  s === '2' ? '2 or more' : s,
                  ...SIMON_MAP[k][s].map(cap),
                ])}
              />
            </div>
          ))}
        </div>
      );
    case 'whos-on-first':
      return (
        <div className="space-y-3">
          <p>Step 1: the display’s word says which button to read.</p>
          <Table
            head={['Display', 'Read the button']}
            rows={WOF_DISPLAYS.map(([w, p]) => [w ? w : <em key="e">(empty)</em>, POS[p]])}
          />
          <p>
            Step 2: find that button’s word below and press the first word in its list that is on a
            button.
          </p>
          <Table
            head={['Word', 'Press the first of']}
            rows={Object.entries(WOF_LISTS).map(([k, v]) => [<b key="k">{k}</b>, v.join(', ')])}
          />
        </div>
      );
    case 'memory': {
      const say = (r: { press: string; n: number }) =>
        r.press === 'position'
          ? `the button in the ${ORD[r.n - 1]} position`
          : r.press === 'label'
            ? `the button labelled “${r.n}”`
            : r.press === 'samePositionAsStage'
              ? `the button in the same position as in stage ${r.n}`
              : `the button with the same label as in stage ${r.n}`;
      return (
        <div className="space-y-3">
          <p>
            Five stages. A wrong press sends you back to stage 1. Keep track of what you pressed.
          </p>
          {[1, 2, 3, 4, 5].map((s) => (
            <div key={s}>
              <h4 className="font-semibold">Stage {s}</h4>
              <ul className="list-disc pl-5">
                {MEMORY_RULES[s]!.map((r, i) => (
                  <li key={i}>
                    Display {i + 1}: press {say(r)}.
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    }
    case 'morse':
      return (
        <div className="space-y-3">
          <p>
            Read the word the light blinks (it repeats after a long gap), then set its frequency and
            press TX.
          </p>
          <Table
            head={['Word', 'Frequency']}
            rows={MORSE.map(([f, w]) => [w, `${(f / 1000).toFixed(3)} MHz`])}
          />
          <div
            className={cn(
              'grid grid-cols-3 gap-x-3 text-sm sm:grid-cols-4',
              !art.fonts.manual && 'font-mono',
            )}
          >
            {Object.entries(MORSE_ALPHABET).map(([c, s]) => (
              <span key={c}>
                <b>{c.toUpperCase()}</b> {s}
              </span>
            ))}
          </div>
        </div>
      );
    case 'complicated-wires': {
      const L = {
        C: 'Cut',
        D: "Don't cut",
        S: 'Cut if the serial’s last digit is even',
        P: 'Cut if there is a parallel port',
        B: 'Cut if there are 2 or more batteries',
      };
      return (
        <div className="space-y-3">
          <p>
            Look at every wire: is it red, blue, both, does its light shine, is there a star below
            it.
          </p>
          <Table
            head={['Red', 'Blue', 'Star', 'Light', 'Then']}
            rows={Object.entries(VENN).map(([k, v]) => [
              k.includes('r') ? '✓' : '',
              k.includes('b') ? '✓' : '',
              k.includes('s') ? '✓' : '',
              k.includes('l') ? '✓' : '',
              L[v],
            ])}
          />
        </div>
      );
    }
    case 'wire-sequence':
      return (
        <div className="space-y-3">
          <p>
            Count each colour’s wires across all panels in order. Cut a wire if its count’s row
            names the letter it runs to. Go down to the next panel when done.
          </p>
          <Table
            head={['Count', 'Red', 'Blue', 'Black']}
            rows={Array.from({ length: 9 }, (_, i) => [
              ORD[i] ?? `${i + 1}th`,
              ...(['red', 'blue', 'black'] as const).map((c) =>
                SEQUENCE[c][i]!.map((t) => 'ABC'[t]).join(' or '),
              ),
            ]).map((r, i) => [i < 6 ? cap(r[0]!) : `${i + 1}th`, ...r.slice(1)])}
          />
        </div>
      );
    case 'maze':
      return (
        <div className="space-y-3">
          <p>
            Find the maze with the same two circles. Guide the white light to the red triangle
            without hitting a wall.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {MAZES.map((_, i) => (
              <MazeGrid key={i} i={i} />
            ))}
          </div>
        </div>
      );
    case 'password':
      return (
        <div className="space-y-3">
          <p>
            Only one of these words can be spelled with the letters on the dials. Spell it and
            submit.
          </p>
          <p
            className={cn(
              'columns-3 text-sm uppercase sm:columns-5',
              !art.fonts.manual && 'font-mono',
            )}
          >
            {PASSWORDS.map((w) => (
              <span key={w} className="block">
                {w}
              </span>
            ))}
          </p>
        </div>
      );
    case 'venting-gas':
      return (
        <div className="space-y-2">
          <p>A needy module: answer the computer before its countdown ends.</p>
          <Table
            head={['It asks', 'Answer']}
            rows={[
              ['VENT GAS?', 'Y'],
              ['DETONATE?', 'N'],
            ]}
          />
        </div>
      );
    case 'capacitor':
      return (
        <p>
          A needy module: hold the lever down to discharge the capacitor before its countdown ends.
        </p>
      );
    case 'knob':
      return (
        <div className="space-y-3">
          <p>
            A needy module: before its countdown ends, turn the knob to the position the lit lights
            say, relative to the UP label.
          </p>
          <Table
            head={['Top row', 'Bottom row', 'Turn to']}
            rows={KNOB.map((k) => [
              <span key="t" className="font-mono">
                {k.leds.slice(0, 6).replace(/X/g, '●').replace(/O/g, '○')}
              </span>,
              <span key="b" className="font-mono">
                {k.leds.slice(6).replace(/X/g, '●').replace(/O/g, '○')}
              </span>,
              cap(k.pos),
            ])}
          />
        </div>
      );
    case 'appendix':
      return (
        <div className="space-y-3">
          <p>Indicators carry one of these labels, lit or unlit: {INDICATOR_LABELS.join(', ')}.</p>
          <p>Batteries come in holders of two AA or one D. Count every battery.</p>
          <p>Ports: {Object.values(PORT_NAME).join(', ')}.</p>
          <p>The serial number’s vowels are A, E, I, O and U.</p>
        </div>
      );
  }
}

/** The page's words, for the search. */
function pageText(page: PageId): string {
  switch (page) {
    case 'whos-on-first':
      return [...WOF_DISPLAYS.map(([w]) => w), ...Object.keys(WOF_LISTS)].join(' ');
    case 'password':
      return PASSWORDS.join(' ');
    case 'morse':
      return MORSE.map(([f, w]) => `${w} ${(f / 1000).toFixed(3)}`).join(' ');
    case 'keypad':
      return Object.values(GLYPHS)
        .map((g) => g.name)
        .join(' ');
    case 'appendix':
      return `${INDICATOR_LABELS.join(' ')} serial battery batteries indicator port ${Object.values(PORT_NAME).join(' ')}`;
    default:
      return '';
  }
}

export interface ManualProps {
  v: DefuseView;
  art: Art;
  you: string;
  names: Map<string, string>;
  act?: (
    a: { type: 'claim'; page: PageId; on: boolean } | { type: 'note'; page: PageId; text: string },
  ) => void;
  /** Table screen: no claim buttons, two pages side by side. */
  big?: boolean;
}

/** The experts' manual: the index with claims, search, each page, shared notes. */
export function Manual({ v, art, you, names, act }: ManualProps) {
  const [page, setPage] = useState<PageId | null>(null);
  const [query, setQuery] = useState('');
  const [image, setImage] = useState(false);
  const q = query.trim().toLowerCase();
  const found = useMemo(
    () =>
      PAGES.filter(
        (p) =>
          !q || pageName(art, p).toLowerCase().includes(q) || pageText(p).toLowerCase().includes(q),
      ),
    [q, art],
  );
  const claims = v.claims ?? {};
  const seated = v.seats.some((p) => p.id === you);
  if (page) {
    const mine = claims[page]?.includes(you) ?? false;
    const pics = art.pagesOf(page).flatMap((n) => art.page(n) ?? []);
    return (
      <div className="space-y-3" data-testid={`page-${page}`}>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPage(null)}>
            ◂ Index
          </Button>
          <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">{pageName(art, page)}</h3>
          {pics.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setImage(!image)}>
              {image ? 'Text' : 'Page'}
            </Button>
          )}
          {act && seated && (
            <Button
              size="sm"
              variant={mine ? 'secondary' : 'soft'}
              onClick={() => act({ type: 'claim', page, on: !mine })}
            >
              {mine ? 'Unclaim' : 'Claim'}
            </Button>
          )}
        </div>
        <ClaimLine list={claims[page]} names={names} you={you} />
        <div className="rounded-xl bg-card p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-800">
          {image && pics.length ? (
            <div className="space-y-2">
              {pics.map((src) => (
                <ProtectedImage
                  key={src}
                  src={src}
                  alt="Manual page"
                  className="w-full rounded-md"
                />
              ))}
            </div>
          ) : (
            <PageBody page={page} art={art} />
          )}
        </div>
        {act && seated && <Notes page={page} text={v.notes?.[page] ?? ''} act={act} />}
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="manual-index">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the manual (a word, a symbol)…"
        className="h-11 w-full rounded-lg bg-card px-3 ring-1 ring-line focus:outline-2 focus:outline-accent dark:bg-stone-900 dark:ring-stone-700"
        aria-label="Search the manual"
        data-testid="manual-search"
      />
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2">
        {found.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPage(p)}
            className={cn(
              'flex min-h-11 flex-col items-start justify-center rounded-xl bg-card px-3 py-1 text-left leading-tight ring-1 ring-line hover:bg-panel sm:min-h-14 sm:py-2 dark:bg-stone-900 dark:ring-stone-800',
              claims[p]?.includes(you) && 'ring-2 ring-accent',
            )}
            data-testid={`index-${p}`}
          >
            <span className="text-sm font-semibold sm:text-base">
              {(NEEDY as readonly string[]).includes(p) && <span aria-hidden>⚠ </span>}
              {pageName(art, p)}
            </span>
            {claims[p]?.length ? (
              <span className="max-w-full truncate text-xs text-ink-muted">
                {claims[p].map((id) => (id === you ? 'you' : (names.get(id) ?? '?'))).join(', ')}
              </span>
            ) : null}
          </button>
        ))}
        {!found.length && (
          <p className="col-span-full text-center text-ink-muted">Nothing found.</p>
        )}
      </div>
    </div>
  );
}

function ClaimLine({
  list,
  names,
  you,
}: {
  list?: string[];
  names: Map<string, string>;
  you: string;
}) {
  if (!list?.length)
    return <p className="text-xs text-ink-muted">Nobody has claimed this page yet.</p>;
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
      Claimed by
      {list.map((id) => (
        <PlayerTag key={id} name={names.get(id) ?? '?'} you={id === you} />
      ))}
    </p>
  );
}

/** The page's shared notes, sent a moment after typing stops. */
function Notes({
  page,
  text,
  act,
}: {
  page: PageId;
  text: string;
  act: NonNullable<ManualProps['act']>;
}) {
  const [draft, setDraft] = useState(text);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!editing.current) setDraft(text);
  }, [text]);
  useEffect(() => {
    return () => {
      clearTimeout(timer.current);
    };
  }, []);
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">✎ Notes (shared with the experts)</span>
      <textarea
        value={draft}
        maxLength={500}
        rows={3}
        onFocus={() => {
          editing.current = true;
        }}
        onBlur={() => {
          editing.current = false;
          clearTimeout(timer.current);
          if (draft !== text) act({ type: 'note', page, text: draft });
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          clearTimeout(timer.current);
          const value = e.target.value;
          timer.current = setTimeout(() => act({ type: 'note', page, text: value }), 800);
        }}
        className="w-full rounded-lg bg-card p-2 text-sm ring-1 ring-line focus:outline-2 focus:outline-accent dark:bg-stone-900 dark:ring-stone-700"
        placeholder="Serial, batteries, what was pressed…"
        data-testid="notes"
      />
    </label>
  );
}

/** Claims for the whole manual, one line per expert (the table screen, the expert's header). */
export function ClaimsSummary({
  v,
  names,
  art,
}: {
  v: DefuseView;
  names: Map<string, string>;
  art: Art;
}) {
  const by = new Map<string, string[]>();
  for (const [p, list] of Object.entries(v.claims ?? {}))
    for (const id of list ?? []) by.set(id, [...(by.get(id) ?? []), pageName(art, p as PageId)]);
  if (!by.size) return <p className="text-sm text-ink-muted">No pages claimed yet.</p>;
  return (
    <ul className="space-y-0.5 text-sm" data-testid="claims">
      {[...by].map(([id, pages]) => (
        <li key={id} className="flex flex-wrap items-center gap-1">
          <PlayerTag name={names.get(id) ?? '?'} />: {pages.join(', ')}
        </li>
      ))}
    </ul>
  );
}

export { PageBody };
