import { ProtectedImage, cn } from '@vt/ui';
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
import { NEEDY_TIME, leftAt, needyLeft, timerText } from '../logic/bomb.ts';
import { GLYPHS, MORSE } from '../logic/data.ts';
import { HOLD_AFTER, SIMON_COLOURS, SIMON_NOTE, SIMON_REPLAY } from '../logic/modules.ts';
import type { Dir, Kind, ModuleOp, NeedyModule } from '../logic/types.ts';
import type { BombView, ModuleView } from '../logic/view.ts';
import type { Art, ArtKind, Box } from './assets.ts';
import { SIMON_TONES, player } from './sound.ts';

// vt-palette: the module's own colours, part of what the defuser describes
export const PAINT: Record<string, string> = {
  black: '#1c1917',
  blue: '#2563eb',
  red: '#dc2626',
  white: '#f5f5f4',
  yellow: '#facc15',
  green: '#16a34a',
};

export type Send = (op: ModuleOp) => void;

export interface ModuleProps {
  m: ModuleView;
  b: BombView;
  art: Art;
  now: number;
  /** null on a read-only screen (the table screen, a thumbnail, the results). */
  send: Send | null;
  /** A thumbnail on the bomb's face: no controls. */
  mini?: boolean;
  /** Whether the manifest has this module's renders. */
  drawn: boolean;
}

const at = ([x, y, w, h]: Box): CSSProperties => ({
  position: 'absolute',
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  width: `${w * 100}%`,
  height: `${h * 100}%`,
});

const TEXT = (cqw: number): CSSProperties => ({ fontSize: `${cqw}cqw`, lineHeight: 1.1 });

/** The renders: every layer's current part (its default unless the state says otherwise) over the base. */
function Layers({ kind, art, state }: { kind: ArtKind; art: Art; state: Record<string, string | null> }) {
  const layers = { ...art.defaults(kind), ...state };
  return (
    <>
      {Object.entries(layers).map(([layer, id]) => {
        const img = id ? art.part(kind, id) : null;
        return img ? (
          <ProtectedImage key={layer} src={img.src} alt="" className="pointer-events-none absolute inset-0 size-full" />
        ) : null;
      })}
    </>
  );
}

/**
 * A control: a hit area on the part's box (from the manifest when it has the renders), with plain
 * styled content otherwise. `text` shows either way (labels the original prints on the part).
 */
function Hit({
  p,
  hit,
  box,
  label,
  onPress,
  onDown,
  onUp,
  disabled,
  className,
  style,
  children,
  text,
  testId,
}: {
  p: ModuleProps;
  hit?: string;
  box: Box;
  label: string;
  onPress?: () => void;
  onDown?: () => void;
  onUp?: () => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  text?: ReactNode;
  testId?: string;
}) {
  const where = at((p.drawn && hit ? p.art.part(p.m.kind, hit)?.box : null) ?? box);
  const holding = useRef(false);
  const plain = !p.drawn;
  const live = !disabled && !!p.send && (onPress || onDown);
  const release = () => {
    if (holding.current) onUp?.();
    holding.current = false;
  };
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      disabled={!live}
      style={{ ...where, ...(plain && style), touchAction: 'none' }}
      className={cn(
        'flex select-none items-center justify-center',
        live && 'active:scale-95',
        plain && className,
        !live && 'cursor-default',
      )}
      onClick={onPress}
      onPointerDown={
        onDown
          ? (e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              holding.current = true;
              onDown();
            }
          : undefined
      }
      onPointerUp={onUp ? release : undefined}
      onPointerCancel={onUp ? release : undefined}
      onContextMenu={(e) => e.preventDefault()}
    >
      {plain && children}
      {text}
    </button>
  );
}

/** Text the module prints: at the original's text node when there are renders, else in its box. */
function Words({
  p,
  node,
  box,
  className,
  style,
  children,
  testId,
}: {
  p: ModuleProps;
  node?: string;
  box: Box;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  testId?: string;
}) {
  const a = p.drawn && node ? p.art.anchor(p.m.kind as Kind, node) : null;
  if (a)
    return (
      <span
        data-testid={testId}
        className={cn('pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap', className)}
        style={{ left: `${a[0] * 100}%`, top: `${a[1] * 100}%`, ...style }}
      >
        {children}
      </span>
    );
  return (
    <div style={at(box)} className="pointer-events-none flex items-center justify-center">
      <span data-testid={testId} className={className} style={style}>
        {children}
      </span>
    </div>
  );
}

/** A plain dark display panel (only without renders: the renders have their own). */
function Screen({ p, box, children }: { p: ModuleProps; box: Box; children?: ReactNode }) {
  if (p.drawn) return null;
  return <div style={at(box)} className="rounded-md bg-stone-950 ring-1 ring-stone-500">{children}</div>;
}

const struckNow = (m: ModuleView, b: BombView, now: number) =>
  b.log.some((e) => e.module === m.id && e.what === 'strike' && now - e.at < 1000);

/** The status light's part: green once disarmed, red for a moment on a strike. */
const statusOf = (m: ModuleView, b: BombView, now: number) =>
  'state' in m ? null : m.solved ? 'status-pass' : struckNow(m, b, now) ? 'status-strike' : 'status-off';

function PlainStatus({ m, b, now }: { m: ModuleView; b: BombView; now: number }) {
  if ('state' in m) return null;
  const s = statusOf(m, b, now);
  return (
    <span
      aria-label={m.solved ? 'disarmed' : s === 'status-strike' ? 'strike' : 'armed'}
      className="absolute right-[4%] top-[4%] size-[10%] rounded-full ring-2 ring-stone-500"
      style={{ background: m.solved ? PAINT.green : s === 'status-strike' ? PAINT.red : '#44403c' }}
    />
  );
}

