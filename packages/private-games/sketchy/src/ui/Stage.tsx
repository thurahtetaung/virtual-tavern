import { revealParts, variantOf } from '@vt/game-sdk/show';
import { DrawingView } from '@vt/ui';
import {
  Chooser,
  Label,
  Layer,
  type LoadedRig,
  RevealCard,
  RigArt,
  Scene,
  ShowTargetsProvider,
  loadRig,
  placeOf,
  restOf,
  showFilesOf,
  useShow,
  useShowSettings,
  useShowTargets,
  useRig,
  useTarget,
} from '@vt/ui/show';
import { loadManifest } from '@vt/ui';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react';
import { revealOrder } from '../logic/reveal.ts';
import { REVEAL_STEP_MS } from '../logic/types.ts';
import type { SketchyView, TurnView } from '../logic/types.ts';
import { GAME_ID, manifestOf, useManifest } from './assets.ts';
import { jokeFor } from './audio.ts';
import type { SketchyUiProps } from './SketchyGame.tsx';
import {
  TIMER_STEP_S,
  endTimes,
  mostLiked,
  seenKeys,
  moments,
  phaseOf,
  revealEndOf,
} from './show.ts';
import { nameOf, points } from './status.ts';
import { useDeviceSound, useSound } from './useSound.ts';
import { useSeen } from './useSeen.ts';
import { ChipColours, paintsOf } from './paint.tsx';

// The table screen: the whole drawing party on a TV, from the spectator's view (`view(state,
// null)`: nothing secret). The room is the original's own vector parts (the private rig named by
// the manifest's `show` keys) on a 1280 × 720 sheet of paper; moments (`show.ts`) move them on the
// server clock, and the sound (music, the narrator, every effect) plays here when the host's
// setting says so. Without the rig it is the same room in plain words, big enough to read across
// a living room. Stage extras (the owl, the cup, the timer arm, the cat paw) are their own rigs,
// fetched only in the phases that show them.

const NEXT = { lobby: 'draw', draw: 'turn', turn: 'end', end: 'lobby' } as const;
const INK = '#1c1917';
const HIDDEN: CSSProperties = { opacity: 0 };
const ROOM: CSSProperties = { width: 1280, height: 720 };

/** The stage extras' rigs, loaded when the phase's files list them. */
function useExtra(name: string, phase: string): LoadedRig | null {
  const [rig, setRig] = useState<LoadedRig | null>(null);
  useEffect(() => {
    let live = true;
    void loadManifest(GAME_ID).then((m) => {
      const show = showFilesOf(m, 'stage');
      const path = (show as { extras?: Record<string, string> } | undefined)?.extras?.[name];
      if (!live || !show || !path || !show.phases[phase]?.includes(path)) return;
      void loadRig(GAME_ID, path).then((r) => {
        if (live && r) setRig(r);
      });
    });
    return () => {
      live = false;
    };
  }, [name, phase]);
  return rig;
}

/**
 * A part whose art changes mid-track (a pencil writing, the 3-2-1, the crown): every frame's art,
 * one shown at a time by the `data-show` its moment sets on the part's layer (the first until then).
 */
function SwapArt({
  rig,
  part,
  tint,
  label,
  last,
}: {
  rig: LoadedRig;
  part: string;
  tint?: string;
  /** The label whose art shows until a moment says otherwise (its first frame, or `last`). */
  label?: string;
  last?: boolean;
}) {
  const keys = useMemo(
    () => [part, ...Object.keys(rig.symbols).filter((k) => k.startsWith(part + '~'))],
    [rig, part],
  );
  const seq = label ? rig.swaps?.[part]?.[label] : undefined;
  const rest = (seq && (last ? seq.at(-1) : seq[0])?.[1]) ?? part;
  const css =
    `.vt-swap>[data-k]{display:none}.vt-swap>[data-k="${rest}"]{display:block}` +
    keys
      .map(
        (k) =>
          `[data-show]>.vt-swap>[data-k="${rest}"]{display:none}[data-show="${k}"]>.vt-swap>[data-k="${k}"]{display:block}`,
      )
      .join('');
  return (
    <div className="vt-swap" style={{ position: 'absolute', left: 0, top: 0 }}>
      <style>{css}</style>
      {keys.map((k) => (
        <div key={k} data-k={k}>
          <RigArt rig={rig} symbol={k} tint={tint} />
        </div>
      ))}
    </div>
  );
}

/** Live words on the paper, in the ink of the original's hand. */
function Ink({
  name,
  children,
  size = 40,
  style,
}: {
  name?: string;
  children?: ReactNode;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <Label name={name} style={{ color: INK, fontSize: size, fontWeight: 900, ...style }}>
      {children}
    </Label>
  );
}

export function SketchyStage({ view, room }: SketchyUiProps) {
  const manifest = useManifest();
  const m = manifestOf(manifest);
  const phase = phaseOf(view);
  const rig = useRig(GAME_ID, 'stage', phase, NEXT[phase]);
  const owl = useExtra('owl', phase);
  const cup = useExtra('cup', phase);
  const arm = useExtra('arm', phase);
  const paw = useExtra('catpaw', phase);
  const targets = useShowTargets();
  const { reduced, low } = useShowSettings();
  const offset = room.clockOffset;
  const seen = useSeen(view, offset);
  const [device] = useDeviceSound();
  const names = useMemo(() => view.seats.map((s) => s.name), [view.seats]);
  const audio = useSound({
    view,
    manifest,
    isHost: false,
    isStage: true,
    stagePresent: true,
    clockOffset: offset,
    device,
    onWords: (w) => {
      const el = targets.el('subtitle');
      if (el) el.textContent = w;
    },
  });
  const tracks = useMemo(
    () => ({ ...rig?.tracks, ...arm?.tracks, ...paw?.tracks, ...cup?.tracks }),
    [rig, arm, paw, cup],
  );
  const swaps = useMemo(() => ({ ...rig?.swaps, ...paw?.swaps }), [rig, paw]);
  const list = useMemo(
    () =>
      moments(view, {
        you: null,
        profile: 'stage',
        seen,
        parts: rig ? revealParts(rig.tracks) : { card: [], chooser: [], author: [] },
        swaps,
        jokeFor: (prompt) => jokeFor(m?.audio, m?.jokes, prompt, names),
      }),
    [view, seen, rig, swaps, m, names],
  );
  const name = (id: string) => nameOf(view, id);
  useShow(list, {
    clock: () => Date.now() + offset,
    profile: 'stage',
    you: null,
    reduced,
    low,
    tracks,
    el: targets.el,
    audio,
    words: (text) => text.replace(/\{p:([^}]+)\}/g, (_, id: string) => name(id)),
  });
  const colours = paintsOf(room.players);
  const paint = (id: string) => colours.get(id) ?? '#a8a29e';

  return (
    <ShowTargetsProvider targets={targets}>
      <div
        className="h-full w-full bg-stone-200 text-stone-900"
        data-theme="light"
        data-testid="sk-stage"
        data-phase={phase}
      >
        <ChipColours view={view} colours={colours} />
        <Scene
          background={
            rig ? (
              <Layer m={[1, 0, 0, 1, 640, 360]}>
                <RigArt rig={rig} symbol="paper" />
              </Layer>
            ) : (
              <div className="absolute left-0 top-0 bg-stone-100" style={ROOM} />
            )
          }
          overlay={
            <p
              ref={targets.ref('subtitle')}
              aria-live="polite"
              className="absolute bottom-3 left-1/2 max-w-[1000px] -translate-x-1/2 text-center text-2xl font-semibold text-stone-700"
            />
          }
        >
          {phase === 'lobby' && (
            <LobbyRoom
              view={view}
              rig={rig}
              owl={owl}
              title={room.gameName ?? 'Sketchy'}
              paint={paint}
            />
          )}
          {phase === 'draw' && <DrawRoom view={view} rig={rig} paint={paint} offset={offset} />}
          {phase === 'turn' && view.game?.turn && (
            <TurnRoom
              view={view}
              turn={view.game.turn}
              rig={rig}
              arm={arm}
              paint={paint}
              offset={offset}
            />
          )}
          {phase === 'end' && (
            <EndRoom
              view={view}
              rig={rig}
              owl={owl}
              cup={cup}
              paw={paw}
              paint={paint}
              endAt={seen[seenKeys(view)[0] ?? ''] ?? 0}
              offset={offset}
            />
          )}
        </Scene>
      </div>
    </ShowTargetsProvider>
  );
}

// ---- 1 the lobby ----

const TILE_K = 0.9;
function tileAt(i: number, n: number): number[] {
  const perRow = n <= 4 ? n : Math.ceil(n / 2);
  const row = Math.floor(i / perRow);
  const col = i % perRow;
  const inRow = row === 0 ? Math.min(perRow, n) : n - perRow;
  return [TILE_K, 0, 0, TILE_K, 640 + (col - (inRow - 1) / 2) * 250, 300 + row * 230];
}

function LobbyRoom({
  view,
  rig,
  owl,
  title,
  paint,
}: {
  view: SketchyView;
  rig: LoadedRig | null;
  owl: LoadedRig | null;
  title: string;
  paint: (id: string) => string;
}) {
  const seated = view.seats.filter((s) => s.playing);
  return (
    <>
      <Layer m={[1, 0, 0, 1, 640, 90]}>
        <Ink size={72}>{title}</Ink>
      </Layer>
      <Layer m={[1, 0, 0, 1, 640, 160]}>
        <Ink size={28} style={{ fontWeight: 600 }}>
          {seated.length < 3 ? 'Waiting for players…' : 'Everybody in? The host starts the game.'}
        </Ink>
      </Layer>
      {seated.map((s, i) => (
        <Layer key={s.id} m={tileAt(i, seated.length)}>
          {rig ? (
            <>
              {/* The empty seat's question mark, gone once the player is in. */}
              <Layer m={placeOf(rig, 'tile-questionMark')}>
                <Layer
                  name={`qmark:${s.id}/qmark-ring`}
                  moving
                  style={restOf(rig.tracks['qmark-ring']?.Disappear)}
                >
                  <RigArt rig={rig} symbol="qmark-ring" />
                </Layer>
                <Layer
                  name={`qmark:${s.id}/qmark-qMark`}
                  moving
                  style={restOf(rig.tracks['qmark-qMark']?.Disappear)}
                >
                  <RigArt rig={rig} symbol="qmark-qMark" />
                </Layer>
              </Layer>
              {/* The player: their colour where the original shows their self-portrait. */}
              <Layer m={[1, 0, 0, 1, 0, -5]}>
                <Layer name={`tilePic:${s.id}`} moving>
                  <div
                    className="absolute size-24 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-stone-900"
                    style={{ background: paint(s.id) }}
                  />
                </Layer>
              </Layer>
              <Layer
                name={`tile:${s.id}/tile-playerName`}
                moving
                style={restOf(rig.tracks['tile-playerName']?.TransitionToPicture)}
              >
                <Layer m={[1, 0, 0, 1, 103, 22]}>
                  <Ink size={30}>{s.name}</Ink>
                </Layer>
              </Layer>
            </>
          ) : (
            <>
              <div
                className="absolute size-24 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-stone-900"
                style={{ background: paint(s.id) }}
              />
              <Layer m={[1, 0, 0, 1, 0, 105]}>
                <Ink size={30}>{s.name}</Ink>
              </Layer>
            </>
          )}
        </Layer>
      ))}
      {owl && <Owl owl={owl} m={[0.6, 0, 0, 0.6, 1150, 560]} />}
    </>
  );
}