/** The square module face: its renders (or a plain panel), controls and status light. */
export function ModuleFace(props: Omit<ModuleProps, 'drawn'>) {
  const { m, b, art, now, mini } = props;
  const base = art.module(m.kind);
  const p: ModuleProps = { ...props, send: mini ? null : props.send, drawn: !!base };
  const dark = !b.activated;
  const look = lookOf(p);
  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-lg text-stone-100',
        !base && 'bg-stone-700 ring-1 ring-stone-500 dark:bg-stone-800',
        mini && 'pointer-events-none',
      )}
      style={{ containerType: 'inline-size', aspectRatio: base ? `${base.size[0]} / ${base.size[1]}` : '1 / 1' }}
      data-module={m.id}
      data-kind={m.kind}
      data-solved={m.solved ? '1' : '0'}
    >
      {base && (
        <>
          <ProtectedImage src={base.base} alt="" className="pointer-events-none absolute inset-0 size-full" />
          <Layers kind={m.kind} art={art} state={{ ...look, ...(statusOf(m, b, now) && { status: statusOf(m, b, now) }) }} />
        </>
      )}
      <Body {...p} />
      {!base && <PlainStatus m={m} b={b} now={now} />}
      {dark && <div className="absolute inset-0 bg-stone-950/85" aria-label="dark" />}
    </div>
  );
}

const ROT: Record<Dir, number> = { up: 0, right: 90, down: 180, left: 270 };
const DIRS: Dir[] = ['up', 'right', 'down', 'left'];
/** Where each Simon colour sits (`SimonComponent.buttons`: left, top, bottom, right). */
export const SIMON_PLACE: Record<string, 'left' | 'top' | 'bottom' | 'right'> = {
  red: 'left',
  blue: 'top',
  green: 'bottom',
  yellow: 'right',
};

/** What each render layer shows now (the parts the state changes; the rest keep their defaults). */
function lookOf({ m, b, now, send }: ModuleProps): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  switch (m.kind) {
    case 'wires':
      for (const w of m.wires) out[`wire-${w.slot + 1}`] = `wire-${w.slot + 1}-${w.colour}${w.cut ? '-cut' : ''}`;
      break;
    case 'button': {
      const lit = m.downAt !== null && m.strip && now - m.downAt > HOLD_AFTER ? m.strip : null;
      out.button = `button-${m.colour}`;
      out.strip = `strip-${lit ?? 'off'}`;
      // The lid opens when the module is opened to be pressed (LidBehaviour: on interaction).
      if (send) out.lid = null;
      break;
    }
    case 'keypad': {
      const flash = struckNow(m, b, now);
      m.symbols.forEach((_, i) => {
        out[`led-${i + 1}`] = `led-${i + 1}-${m.down[i] ? 'correct' : flash ? 'wrong' : 'off'}`;
      });
      break;
    }
    case 'simon': {
      const f = simonFlash(m, now);
      SIMON_COLOURS.forEach((c, i) => {
        out[`pad-${SIMON_PLACE[c]}`] = `pad-${SIMON_PLACE[c]}-${f === i ? 'on' : 'off'}`;
      });
      break;
    }
    case 'whos-on-first':
      for (let i = 1; i <= 3; i++) out[`stage-${i}`] = `stage-${i}-${m.stage >= i ? 'on' : 'off'}`;
      break;
    case 'memory': {
      const done = m.stage + (m.solved ? 1 : 0);
      for (let i = 1; i <= 5; i++) out[`stage-${i}`] = `stage-${i}-${done >= i ? 'on' : 'off'}`;
      break;
    }
    case 'morse':
      out.led = 'signal' in m && b.activated && !m.solved && morseLit(m.signal, b.activeAt, now) ? 'led-on' : 'led-off';
      break;
    case 'complicated-wires':
      for (const w of m.wires) {
        const n = w.slot + 1;
        out[`led-${n}`] = `led-${n}-${w.led && b.activated ? 'on' : 'off'}`;
        out[`wire-${n}`] = `wire-${n}-${w.colour.replace('-', '')}${w.cut ? '-cut' : ''}`;
        if (w.star) out[`star-${n}`] = `star-${n}`;
      }
      break;
    case 'wire-sequence': {
      if (!('panels' in m)) break;
      const turning = now < m.turningUntil;
      out['stage-1'] = m.page >= 4 ? 'stage-1-on' : 'stage-1-off';
      if (!turning && m.page < 4) {
        out['door-left'] = null;
        out['door-right'] = null;
        for (let r = 0; r < 3; r++) {
          const e = m.panels[m.page * 3 + r]!;
          if (e.colour) out[`wire-${r + 1}`] = `wire-${r + 1}${'abc'[e.to]}-${e.colour}${e.cut ? '-cut' : ''}`;
        }
      }
      break;
    }
    case 'venting-gas':
      out.timer = m.state === 'running' ? 'timer-on' : 'timer-off';
      break;
    case 'capacitor':
      out.timer = m.state === 'running' ? 'timer-on' : 'timer-off';
      out.bulb = m.heldAt !== null ? 'bulb-on' : 'bulb-off';
      out.capacitor = m.exploded ? 'capacitor-exploded' : 'capacitor-normal';
      out['bar-fill'] = null;
      break;
    case 'knob': {
      out.timer = m.state === 'running' ? 'timer-on' : 'timer-off';
      out.dial = `dial-${m.label}`;
      out.knob = `knob-${DIRS[(DIRS.indexOf(m.label) + DIRS.indexOf(m.pos)) % 4]}`;
      const leds = 'leds' in m ? m.leds : null;
      const panic = m.state === 'running' && Math.round(needyLeft(m as NeedyModule, now) / 1000) <= 5 && Math.floor(now / 150) % 2 === 0;
      for (let i = 0; i < 12; i++) out[`led-${i + 1}`] = `led-${i + 1}-${leds && leds[i] === 'X' && !panic ? 'on' : 'off'}`;
      break;
    }
    default:
      break;
  }
  return out;
}