/** The host's owl in its costume of the day, its line boil looping (table screen only). */
function Owl({ owl, m }: { owl: LoadedRig; m: number[] }) {
  const costumes = Object.keys(owl.symbols).filter((k) => k.startsWith('costume.'));
  const [day] = useState(() => Math.floor(Date.now() / 86_400_000));
  const costume = costumes.length ? costumes[variantOf(day, costumes.length)] : null;
  return (
    <Layer m={m}>
      <Boil rig={owl} part="owlBody-d1" />
      <Boil rig={owl} part="owlBody-d2" />
      <Boil rig={owl} part="owlEyes" />
      {costume && <RigArt rig={owl} symbol={costume} />}
    </Layer>
  );
}

/** A frame-by-frame loop (the owl's line boil): steps through its swaps on a timer, stage only. */
function Boil({ rig, part }: { rig: LoadedRig; part: string }) {
  const seq = useMemo(() => rig.swaps?.[part]?.Loop ?? [], [rig, part]);
  const ms = rig.tracks[part]?.Loop?.ms ?? 1000;
  const [i, setI] = useState(0);
  const { reduced } = useShowSettings();
  useEffect(() => {
    if (seq.length < 2 || reduced) return;
    const start = Date.now();
    const id = setInterval(() => {
      const t = (Date.now() - start) % ms;
      let k = 0;
      while (k + 1 < seq.length && seq[k + 1]![0] <= t) k++;
      setI(k);
    }, 66);
    return () => {
      clearInterval(id);
    };
  }, [seq, ms, reduced]);
  const key = seq[i]?.[1] ?? part;
  if (!rig.symbols[key]) return null;
  return <RigArt rig={rig} symbol={key} />;
}

// ---- 2-4 drawing time ----

function useNow(offset: number, every: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now() + offset), every);
    return () => {
      clearInterval(id);
    };
  }, [offset, every, on]);
  return now;
}