function Body(p: ModuleProps) {
  switch (p.m.kind) {
    case 'wires':
      return <Wires {...p} />;
    case 'button':
      return <BigButton {...p} />;
    case 'keypad':
      return <Keypad {...p} />;
    case 'simon':
      return <Simon {...p} />;
    case 'whos-on-first':
      return <WordButtons {...p} />;
    case 'memory':
      return <NumberButtons {...p} />;
    case 'morse':
      return <Morse {...p} />;
    case 'complicated-wires':
      return <Venn {...p} />;
    case 'wire-sequence':
      return <Sequence {...p} />;
    case 'maze':
      return <Maze {...p} />;
    case 'password':
      return <Password {...p} />;
    case 'venting-gas':
      return <Vent {...p} />;
    case 'capacitor':
      return <Capacitor {...p} />;
    case 'knob':
      return <Knob {...p} />;
  }
}

// ---- Solvable modules ----

function Wires(p: ModuleProps) {
  const { m, send } = p;
  if (m.kind !== 'wires') return null;
  return (
    <>
      {m.wires.map((w, i) => (
        <Hit
          key={w.slot}
          p={p}
          hit={`wire-${w.slot + 1}-${w.colour}`}
          box={[0.08, 0.1 + w.slot * 0.135, 0.72, 0.1]}
          label={`${w.colour} wire${w.cut ? ', cut' : ''}`}
          disabled={w.cut}
          onPress={() => send?.({ op: 'cut', wire: i })}
          testId={`wire-${i}`}
        >
          <span className="flex size-full items-center gap-[3%]">
            <span className="flex h-[40%] flex-1 gap-[8%]">
              <span className="flex-1 rounded-full ring-1 ring-stone-950/40" style={{ background: PAINT[w.colour] }} />
              {w.cut && <span className="flex-1 rounded-full ring-1 ring-stone-950/40" style={{ background: PAINT[w.colour] }} />}
            </span>
            <span style={TEXT(5)} className="w-[28%] text-left font-semibold">
              {w.colour}
              {w.cut && ' ✂'}
            </span>
          </span>
        </Hit>
      ))}
    </>
  );
}

function BigButton(p: ModuleProps) {
  const { m, send, now } = p;
  if (m.kind !== 'button') return null;
  const lit = m.downAt !== null && m.strip && now - m.downAt > HOLD_AFTER ? m.strip : null;
  const darkText = m.colour === 'white' || m.colour === 'yellow';
  return (
    <>
      <Hit
        p={p}
        hit={`button-${m.colour}`}
        box={[0.08, 0.18, 0.6, 0.6]}
        label={`${m.colour} button, ${m.label}`}
        onDown={() => send?.({ op: 'down' })}
        onUp={() => send?.({ op: 'up' })}
        className="rounded-full shadow-lg ring-4 ring-stone-950/50"
        style={{ background: PAINT[m.colour] }}
        testId="big-button"
        text={
          <span style={TEXT(p.drawn ? 9 : 8)} className={cn('font-black uppercase', darkText ? 'text-stone-900' : 'text-white')}>
            {m.label}
          </span>
        }
      />
      {!p.drawn && (
        <div style={at([0.76, 0.2, 0.14, 0.56])} className="rounded-md ring-1 ring-stone-950/50" aria-label={lit ? `${lit} strip` : 'strip off'}>
          <span className="block size-full rounded-md" style={{ background: lit ? PAINT[lit] : '#292524' }} />
        </div>
      )}
      <span className="sr-only" data-testid="button-strip" data-colour={lit ?? ''} />
    </>
  );
}

function Keypad(p: ModuleProps) {
  const { m, art, send, b, now } = p;
  if (m.kind !== 'keypad') return null;
  const flash = struckNow(m, b, now);
  return (
    <>
      {m.symbols.map((s, i) => {
        const glyph = art.glyph(s);
        const gbox = p.drawn ? art.glyphBox(i + 1) : null;
        return (
          <div key={i}>
            <Hit
              p={p}
              hit={`key-${i + 1}`}
              box={[0.1 + (i % 2) * 0.4, 0.14 + Math.floor(i / 2) * 0.4, 0.36, 0.36]}
              label={`key ${GLYPHS[s]?.name ?? s}`}
              disabled={m.down[i]}
              onPress={() => send?.({ op: 'press', button: i })}
              className="rounded-md bg-stone-200 text-stone-900 shadow ring-1 ring-stone-950/40"
              testId={`key-${i}`}
            >
              <span className="relative flex size-full items-center justify-center">
                <span className="absolute left-1/2 top-[6%] size-[12%] -translate-x-1/2 rounded-full" style={{ background: m.down[i] ? PAINT.green : flash ? '#7f1d1d' : '#57534e' }} />
                {glyph ? (
                  <ProtectedImage src={glyph} alt={GLYPHS[s]?.name ?? ''} className="size-[62%] object-contain" />
                ) : (
                  <span style={TEXT(14)} className="font-serif">
                    {GLYPHS[s]?.glyph ?? '?'}
                  </span>
                )}
              </span>
            </Hit>
            {gbox && (
              <div style={at(gbox)} className="pointer-events-none flex items-center justify-center">
                {glyph ? (
                  <ProtectedImage src={glyph} alt={GLYPHS[s]?.name ?? ''} className="size-full object-contain" />
                ) : (
                  <span style={TEXT(14)} className="font-serif text-stone-900">
                    {GLYPHS[s]?.glyph}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Which pad flashes now, from Simon's playback schedule (or -1). */
export function simonFlash(m: Extract<ModuleView, { kind: 'simon' }>, now: number): number {
  if (m.solved || now < m.playAt) return -1;
  const period = m.shown.length * SIMON_NOTE + SIMON_REPLAY;
  const into = (now - m.playAt) % period;
  const i = Math.floor(into / SIMON_NOTE);
  return i < m.shown.length ? SIMON_COLOURS.indexOf(m.shown[i]!) : -1;
}

const SIMON_BOX: Record<string, Box> = {
  top: [0.33, 0.06, 0.3, 0.3],
  left: [0.06, 0.33, 0.3, 0.3],
  right: [0.6, 0.33, 0.3, 0.3],
  bottom: [0.33, 0.6, 0.3, 0.3],
};

function Simon(p: ModuleProps) {
  const { m, send, now, mini } = p;
  const flash = m.kind === 'simon' ? simonFlash(m, now) : -1;
  const last = useRef(-1);
  const stage = m.kind === 'simon' ? m.stage : 0;
  useEffect(() => {
    if (mini) return;
    // The first stage's flash is silent; tones play from the second (`lastIndex > 0`).
    if (flash >= 0 && flash !== last.current && stage > 0) player.tone(SIMON_TONES[flash]!, SIMON_NOTE - 50);
    last.current = flash;
  }, [flash, stage, mini]);
  if (m.kind !== 'simon') return null;
  return (
    <>
      {SIMON_COLOURS.map((c, i) => {
        const place = SIMON_PLACE[c]!;
        return (
          <Hit
            key={c}
            p={p}
            hit={`pad-${place}-off`}
            box={SIMON_BOX[place]!}
            label={`${c} pad`}
            onPress={() => {
              player.tone(SIMON_TONES[i]!, 300);
              send?.({ op: 'press', button: i });
            }}
            className="rotate-45 rounded-md ring-2 ring-stone-950/50"
            style={{ background: PAINT[c], opacity: flash === i ? 1 : 0.4, boxShadow: flash === i ? `0 0 24px ${PAINT[c]}` : undefined }}
            testId={`pad-${c}`}
          >
            <span style={TEXT(4)} className="-rotate-45 font-bold uppercase text-stone-950/70" data-lit={flash === i ? '1' : '0'}>
              {c}
            </span>
          </Hit>
        );
      })}
    </>
  );
}

function StageBar({ done, of }: { done: number; of: number }) {
  return (
    <div className="absolute right-[4%] top-[22%] flex h-[70%] w-[8%] flex-col-reverse gap-[6%]" aria-label={`stage ${done} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className="flex-1 rounded-sm ring-1 ring-stone-950/50" style={{ background: i < done ? PAINT.green : '#292524' }} />
      ))}
    </div>
  );
}

const WOF_NODE = (i: number) => `Component_Whose/button${i}/ModelPositionOffset/ButtonText`;

function WordButtons(p: ModuleProps) {
  const { m, send, now } = p;
  if (m.kind !== 'whos-on-first') return null;
  const up = m.change ? now < m.change.sinkAt : now >= m.upAt;
  return (
    <>
      <Screen p={p} box={[0.08, 0.06, 0.66, 0.2]} />
      <Words p={p} node="DisplayText" box={[0.08, 0.06, 0.66, 0.2]} style={TEXT(p.drawn ? 6 : 8)} className="font-mono font-bold tracking-wide text-[#e7e5e4]" testId="wof-display">
        {m.display ?? ''}
      </Words>
      {m.labels.map((l, i) => (
        <div key={i}>
          <Hit
            p={p}
            hit={`key-${i + 1}`}
            box={[0.08 + (i % 2) * 0.34, 0.32 + Math.floor(i / 2) * 0.21, 0.3, 0.17]}
            label={l}
            disabled={!up || m.solved}
            onPress={() => send?.({ op: 'press', button: i })}
            className={cn('rounded-md bg-stone-200 text-stone-900 ring-1 ring-stone-950/40', !up && 'opacity-30')}
            testId={`word-${i}`}
          >
            <span style={TEXT(5)} className="font-bold">
              {up ? l : ''}
            </span>
          </Hit>
          {p.drawn && up && (
            <Words p={p} node={WOF_NODE(i)} box={[0, 0, 0, 0]} style={TEXT(4.2)} className="font-bold text-stone-900">
              {l}
            </Words>
          )}
        </div>
      ))}
      {!p.drawn && <StageBar done={m.stage} of={3} />}
    </>
  );
}

const MEM_NODE = ['button0/KEY_A/ButtonText', 'button1/KEY_B/ButtonText', 'button2/KEY_C/ButtonText', 'button3/KEY_D/ButtonText'];

function NumberButtons(p: ModuleProps) {
  const { m, send } = p;
  if (m.kind !== 'memory') return null;
  const ready = m.valid && !m.change;
  const display = 'display' in m ? m.display : null;
  return (
    <>
      <Screen p={p} box={[0.14, 0.08, 0.56, 0.4]} />
      <Words p={p} node="DisplayText" box={[0.14, 0.08, 0.56, 0.4]} style={TEXT(p.drawn ? 16 : 22)} className="font-mono font-bold text-[#e7e5e4]" testId="memory-display">
        {display ?? ''}
      </Words>
      {m.labels.map((l, i) => (
        <div key={i}>
          <Hit
            p={p}
            hit={`key-${i + 1}`}
            box={[0.08 + i * 0.18, 0.6, 0.15, 0.28]}
            label={`button ${l}`}
            disabled={!ready || m.solved}
            onPress={() => send?.({ op: 'press', button: i })}
            className={cn('rounded-md bg-stone-200 text-stone-900 ring-1 ring-stone-950/40', !ready && 'opacity-40')}
            testId={`num-${i}`}
          >
            <span style={TEXT(10)} className="font-bold">
              {ready || m.solved ? l : ''}
            </span>
          </Hit>
          {p.drawn && (ready || m.solved) && (
            <Words p={p} node={MEM_NODE[i]} box={[0, 0, 0, 0]} style={TEXT(7)} className="font-bold text-stone-900">
              {l}
            </Words>
          )}
        </div>
      ))}
      {!p.drawn && <StageBar done={m.stage + (m.solved ? 1 : 0)} of={5} />}
    </>
  );
}

/** Whether the Morse light is on at `now` (`MorseCodeComponent.PlayWord`, looping from the lights). */
export function morseLit(signal: readonly string[], since: number, now: number): boolean {
  const unit = 270;
  const parts: [boolean, number][] = [];
  signal.forEach((letter, li) => {
    [...letter].forEach((s, si) => {
      parts.push([true, s === '-' ? 3 : 1]);
      if (si < letter.length - 1) parts.push([false, 1]);
    });
    parts.push([false, li < signal.length - 1 ? 4 : 10]);
  });
  const total = parts.reduce((n, [, u]) => n + u, 0) * unit;
  if (!total || now < since) return false;
  let t = (now - since) % total;
  for (const [on, u] of parts) {
    if (t < u * unit) return on;
    t -= u * unit;
  }
  return false;
}

function Morse(p: ModuleProps) {
  const { m, b, art, send, now } = p;
  if (m.kind !== 'morse' || !('signal' in m)) return null;
  const lit = b.activated && !m.solved && morseLit(m.signal, b.activeAt, now);
  const start = art.anchor('morse', 'Component_Morse/StartPoint');
  const end = art.anchor('morse', 'Component_Morse/EndPoint');
  const marker = p.drawn ? art.part('morse', 'marker') : null;
  const shift = start && end ? ((end[0] - start[0]) * m.dial) / (MORSE.length - 1) : 0;
  return (
    <>
      {!p.drawn && (
        <div style={at([0.1, 0.08, 0.16, 0.16])} className="rounded-full ring-2 ring-stone-950">
          <span className="block size-full rounded-full" style={{ background: lit ? '#fbbf24' : '#44403c', boxShadow: lit ? '0 0 20px #fbbf24' : undefined }} />
        </div>
      )}
      <span className="sr-only" data-testid="morse-light" data-lit={lit ? '1' : '0'} />
      {marker && (
        <ProtectedImage src={marker.src} alt="" className="pointer-events-none absolute inset-0 size-full" style={{ transform: `translateX(${shift * 100}%)` }} />
      )}
      <Screen p={p} box={[0.22, 0.38, 0.56, 0.18]} />
      <Words p={p} node="DisplayText" box={[0.22, 0.38, 0.56, 0.18]} style={TEXT(p.drawn ? 6 : 8)} className="font-mono font-bold text-[#fbbf24]" testId="morse-freq">
        {(MORSE[m.dial]![0] / 1000).toFixed(3)} MHz
      </Words>
      <Hit p={p} hit="button-left" box={[0.06, 0.38, 0.14, 0.18]} label="frequency down" disabled={m.dial === 0} onPress={() => send?.({ op: 'dial', by: -1 })} className="rounded-md bg-stone-200 text-stone-900" testId="morse-down">
        <span style={TEXT(8)}>◀</span>
      </Hit>
      <Hit p={p} hit="button-right" box={[0.8, 0.38, 0.14, 0.18]} label="frequency up" disabled={m.dial === MORSE.length - 1} onPress={() => send?.({ op: 'dial', by: 1 })} className="rounded-md bg-stone-200 text-stone-900" testId="morse-up">
        <span style={TEXT(8)}>▶</span>
      </Hit>
      <Hit p={p} hit="button-transmit" box={[0.3, 0.68, 0.4, 0.18]} label="transmit" onPress={() => send?.({ op: 'tx' })} className="rounded-md bg-stone-200 text-stone-900" testId="morse-tx">
        <span style={TEXT(7)} className="font-bold">
          TX
        </span>
      </Hit>
    </>
  );
}

function Venn(p: ModuleProps) {
  const { m, send, b } = p;
  if (m.kind !== 'complicated-wires') return null;
  return (
    <>
      {m.wires.map((w, i) => {
        const x = 0.06 + w.slot * 0.15;
        const [c1, c2] = w.colour.split('-');
        const stripes = `repeating-linear-gradient(180deg, ${PAINT[c1!]} 0 12%, ${PAINT[c2 ?? c1!]} 12% 24%)`;
        const ledOn = w.led && b.activated;
        return (
          <div key={w.slot}>
            {!p.drawn && (
              <>
                <span style={at([x + 0.03, 0.05, 0.07, 0.07])} className="rounded-full ring-1 ring-stone-950">
                  <span className="block size-full rounded-full" style={{ background: ledOn ? '#fde68a' : '#44403c', boxShadow: ledOn ? '0 0 10px #fde68a' : undefined }} />
                </span>
                <span style={{ ...at([x, 0.82, 0.13, 0.12]), ...TEXT(7) }} className="flex items-center justify-center text-stone-950">
                  {w.star ? '★' : ''}
                </span>
              </>
            )}
            <Hit
              p={p}
              hit={`wire-${w.slot + 1}-${w.colour.replace('-', '')}`}
              box={[x, 0.15, 0.13, 0.64]}
              label={`${w.colour.replace('-', ' and ')} wire${w.led ? ', light on' : ''}${w.star ? ', star' : ''}${w.cut ? ', cut' : ''}`}
              disabled={w.cut}
              onPress={() => send?.({ op: 'cut', wire: i })}
              testId={`vwire-${i}`}
            >
              <span className="flex h-full w-[45%] flex-col gap-[6%]">
                <span className="flex-1 rounded-full ring-1 ring-stone-950/50" style={{ background: stripes }} />
                {w.cut && <span className="flex-1 rounded-full ring-1 ring-stone-950/50" style={{ background: stripes }} />}
              </span>
            </Hit>
          </div>
        );
      })}
    </>
  );
}

function Sequence(p: ModuleProps) {
  const { m, send, now } = p;
  if (m.kind !== 'wire-sequence' || !('panels' in m)) return null;
  const turning = now < m.turningUntil;
  const page = Math.min(m.page, 3);
  const showing = turning || m.page >= 4 ? null : page;
  return (
    <>
      {showing !== null &&
        [0, 1, 2].map((r) => {
          const e = m.panels[showing * 3 + r]!;
          return (
            <div key={r}>
              <span style={{ ...at([0.04, 0.14 + r * 0.22, 0.12, 0.14]), ...TEXT(5) }} className="flex items-center justify-center font-mono font-bold text-stone-100">
                {showing * 3 + r + 1}
              </span>
              {e.colour && (
                <Hit
                  p={p}
                  hit={`wire-${r + 1}${'abc'[e.to]}-${e.colour}`}
                  box={[0.18, 0.14 + r * 0.22, 0.6, 0.14]}
                  label={`${e.colour} wire from ${showing * 3 + r + 1} to ${'ABC'[e.to]}${e.cut ? ', cut' : ''}`}
                  disabled={e.cut}
                  onPress={() => send?.({ op: 'cut', wire: r })}
                  testId={`seq-${r}`}
                >
                  <span className="flex w-full items-center gap-[3%]">
                    <span className={cn('h-[0.6em] flex-1 rounded-full', e.cut && 'opacity-30')} style={{ background: PAINT[e.colour] }} />
                    <span style={TEXT(5)} className="font-mono font-bold">
                      {e.colour} → {'ABC'[e.to]}
                    </span>
                  </span>
                </Hit>
              )}
            </div>
          );
        })}
      <Hit p={p} hit="button-up" box={[0.06, 0.8, 0.3, 0.14]} label="up" disabled={page === 0 || turning} onPress={() => send?.({ op: 'back' })} className="rounded-md bg-stone-200 text-stone-900" testId="seq-up">
        <span style={TEXT(6)}>▲</span>
      </Hit>
      <Hit p={p} hit="button-down" box={[0.42, 0.8, 0.3, 0.14]} label="down" disabled={turning || m.page >= 4} onPress={() => send?.({ op: 'next' })} className="rounded-md bg-stone-200 text-stone-900" testId="seq-down">
        <span style={TEXT(6)}>▼</span>
      </Hit>
      {!p.drawn && <StageBar done={Math.min(m.page, 4)} of={4} />}
    </>
  );
}

function Maze(p: ModuleProps) {
  const { m, art, send } = p;
  if (m.kind !== 'maze' || !('circles' in m)) return null;
  const arrow = (dir: Dir, hit: string, box: Box, glyph: string) => (
    <Hit p={p} hit={hit} box={box} label={`move ${dir}`} disabled={m.solved} onPress={() => send?.({ op: 'move', dir })} className="rounded-md bg-stone-200 text-stone-900" testId={`maze-${dir}`}>
      <span style={TEXT(6)}>{glyph}</span>
    </Hit>
  );
  const grid = p.drawn ? art.mazeGrid() : null;
  const placed = (id: string, [x, y]: readonly [number, number], key: string) => {
    const img = grid ? art.part('maze', id) : null;
    if (!img || !grid) return null;
    return (
      <ProtectedImage
        key={key}
        src={img.src}
        alt=""
        className="pointer-events-none absolute inset-0 size-full"
        style={{ transform: `translate(${x * grid.pitch[0] * 100}%, ${y * grid.pitch[1] * 100}%)` }}
      />
    );
  };
  return (
    <>
      {grid ? (
        <>
          {m.circles.map((c, i) => placed('marker', c, `c${i}`))}
          {placed('goal', m.goal, 'goal')}
          {placed('player', m.at, 'me')}
        </>
      ) : (
        <div style={at([0.17, 0.17, 0.66, 0.66])} className="grid grid-cols-6 grid-rows-6 gap-[2%] rounded-md bg-stone-950 p-[2%]" data-testid="maze-grid">
          {Array.from({ length: 36 }, (_, i) => {
            const x = i % 6;
            const y = Math.floor(i / 6);
            const circle = m.circles.some((c) => c[0] === x && c[1] === y);
            const me = m.at[0] === x && m.at[1] === y;
            const goal = m.goal[0] === x && m.goal[1] === y;
            return (
              <span key={i} className="relative flex items-center justify-center" data-cell={`${x},${y}`}>
                <span className="size-[22%] rounded-full bg-stone-600" />
                {circle && <span className="absolute inset-[12%] rounded-full" style={{ boxShadow: `inset 0 0 0 2px ${PAINT.green}` }} />}
                {goal && (
                  <span style={{ ...TEXT(5), color: PAINT.red }} className="absolute">
                    ▲
                  </span>
                )}
                {me && <span className="absolute inset-[24%] rounded-full bg-white" />}
              </span>
            );
          })}
        </div>
      )}
      <span className="sr-only" data-testid="maze-light" data-at={`${m.at[0]},${m.at[1]}`} />
      {arrow('up', 'button-top', [0.4, 0.02, 0.2, 0.13], '▲')}
      {arrow('down', 'button-bot', [0.4, 0.85, 0.2, 0.13], '▼')}
      {arrow('left', 'button-left', [0.02, 0.4, 0.13, 0.2], '◀')}
      {arrow('right', 'button-right', [0.85, 0.4, 0.13, 0.2], '▶')}
    </>
  );
}

function Password(p: ModuleProps) {
  const { m, send } = p;
  if (m.kind !== 'password') return null;
  const ready = m.columns.length > 0;
  return (
    <>
      {[0, 1, 2, 3, 4].map((c) => (
        <div key={c}>
          <Hit p={p} hit={`button-top-${c + 1}`} box={[0.05 + c * 0.18, 0.08, 0.16, 0.14]} label={`letter ${c + 1} up`} disabled={!ready} onPress={() => send?.({ op: 'spin', column: c, by: -1 })} className="rounded-md bg-stone-200 text-stone-900" testId={`pw-up-${c}`}>
            <span style={TEXT(5)}>▲</span>
          </Hit>
          {!p.drawn && <span style={at([0.05 + c * 0.18, 0.25, 0.16, 0.24])} className="rounded-sm bg-[#3f6212] ring-1 ring-stone-950" />}
          <Words p={p} node={`Layout_DEFAULT/Spinner${c + 1}`} box={[0.05 + c * 0.18, 0.25, 0.16, 0.24]} style={TEXT(p.drawn ? 9 : 11)} className="font-mono font-bold text-stone-950" testId={`pw-letter-${c}`}>
            {m.columns[c]?.[m.pos[c]!] ?? ''}
          </Words>
          <Hit p={p} hit={`button-bot-${c + 1}`} box={[0.05 + c * 0.18, 0.52, 0.16, 0.14]} label={`letter ${c + 1} down`} disabled={!ready} onPress={() => send?.({ op: 'spin', column: c, by: 1 })} className="rounded-md bg-stone-200 text-stone-900" testId={`pw-down-${c}`}>
            <span style={TEXT(5)}>▼</span>
          </Hit>
        </div>
      ))}
      <Hit p={p} hit="button-submit" box={[0.3, 0.74, 0.4, 0.16]} label="submit" disabled={!ready} onPress={() => send?.({ op: 'submit' })} className="rounded-md bg-stone-200 text-stone-900" testId="pw-submit">
        <span style={TEXT(6)} className="font-bold">
          SUBMIT
        </span>
      </Hit>
    </>
  );
}

// ---- Needy modules ----

/** The needy countdown's two digits (`NeedyTimer`: rounded seconds), on the timer part. */
function NeedyClock({ p }: { p: ModuleProps }) {
  const m = p.m as NeedyModule;
  const running = m.state === 'running';
  const left = running ? needyLeft(m, p.now) : 0;
  const value = running ? Math.max(0, Math.round(left / 1000)) : null;
  const warn = running && left <= (m.kind === 'venting-gas' ? 3000 : 5000);
  const box = (p.drawn ? p.art.part(m.kind, 'timer-on')?.box : null) ?? [0.3, 0.03, 0.4, 0.16];
  return (
    <div style={at(box)} className={cn('flex items-center justify-center', !p.drawn && 'rounded-md bg-stone-950 ring-1 ring-stone-500')}>
      {(running || !p.drawn) && (
        <span data-testid="needy-clock" style={{ ...TEXT(p.drawn ? 8 : 10), color: warn ? PAINT.red : '#f97316' }} className="font-mono font-bold">
          {value === null ? '--' : String(value).padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

function Vent(p: ModuleProps) {
  const { m, send, now } = p;
  if (m.kind !== 'venting-gas') return null;
  const running = m.state === 'running';
  const reply = m.reply;
  const word = reply ? (reply.yes ? 'YES' : 'NO') : '';
  const typed = reply ? word.slice(0, Math.min(word.length, Math.floor(((now - reply.at) / (reply.yes ? 1500 : 1000)) * word.length) + 1)) : '';
  const warning = m.warnedAt !== null && reply && now >= m.warnedAt && now < reply.lockUntil;
  const asking = running && m.question && !warning;
  const node = m.question === 'detonate' ? 'DetonateText/Detonate' : 'VentGasText/VentGas';
  return (
    <>
      <NeedyClock p={p} />
      <Screen p={p} box={[0.1, 0.24, 0.8, 0.36]} />
      {warning && (
        <Words p={p} node="PreventsText/VentingPreventsExplosions" box={[0.1, 0.24, 0.8, 0.2]} style={TEXT(5)} className="text-center font-mono font-bold text-[#a3e635]" testId="vent-text">
          VENTING PREVENTS EXPLOSIONS
        </Words>
      )}
      {asking && (
        <>
          <Words p={p} node={node} box={[0.1, 0.24, 0.8, 0.14]} style={TEXT(6)} className="font-mono font-bold text-[#a3e635]" testId="vent-text">
            {m.question === 'vent' ? 'VENT GAS?' : 'DETONATE?'}
          </Words>
          <Words p={p} node={m.question === 'vent' ? 'VentGasText/VentYN' : 'DetonateText/DetonateYN'} box={[0.1, 0.38, 0.8, 0.1]} style={TEXT(5)} className="font-mono font-bold text-[#a3e635]">
            Y/N
          </Words>
        </>
      )}
      <Words p={p} node="VentInput" box={[0.1, 0.48, 0.8, 0.1]} style={TEXT(6)} className="font-mono font-bold text-[#a3e635]">
        {typed}
      </Words>
      <Hit p={p} hit="key-y" box={[0.14, 0.68, 0.3, 0.2]} label="yes" disabled={!running || !!reply} onPress={() => send?.({ op: 'answer', yes: true })} className="rounded-md bg-stone-200 text-stone-900" testId="vent-yes">
        <span style={TEXT(8)} className="font-bold">
          Y
        </span>
      </Hit>
      <Hit p={p} hit="key-n" box={[0.56, 0.68, 0.3, 0.2]} label="no" disabled={!running || !!reply} onPress={() => send?.({ op: 'answer', yes: false })} className="rounded-md bg-stone-200 text-stone-900" testId="vent-no">
        <span style={TEXT(8)} className="font-bold">
          N
        </span>
      </Hit>
    </>
  );
}

function Capacitor(p: ModuleProps) {
  const { m, art, send, now, mini } = p;
  const running = m.kind === 'capacitor' && m.state === 'running';
  const left = running ? needyLeft(m as NeedyModule, now) : NEEDY_TIME.capacitor;
  const used = Math.max(0, Math.min(1, 1 - left / NEEDY_TIME.capacitor));
  const tone = useRef(0);
  useEffect(() => {
    if (mini || !running) return;
    // The rising tone from 20 s used (`NeedyDischargeComponent.Update`), 300 → 450 Hz.
    const into = Math.max(0, (used * NEEDY_TIME.capacitor - 20_000) / (NEEDY_TIME.capacitor - 20_000));
    if (into > 0 && now - tone.current > 400) {
      tone.current = now;
      player.tone(300 + into * 150, 380, into / 4);
    }
  }, [now, running, used, mini]);
  if (m.kind !== 'capacitor') return null;
  const fill = p.drawn ? art.part('capacitor', 'bar-fill-full') : null;
  return (
    <>
      <NeedyClock p={p} />
      {fill ? (
        <ProtectedImage
          src={fill.src}
          alt=""
          className="pointer-events-none absolute inset-0 size-full"
          style={fill.box ? { clipPath: `inset(${(fill.box[1] + fill.box[3] * (1 - used)) * 100}% 0 0 0)` } : undefined}
        />
      ) : (
        <div style={at([0.1, 0.25, 0.1, 0.6])} className="flex flex-col-reverse overflow-hidden rounded-sm bg-stone-950 ring-1 ring-stone-500" aria-label="charge">
          <span style={{ height: `${used * 100}%`, background: PAINT.red }} />
        </div>
      )}
      <Hit
        p={p}
        hit="lever"
        box={[0.32, 0.3, 0.5, 0.56]}
        label={m.exploded ? 'capacitor blown' : 'discharge lever (hold)'}
        disabled={m.exploded}
        onDown={() => send?.({ op: 'down' })}
        onUp={() => send?.({ op: 'up' })}
        className="rounded-xl bg-stone-300 text-stone-900 ring-2 ring-stone-950/50"
        testId="capacitor-lever"
      >
        <span style={TEXT(6)} className="text-center font-bold">
          {m.exploded ? 'BLOWN' : m.heldAt !== null ? 'DISCHARGING' : 'HOLD TO DISCHARGE'}
        </span>
      </Hit>
    </>
  );
}

function Knob(p: ModuleProps) {
  const { m, art, send, now } = p;
  if (m.kind !== 'knob') return null;
  const running = m.state === 'running';
  const left = running ? needyLeft(m as NeedyModule, now) : 0;
  const panic = running && Math.round(left / 1000) <= 5 && Math.floor(now / 150) % 2 === 0;
  const leds = 'leds' in m ? m.leds : null;
  const abs = (ROT[m.label] + ROT[m.pos]) % 360;
  const up = p.drawn ? art.anchor('knob', 'Component_Needy_Knob/Dial/UpText') : null;
  const centre = p.drawn ? art.dialCentre() : null;
  return (
    <>
      <NeedyClock p={p} />
      {!p.drawn &&
        [0, 1].map((row) => (
          <div key={row} style={at([0.08, row === 0 ? 0.22 : 0.84, 0.84, 0.08])} className="flex justify-between gap-[2%]">
            {Array.from({ length: 6 }, (_, i) => {
              const on = !!leds && leds[row * 6 + i] === 'X' && !panic;
              return <span key={i} className="aspect-square h-full rounded-full ring-1 ring-stone-950" style={{ background: on ? PAINT.green : '#292524' }} />;
            })}
          </div>
        ))}
      <span className="sr-only" data-testid="knob-leds" data-leds={leds ?? ''} data-label={m.label} data-pos={m.pos} />
      {up && centre ? (
        <span
          className="pointer-events-none absolute font-bold text-stone-900"
          style={{
            ...TEXT(4),
            left: `${centre[0] * 100}%`,
            top: `${centre[1] * 100}%`,
            transform: `rotate(${ROT[m.label]}deg) translate(${(up[0] - centre[0]) * 100}cqw, ${(up[1] - centre[1]) * 100}cqw) translate(-50%, -50%)`,
            transformOrigin: '0 0',
          }}
        >
          UP
        </span>
      ) : (
        !p.drawn && (
          <div style={{ ...at([0.25, 0.32, 0.5, 0.5]), transform: `rotate(${ROT[m.label]}deg)` }} className="pointer-events-none">
            <span style={TEXT(5)} className="absolute left-1/2 top-0 -translate-x-1/2 font-bold">
              UP
            </span>
          </div>
        )
      )}
      <Hit p={p} hit={`knob-${m.pos}`} box={[0.33, 0.4, 0.34, 0.34]} label={`knob, pointing ${m.pos} of the label`} onPress={() => send?.({ op: 'turn' })} className="rounded-full bg-stone-400 ring-2 ring-stone-950" testId="knob">
        <span className="h-[48%] w-[12%] rounded-full bg-stone-900" style={{ transform: `translateY(-50%) rotate(${abs}deg)`, transformOrigin: '50% 100%' }} />
      </Hit>
    </>
  );
}

/** The timer's slot on a face: digits and strike lamps (drawn like a module). */
export function TimerFace({ b, now, art }: { b: BombView; now: number; art: Art }) {
  const lit = now >= b.startedAt + 2000;
  const left = leftAt(b, now);
  const lamps = Math.max(0, b.strikeLimit - 1);
  const base = art.module('timer');
  const defused = b.end?.how === 'defused';
  const state: Record<string, string | null> = {};
  for (let i = 1; i <= 2; i++) state[`strike-${i}`] = i > lamps ? null : `strike-${i}-${defused ? 'green' : b.strikes >= i ? 'on' : 'off'}`;
  if (lamps === 0) state.backing = 'backing-nostrikes';
  const digits = (
    <span
      data-testid="timer-face"
      style={{ ...TEXT(base ? 17 : 20), color: PAINT.red, fontFamily: art.digitsFont ? 'DefuseDigits, ui-monospace, monospace' : 'ui-monospace, monospace' }}
      className={cn('font-bold tabular-nums', !base && 'rounded-md bg-stone-950 px-[6%] py-[3%]', !lit && 'opacity-0')}
    >
      {timerText(left)}
    </span>
  );
  if (base)
    return (
      <div className="relative w-full overflow-hidden rounded-lg" style={{ containerType: 'inline-size', aspectRatio: `${base.size[0]} / ${base.size[1]}` }}>
        <ProtectedImage src={base.base} alt="" className="pointer-events-none absolute inset-0 size-full" />
        <Layers kind="timer" art={art} state={state} />
        <div className="absolute inset-x-0 bottom-[12%] top-[38%] flex items-center justify-center">{digits}</div>
      </div>
    );
  return (
    <div className="relative flex aspect-square w-full flex-col items-center justify-center gap-[6%] overflow-hidden rounded-lg bg-stone-800 ring-1 ring-stone-500" style={{ containerType: 'inline-size' }}>
      <div className="flex gap-[8%]" aria-label={`${b.strikes} strikes`}>
        {Array.from({ length: lamps }, (_, i) => (
          <span key={i} className="size-[9cqw] rounded-full ring-1 ring-stone-950" style={{ background: i < b.strikes ? PAINT.red : '#292524' }} />
        ))}
      </div>
      {digits}
    </div>
  );
}