/** Seconds left on the stage's clock, ticking (the table screen only). */
function useSecondsLeft(deadline: number | null, offset: number): number | null {
  const now = useNow(offset, 250, deadline !== null);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * Writing and picking's clock, as the original's: the drawn arm holds a row of numbers 5 s apart
 * along the bottom; each goes as its time passes (its sting is the moment's).
 */
function NumberRow({
  view,
  arm,
  offset,
}: {
  view: SketchyView;
  arm: LoadedRig | null;
  offset: number;
}) {
  const g = view.game!;
  const left = useSecondsLeft(g.deadline, offset);
  if (left === null || g.deadline === null) return null;
  const total = Math.round((g.deadline - g.since) / 1000);
  const marks: number[] = [];
  for (let s = TIMER_STEP_S; s <= total; s += TIMER_STEP_S) marks.push(s);
  const span = 780;
  return (
    <Layer m={[1, 0, 0, 1, 0, 660]}>
      {arm && (
        <Layer name="arm" moving style={restOf(arm.tracks.arm?.Appear)}>
          <Layer m={[0.5, 0, 0, 0.5, 1100, -30]}>
            <RigArt rig={arm} symbol="arm" />
          </Layer>
        </Layer>
      )}
      {marks.map((s, i) => (
        <Layer key={s} m={[1, 0, 0, 1, 190 + (i * span) / Math.max(1, marks.length - 1), 0]}>
          <Layer name={`tick:${s}`} moving style={{ opacity: s < left + TIMER_STEP_S ? 1 : 0.15 }}>
            <Ink size={s <= 10 ? 44 : 34} style={{ color: s <= 10 ? '#b91c1c' : INK }}>
              {s}
            </Ink>
          </Layer>
        </Layer>
      ))}
      <Layer name="clock" style={{ opacity: 0 }}>
        <span data-testid="sk-stage-clock">{left}</span>
      </Layer>
    </Layer>
  );
}

/** Where drawing time's rows run, from the original's layouts: [y, from x, to x, scale]. */
function drawRows(rig: LoadedRig | null, n: number): [number, number, number, number][] {
  const list = (rig?.places[`drawIn.Players${Math.min(8, Math.max(3, n))}`] as number[][]) ?? [];
  const at = (rig && placeOf(rig, 'drawIn.at')) ?? [1, 0, 0, 1, 0, 0];
  if (!list.length)
    return Array.from({ length: n }, (_, i) => [180 + i * (420 / Math.max(1, n - 1)), 1250, 40, 1]);
  return list.slice(0, n).map((m) => {
    const a = m[0]!;
    const k = Math.abs(a);
    // The pencil starts at 735 and ends at -24 in its row (its own units), mirrored rows the other way.
    const x = (v: number) => at[4]! + m[4]! + a * v;
    const clamp = (v: number) => Math.min(1220, Math.max(60, v));
    return [at[5]! + m[5]! + k * 9, clamp(x(735)), clamp(x(-24)), Math.min(k, 1.4)];
  });
}

function DrawRoom({
  view,
  rig,
  paint,
  offset,
}: {
  view: SketchyView;
  rig: LoadedRig | null;
  paint: (id: string) => string;
  offset: number;
}) {
  const g = view.game!;
  const rows = drawRows(rig, g.players.length);
  // The pencils inch across for the whole drawing time (one inch every 1/80 of it, as the original).
  const timed = g.deadline !== null;
  const now = useNow(offset, 400, timed);
  const share = timed ? Math.min(1, Math.max(0, (now - g.since) / (g.deadline! - g.since))) : 0;
  const inch = Math.floor(share * 80) / 80;
  return (
    <>
      <Layer m={[1, 0, 0, 1, 640, 80]}>
        <Layer name="banner" moving style={rig ? HIDDEN : undefined}>
          <Ink size={84}>It’s drawing time!</Ink>
        </Layer>
      </Layer>
      {rig && g.round === 1 && (
        <Layer m={[1, 0, 0, 1, 640, 360]}>
          {(['count-countdownBG', 'count-device'] as const).map((p) =>
            rig.symbols[p] ? (
              <Layer
                key={p}
                name={`count/${p}`}
                moving
                style={restOf(rig.tracks[p]?.GameStartAppear)}
              >
                <RigArt rig={rig} symbol={p} />
              </Layer>
            ) : null,
          )}
          <Layer
            name="count/count-d3"
            moving
            style={restOf(rig.tracks['count-d3']?.GameStartAppear)}
          >
            <SwapArt rig={rig} part="count-d3" />
          </Layer>
        </Layer>
      )}
      {g.players.map((id, i) => {
        const [y, from, to, k] = rows[i] ?? [200 + i * 60, 1250, 40, 1];
        const done = g.drawn.includes(id);
        const x = from + (to - from) * inch;
        const left = to < from;
        const lineFrom = left ? x : Math.min(from, to);
        const lineTo = left ? Math.max(from, to) : x;
        const name = view.seats.find((s) => s.id === id)?.name;
        return (
          <Layer key={id} m={[1, 0, 0, 1, 0, y]}>
            {/* The line the pencil has drawn so far, in the player's colour. */}
            {rig ? (
              <div
                className="absolute overflow-hidden"
                style={{
                  left: lineFrom,
                  width: Math.max(0, lineTo - lineFrom),
                  top: 0,
                  height: 20 * k,
                  opacity: 0.7,
                }}
              >
                <Layer m={[k, 0, 0, k, left ? -lineFrom + Math.min(from, to) : 0, 0]}>
                  <RigArt rig={rig} symbol="drawLine" tint={paint(id)} />
                </Layer>
              </div>
            ) : null}
            <Layer m={[1, 0, 0, 1, x, 0]} style={{ transition: 'transform 0.4s linear' }}>
              {rig && !done && (
                <Layer m={[left ? k : -k, 0, 0, k, 0, -20 * k]}>
                  <Layer
                    name={`pencilBox:${id}/pencilBox-container`}
                    moving
                    style={restOf(rig.tracks['pencilBox-container']?.Appear)}
                  >
                    <Layer name={`fill:${id}`} moving>
                      <SwapArt rig={rig} part="wormFill" tint={paint(id)} label="Draw" />
                    </Layer>
                    <Layer name={`worm:${id}`} moving>
                      <SwapArt rig={rig} part="worm" label="Draw" />
                    </Layer>
                  </Layer>
                </Layer>
              )}
              <Layer name={`drawn:${id}`} moving style={done ? undefined : HIDDEN}>
                <span
                  className="absolute size-14 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-stone-900"
                  style={{ background: paint(id) }}
                />
              </Layer>
              <Layer m={[1, 0, 0, 1, 0, 52]}>
                <Ink size={24}>
                  {done ? '✓ ' : ''}
                  {name}
                </Ink>
              </Layer>
            </Layer>
          </Layer>
        );
      })}
      {!timed && (
        <Layer m={[1, 0, 0, 1, 640, 690]}>
          <Ink size={26} style={{ fontWeight: 600 }}>
            {g.drawn.length} of {g.players.length} drawings in
          </Ink>
        </Layer>
      )}
    </>
  );
}

// ---- 5-12 a drawing on the table ----

/** The drawing's canvas, the original's 240 × 320 (its container's tracks place and scale it). */
const CANVAS: CSSProperties = { left: 0, top: 0, width: 240, height: 320 };

/** Where answer `i` of `n` sits round the drawing (the original's layouts per count). */
function choiceAt(rig: LoadedRig | null, i: number, n: number): number[] {
  const names = ['Three', 'Three', 'Three', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
  const list = rig?.places[`choices.${names[Math.min(8, n)]}Choices`] as number[][] | undefined;
  const at = (rig && placeOf(rig, 'choices.at')) ?? [1, 0, 0, 1, 39, 194];
  // The first place is the layout's centre locator; the answers' come after it.
  const m = list?.[i + 1];
  if (!m) return [1, 0, 0, 1, i % 2 ? 860 : 120, 120 + Math.floor(i / 2) * 150];
  return [m[0]!, m[1]!, m[2]!, m[3]!, at[4]! + m[4]!, at[5]! + m[5]!];
}

/** The reveal's step now (an index into the order), changing exactly on each step's boundary. */
function useRevealStep(turn: TurnView, offset: number): number | null {
  const end = revealEndOf(turn);
  const start = turn.revealAt;
  const at = () => {
    const now = Date.now() + offset;
    if (start === null || end === null || now >= end) return null;
    return Math.max(0, Math.floor((now - start) / REVEAL_STEP_MS));
  };
  const [state, setState] = useState(() => ({ start, step: at() }));
  // A new reveal is picked up in the same render, so the card is there when its moments start.
  if (state.start !== start) setState({ start, step: at() });
  const step = state.start === start ? state.step : null;
  const setStep = (v: number | null) => setState({ start, step: v });
  useEffect(() => {
    if (start === null || end === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setStep(at());
      const now = Date.now() + offset;
      if (now >= end) return;
      const next = start + (Math.floor((now - start) / REVEAL_STEP_MS) + 1) * REVEAL_STEP_MS;
      timer = setTimeout(tick, Math.max(0, next - now) + 5);
    };
    tick();
    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `at` reads the same inputs
  }, [start, end, offset]);
  return step;
}

function TurnRoom({
  view,
  turn,
  rig,
  arm,
  paint,
  offset,
}: {
  view: SketchyView;
  turn: TurnView;
  rig: LoadedRig | null;
  arm: LoadedRig | null;
  paint: (id: string) => string;
  offset: number;
}) {
  const g = view.game!;
  const stage = g.stage;
  const step = useRevealStep(turn, offset);
  const boardUp = stage === 'reveal' && step === null;
  const order = revealOrder(turn.options);
  const T = rig?.tracks;
  const shown = new Set(stage === 'reveal' && step !== null ? order.slice(step) : []);
  // Where the drawing rests: up for writing and picking, aside for the cards, then beside the
  // scoreboard (the original's poses; a short slide between them).
  const pose = stage !== 'reveal' ? 'Appear' : boardUp ? 'Move' : 'RevealMove';
  const fade = (on: boolean): CSSProperties => ({
    opacity: on ? 1 : 0,
    transition: 'opacity 0.3s',
  });
  return (
    <>
      <Layer
        style={{
          ...(T
            ? restOf(T['drawing-container']?.[pose])
            : { transform: 'matrix(1.458,0,0,1.458,464,132)' }),
          transition: 'transform 0.5s ease-out',
        }}
      >
        <div
          className="absolute overflow-hidden rounded-sm bg-white shadow-lg ring-1 ring-stone-800"
          style={CANVAS}
          data-testid="sk-stage-drawing"
        >
          {turn.drawing && !turn.hidden ? (
            <DrawingView
              drawing={turn.drawing}
              label="The drawing on the table"
              className="h-full w-full"
            />
          ) : (
            <p className="grid h-full place-items-center text-lg font-bold text-stone-700">
              {turn.hidden ? '🙈 Hidden by the host' : 'No drawing'}
            </p>
          )}
        </div>
      </Layer>
      {stage === 'write' && (
        <Layer m={[1, 0, 0, 1, 640, 65]}>
          <Ink size={56}>What is it?</Ink>
        </Layer>
      )}
      {boardUp && turn.prompt && (
        <Layer
          m={
            (T && T['drawing-finalTitle']
              ? T['drawing-finalTitle'].Move?.frames.at(-1)?.slice(0, 6)
              : undefined) ?? [1, 0, 0, 1, 72, 494]
          }
        >
          <Layer m={[1, 0, 0, 1, 160, 30]}>
            <Ink size={30}>“{turn.prompt}”</Ink>
          </Layer>
          {turn.artist && (
            <Layer m={[1, 0, 0, 1, 160, 74]}>
              <Ink size={22} style={{ fontWeight: 600 }}>
                drawn by {nameOf(view, turn.artist)}
              </Ink>
            </Layer>
          )}
        </Layer>
      )}
      {stage === 'write' && <Writers turn={turn} rig={rig} />}
      {(stage === 'vote' || (stage === 'reveal' && !boardUp)) &&
        turn.options.map((o, i) =>
          stage === 'reveal' && !shown.has(o.index) ? null : (
            <Layer key={o.index} m={choiceAt(rig, i, turn.options.length)}>
              {/* The reveal's dimming is React's, on its own layer: the vote's pop settling on the
                  named one must never bring a label back under the card. */}
              <Layer
                style={
                  stage === 'reveal' ? { opacity: order[step!] === o.index ? 0 : 0.35 } : undefined
                }
              >
                <Layer name={`choice:${o.index}`} moving>
                  <Layer m={[1, 0, 0, 1, 104, 48]}>
                    <Label
                      style={{
                        color: INK,
                        fontSize: 30,
                        fontWeight: 800,
                        whiteSpace: 'normal',
                        width: 330,
                        textAlign: 'center',
                        lineHeight: 1.05,
                      }}
                    >
                      {o.text}
                    </Label>
                  </Layer>
                </Layer>
              </Layer>
            </Layer>
          ),
        )}
      {stage === 'vote' && (
        <Layer m={[1, 0, 0, 1, 640, 40]}>
          <Ink size={26} style={{ fontWeight: 600 }}>
            {turn.done} of {turn.writerCount} picked
          </Ink>
        </Layer>
      )}
      {stage === 'vote' &&
        Array.from({ length: turn.done }, (_, k) => (
          <Layer key={k} m={[1, 0, 0, 1, 560 + k * 30, 78]}>
            <Layer name={`voted:${k}`} moving>
              <Ink size={26}>✓</Ink>
            </Layer>
          </Layer>
        ))}
      {/* The card and the scoreboard stay in place for the whole reveal (each step's moments
          find their parts there), shown by turns. */}
      {stage === 'reveal' && (
        <Layer style={fade(!boardUp)}>
          <Reveal
            turn={turn}
            rig={rig}
            step={step ?? Math.max(0, order.length - 1)}
            order={order}
            paint={paint}
          />
        </Layer>
      )}
      {stage === 'reveal' && (
        <Layer style={fade(boardUp)}>
          <Board view={view} turn={turn} rig={rig} paint={paint} />
        </Layer>
      )}
      {(stage === 'write' || stage === 'vote') && (
        <NumberRow view={view} arm={arm} offset={offset} />
      )}
    </>
  );
}

/** One pencil per writer (who writes stays hidden), each breaking as a title comes in. */
function Writers({ turn, rig }: { turn: TurnView; rig: LoadedRig | null }) {
  return (
    <>
      <Layer m={[1, 0, 0, 1, 1060, 300]}>
        <Ink size={26} style={{ fontWeight: 600 }}>
          <span data-testid="sk-stage-progress">
            {turn.done} of {turn.writerCount} titles in
          </span>
        </Ink>
      </Layer>
      {rig &&
        Array.from({ length: turn.writerCount }, (_, k) => (
          <Layer key={k} m={[1.6, 0, 0, 1.6, 900 + (k % 4) * 90, 380 + Math.floor(k / 4) * 90]}>
            <Layer
              name={`pencil:${k}`}
              moving
              style={restOf(rig.tracks.worm?.[k < turn.done ? 'Break' : 'Draw'])}
            >
              <SwapArt
                rig={rig}
                part="worm"
                label={k < turn.done ? 'Break' : 'Draw'}
                last={k < turn.done}
              />
            </Layer>
          </Layer>
        ))}
    </>
  );
}

/** Words over the art: ink on a paper pill, readable on any balloon. */
const PILL: CSSProperties = {
  color: INK,
  fontSize: 32,
  fontWeight: 900,
  background: '#fbf8f1',
  padding: '2px 14px',
  borderRadius: 999,
  boxShadow: '0 0 0 2px #1c1917',
};

/** A darker shade of a paint, for the balloon a lie turns into (the original: the author's dark colour). */
const shade = (hex: string) => `color-mix(in srgb, ${hex} 70%, black)`;

/**
 * The answer being turned over: the original's card at that answer's place round the drawing, its
 * balloon in the author's colour, the choosers' names at the card's own spots, the author's name,
 * and for the truth its glow and the artist. One card for the whole reveal (each step's moment
 * replays it), moved to the step's answer.
 */
function Reveal({
  turn,
  rig,
  step,
  order,
  paint,
}: {
  turn: TurnView;
  rig: LoadedRig | null;
  step: number;
  order: number[];
  paint: (id: string) => string;
}) {
  const index = order[step]!;
  const o = turn.options.find((x) => x.index === index)!;
  const i = turn.options.indexOf(o);
  const author = o.authors?.[0];
  const chips = (rig?.places['chips.initial'] as number[][] | undefined) ?? [];
  const words = (
    <Label
      name="card.text"
      className="vt-card-text"
      style={{
        color: INK,
        fontSize: 30,
        fontWeight: 800,
        whiteSpace: 'normal',
        width: 330,
        textAlign: 'center',
        lineHeight: 1.05,
      }}
    >
      {o.text}
    </Label>
  );
  if (!rig)
    return (
      <Layer m={[1, 0, 0, 1, 860, 330]}>
        <PlainCard />
      </Layer>
    );
  return (
    <Layer m={choiceAt(rig, i, turn.options.length)}>
      <style>{CARD_CSS}</style>
      <RevealCard
        rig={rig}
        className="vt-card"
        style={{ '--c': author ? shade(paint(author)) : '#1c1917' } as CSSProperties}
        live={{
          'card-bubble': (
            <>
              <div className="vt-balloon">
                <RigArt rig={rig} symbol="balloon" tint />
              </div>
              <div className="vt-balloon-house">
                <RigArt rig={rig} symbol="balloonDecoy" />
              </div>
            </>
          ),
          'card-titlename': <Layer m={[1, 0, 0, 1, 104, 48]}>{words}</Layer>,
          // The choosers' names sit a little higher than the original's spots, clear of the title.
          'card-playersWhoChose': (
            <Layer m={[1, 0, 0, 1, 0, -40]}>
              {chips.map((m, k) => (
                <Layer key={k} m={m}>
                  <Chooser
                    rig={rig}
                    k={k}
                    nameStyle={{ color: INK, fontSize: 46, fontWeight: 900 }}
                    pointsStyle={{ color: '#15803d', fontSize: 34, fontWeight: 900 }}
                  />
                </Layer>
              ))}
            </Layer>
          ),
          'card-author': (
            <Layer m={placeOf(rig, 'author.right')}>
              {(['author-tf', 'author-playerIcon'] as const).map((part) => (
                <Layer key={part} name={`author/${part}`} moving style={HIDDEN}>
                  {part === 'author-playerIcon' && author ? (
                    <>
                      <span
                        className="absolute size-10 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-stone-900"
                        style={{ background: paint(author) }}
                      />
                      <Layer m={[1, 0, 0, 1, 34, 0]}>
                        <Label
                          name="author.name"
                          style={{ ...PILL, transform: 'translate(0, -50%)' }}
                        />
                      </Layer>
                      <Layer m={[1, 0, 0, 1, 34, 48]}>
                        <Label
                          name="author.points"
                          style={{
                            color: '#15803d',
                            fontSize: 36,
                            fontWeight: 900,
                            transform: 'translate(0, -50%)',
                          }}
                        />
                      </Layer>
                    </>
                  ) : null}
                </Layer>
              ))}
            </Layer>
          ),
          // The artist (the original's slot under the truth): a pill with their name, their points
          // beside it; the original's placeholder avatar is left out.
          'card-artist': turn.artist ? (
            <Layer name="artist/artist-artistName" moving style={HIDDEN}>
              {/* Under the title, clear of the choosers' names above it. */}
              <Layer m={[1, 0, 0, 1, 90, 150]}>
                <span
                  className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
                  style={{ ...PILL, fontSize: 50, display: 'flex', alignItems: 'center', gap: 12 }}
                >
                  <span
                    className="inline-block size-9 rounded-full ring-4 ring-stone-900"
                    style={{ background: paint(turn.artist) }}
                  />
                  drawn by{' '}
                  <Ink
                    name="artist.name"
                    size={50}
                    style={{ position: 'static', transform: 'none' }}
                  />
                </span>
                {/* The points beside the pill, clear of the title below it. */}
                <Layer m={[1, 0, 0, 1, 250, 0]}>
                  <Ink
                    name="artist.points"
                    size={56}
                    style={{ color: '#15803d', transform: 'translate(0, -50%)' }}
                  />
                </Layer>
              </Layer>
            </Layer>
          ) : null,
        }}
      />
    </Layer>
  );
}

/** Lies turn white on their coloured balloon; a house title shows the original's starburst. */
const CARD_CSS =
  '.vt-card .vt-balloon-house{display:none}.vt-card[data-face=house] .vt-balloon-house{display:block}' +
  '.vt-card[data-face=house] .vt-balloon{display:none}' +
  '.vt-card[data-face=lie] .vt-card-text,.vt-card[data-face=house] .vt-card-text{color:#fff!important}';

/** Without the art: the answer being turned over in words (the moments fill and flip it). */
function PlainCard() {
  const ref = useTarget('card');
  const textRef = useTarget('card.text');
  const authorsRef = useTarget('card.authors');
  return (
    <div
      ref={ref}
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 text-center"
      style={{ width: 460 }}
      data-testid="sk-stage-card"
    >
      <span ref={textRef} className="text-5xl font-black" />
      <span ref={authorsRef} className="text-3xl font-bold text-rose-700" />
    </div>
  );
}

/**
 * The board waiting for Next: the original's scoreboard beside the drawing, a balloon per player
 * with their name, their likes on this drawing, and their score bar with the rank.
 */
function Board({
  view,
  turn,
  rig,
  paint,
}: {
  view: SketchyView;
  turn: TurnView;
  rig: LoadedRig | null;
  paint: (id: string) => string;
}) {
  const g = view.game!;
  const ranked = view.scores.filter((s) => g.players.includes(s.id) || s.score > 0).slice(0, 8);
  const n = Math.min(8, Math.max(3, ranked.length));
  const slots = (rig?.places[`board.NumPlayersIs${n}`] as number[][] | undefined) ?? [];
  const at = (rig && placeOf(rig, 'board.at')) ?? [1, 0, 0, 1, 380, 51];
  const likesOf = (id: string) =>
    turn.options
      .filter((o) => (o.authors ?? []).includes(id))
      .reduce((s, o) => s + (o.likes ?? 0), 0);
  const gained = turn.points ?? {};
  return (
    <Layer name="board" moving>
      {ranked.map((s, i) => {
        const m = slots[i] ?? [0.885, 0, 0, 0.885, 212 + (i >= 4 ? 215 : 0), (i % 4) * 155];
        const likes = likesOf(s.id);
        return (
          <Layer key={s.id} m={[m[0]!, 0, 0, m[3]!, at[4]! + m[4]!, at[5]! + m[5]!]}>
            {rig ? (
              <>
                {/* As the original: the blue balloon holds the name, then flips round to the
                    score bar (the rank in its yellow end, the score in the orange). */}
                <Layer name={`score:${s.id}/bar`} moving>
                  <RigArt rig={rig} symbol="scoreRow.score" />
                  <Layer m={[1, 0, 0, 1, 28, 83]}>
                    <Label style={{ color: INK, fontSize: 34, fontWeight: 900 }}>{i + 1}</Label>
                  </Layer>
                  {/* Whose bar it is stays on it once the rows reshuffle (the balloon's name). */}
                  <Layer m={[1, 0, 0, 1, 166, 62]}>
                    <span
                      className="absolute -translate-x-1/2 -translate-y-1/2 truncate whitespace-nowrap font-bold"
                      style={{ color: '#fff', fontSize: 22, maxWidth: 220 }}
                    >
                      <span
                        className="mr-1.5 inline-block size-4 rounded-full ring-2 ring-white"
                        style={{ background: paint(s.id) }}
                      />
                      {s.name}
                    </span>
                  </Layer>
                  <Layer m={[1, 0, 0, 1, 166, 96]}>
                    <Label style={{ color: '#fff', fontSize: 32, fontWeight: 900 }}>
                      {points(s.score)}
                    </Label>
                  </Layer>
                </Layer>
                <Layer name={`score:${s.id}/balloon`} moving style={HIDDEN}>
                  <RigArt rig={rig} symbol="scoreRow.balloon" />
                  <Layer m={[1, 0, 0, 1, 139, 83]}>
                    <span
                      className="absolute -translate-x-1/2 -translate-y-1/2 truncate whitespace-nowrap text-center font-black"
                      style={{ color: '#fff', fontSize: 34, maxWidth: 250 }}
                    >
                      <span
                        className="mr-2 inline-block size-6 rounded-full ring-2 ring-white"
                        style={{ background: paint(s.id) }}
                      />
                      {s.name}
                    </span>
                  </Layer>
                </Layer>
                {(gained[s.id] ?? 0) > 0 && (
                  <Layer m={[0.7, 0, 0, 0.7, 150, -20]}>
                    <Layer name={`score:${s.id}/pop`} moving style={HIDDEN}>
                      <RigArt rig={rig} symbol="score-scorePop" />
                      <Layer m={[1, 0, 0, 1, 107, 30]}>
                        <Label style={{ color: '#15803d', fontSize: 40, fontWeight: 900 }}>
                          +{points(gained[s.id]!)}
                        </Label>
                      </Layer>
                    </Layer>
                  </Layer>
                )}
              </>
            ) : null}
            {!rig && (
              <Layer m={[1, 0, 0, 1, 0, 82]}>
                <span
                  className="absolute -translate-y-1/2 whitespace-nowrap text-[28px] font-black"
                  style={{ color: INK }}
                >
                  {i + 1}.{' '}
                  <span
                    className="mr-2 inline-block size-5 rounded-full ring-2 ring-stone-900"
                    style={{ background: paint(s.id) }}
                  />
                  {s.name} · {points(s.score)}
                </span>
              </Layer>
            )}
            {likes > 0 && (
              <Layer
                m={
                  placeOf(rig ?? ({ places: {} } as unknown as LoadedRig), 'score-likes') ?? [
                    0.58, 0, 0, 0.58, 268, 56,
                  ]
                }
              >
                {rig && <RigArt rig={rig} symbol="score-likes" />}
                <Layer m={[1, 0, 0, 1, 150, 30]}>
                  <Ink name={`thumb:${s.id}.n`} size={44}>
                    {rig ? likes : `👍 ${likes}`}
                  </Ink>
                </Layer>
              </Layer>
            )}
            <Layer
              m={[1, 0, 0, 1, 300, 70]}
              name={`streak:${s.id}`}
              moving
              style={(g.streaks[s.id] ?? 0) >= 2 ? undefined : HIDDEN}
            >
              <Ink size={30}>🔥{g.streaks[s.id] ?? ''}</Ink>
            </Layer>
          </Layer>
        );
      })}
      <Layer m={[1, 0, 0, 1, 1000, 700]}>
        <Ink size={22} style={{ fontWeight: 600 }}>
          {turn.number >= turn.of && g.round >= g.rounds ? 'Last drawing! ' : ''}The host moves on
        </Ink>
      </Layer>
    </Layer>
  );
}

// ---- 13, 14 the end ----

/**
 * The end, in the original's order: the final scores (they come on from last place to first),
 * the winners with the fireworks, then the likes award: a column per player in the cup, the hand
 * and the cat paw taking turns, each rising to its likes, the crown on the most liked.
 */
function EndRoom({
  view,
  rig,
  owl,
  cup,
  paw,
  paint,
  endAt,
  offset,
}: {
  view: SketchyView;
  rig: LoadedRig | null;
  owl: LoadedRig | null;
  cup: LoadedRig | null;
  paw: LoadedRig | null;
  paint: (id: string) => string;
  /** When this screen saw the game end, on the server clock (0: long before). */
  endAt: number;
  offset: number;
}) {
  // What lasts is set from the end's own clock (the moments only add the motion), so a screen
  // arriving late lands on the right beat.
  const T = endTimes(view);
  const now = useNow(offset, 250, endAt > 0);
  const since = endAt > 0 ? now - endAt : Infinity;
  const on = (t: number): CSSProperties => ({ opacity: since >= t ? 1 : 0 });
  const liked = mostLiked(view);
  const top = Math.max(0, ...view.scores.map((s) => s.score));
  const winners = top > 0 ? view.scores.filter((s) => s.score === top) : [];
  const shown = view.scores.slice(0, 8);
  const n = Math.min(8, Math.max(3, shown.length));
  const cols = (cup?.places[`cup.${n}Player`] as number[][] | undefined) ?? [];
  const cupAt = (cup && placeOf(cup, 'cup.at')) ?? [1, 0, 0, 1, 70, 47];
  const maxLikes = Math.max(1, ...shown.map((s) => s.likes));
  return (
    <>
      <Layer name="final" moving>
        <Layer m={[1, 0, 0, 1, 640, 56]}>
          <Ink size={52}>Final scores</Ink>
        </Layer>
        {view.scores.slice(0, 10).map((s, i) => (
          <Layer key={s.id} m={[1, 0, 0, 1, 640, 130 + i * 50]}>
            <Layer style={rig ? on(T.first + (view.scores.length - 1 - i) * T.each) : undefined}>
              <Layer name={`final:${s.id}`} moving>
                <span
                  className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[34px] font-black"
                  style={{ color: INK }}
                >
                  <span
                    className="mr-3 inline-block size-7 rounded-full ring-2 ring-stone-900"
                    style={{ background: paint(s.id) }}
                  />
                  {i + 1}. {s.name} · {points(s.score)}
                </span>
              </Layer>
            </Layer>
          </Layer>
        ))}
      </Layer>
      <Layer m={[1, 0, 0, 1, 640, 590]}>
        <Layer style={rig ? on(T.winner) : undefined}>
          <Layer name="winners" moving>
            {rig && <RigArt rig={rig} symbol="winners" />}
            <Ink size={52} style={{ color: '#b45309' }}>
              <span data-testid="sk-stage-winner">
                {winners.length === 0
                  ? 'Nobody scored!'
                  : `${winners.map((w) => w.name).join(' & ')} ${winners.length === 1 ? 'wins' : 'share the win'}!`}
              </span>
            </Ink>
          </Layer>
        </Layer>
      </Layer>
      {rig && (
        <Layer name="fireworks" style={on(T.winner)}>
          {(['firework1', 'firework2', 'firework3', 'burst', 'star'] as const).map((f, i) => (
            <Layer key={f} m={[0.8, 0, 0, 0.8, 160 + i * 240, 140 + (i % 2) * 380]}>
              <Boil rig={rig} part={f} />
            </Layer>
          ))}
        </Layer>
      )}
      {liked.length > 0 && rig && (
        <Layer style={on(T.likes)}>
          <div className="absolute bg-stone-100" style={ROOM} />
          <Layer m={[1, 0, 0, 1, 640, 44]}>
            <Ink size={44}>Most liked</Ink>
          </Layer>
          <Layer m={[1, 0, 0, 1, 640, 104]}>
            <Ink name="likes.name" size={32} />
          </Layer>
          {shown.map((s, k) => {
            // The original's columns per player count; each arm's fist rises to its share of
            // the likes (0 likes: just above the floor).
            const m = cols[k];
            const x = m ? cupAt[4]! + m[4]! + 70 : 140 + k * 150;
            const share = s.likes / maxLikes;
            const fist = 560 - 360 * share;
            const hand = k % 2 === 0 || !paw;
            return (
              <Layer key={s.id} m={[1, 0, 0, 1, x, 0]}>
                <Layer name={`cup:${s.id}`} moving>
                  <Layer m={[0.7, 0, 0, 0.7, -60, fist - 34]}>
                    <Layer name={`cup:${s.id}/arm`} moving>
                      <RigArt rig={hand ? rig : paw} symbol={hand ? 'thumb' : 'catThumb'} />
                    </Layer>
                  </Layer>
                </Layer>
                {liked.includes(s.id) && s.id === liked[0] && (
                  <Layer m={[0.8, 0, 0, 0.8, 0, fist - 70]}>
                    <Layer style={on(T.crown)}>
                      <Layer name="crown" moving>
                        <SwapArt rig={rig} part="crown" label="Glow" last />
                      </Layer>
                    </Layer>
                  </Layer>
                )}
                <Layer m={[1, 0, 0, 1, 0, 680]}>
                  <Label style={{ ...PILL, fontSize: 24 }}>{`${s.name} · ${s.likes}`}</Label>
                </Layer>
              </Layer>
            );
          })}
        </Layer>
      )}
      {owl && <Owl owl={owl} m={[0.45, 0, 0, 0.45, 1170, 600]} />}
    </>
  );
}
