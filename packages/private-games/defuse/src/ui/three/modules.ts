// Each module's 3D binding: which of the prefab's nodes show which state (from `look.ts`), and
// which parts act when touched (the same actions the server takes from the 2D view). Every node
// is found by the original's own path; without the scene pack the same nodes are plain boxes
// (`part`'s fallback), laid out as the module's face roughly is.
import * as THREE from 'three';
import { MORSE } from '../../logic/data.ts';
import { SIMON_COLOURS } from '../../logic/modules.ts';
import type { Dir, ModuleOp } from '../../logic/types.ts';
import { type Look, SIMON_PLACE } from './look.ts';
import {
  GLOWS,
  type Pack,
  type Root,
  find,
  findAll,
  flat,
  instantiate,
  onAnchor,
  part,
  textPlane,
  isMesh,
} from './rig.ts';

/** What touching a part does: the action, the press/release pair of a held part, the punch. */
export interface Hit {
  op: ModuleOp;
  /** Held parts (the Button, the capacitor's lever) send `release` when let go. */
  release?: ModuleOp;
  /** The interaction punch's modifier (`AddInteractionPunch`). */
  punch: number;
  /** A sound to play on the device straight away (the server's answer may take a moment). */
  sound?: 'press-in' | 'bb-press-in' | 'snip' | 'switch' | 'tone';
  tone?: number;
  /** A part that dips when pressed (keys, buttons). */
  dip?: THREE.Object3D;
}

export interface Fonts {
  digits: string;
  labels: string;
  morse: string;
}

export interface BindCtx {
  pack: Pack | null;
  fonts: Fonts;
  touch: boolean;
  /** A tone from the device's tone generator (the capacitor's rising whine). */
  beep: (freq: number, ms: number, gain: number) => void;
  /** The keypad's glyph pictures (null without the manifest). */
  glyph: (n: number) => string | null;
}

export interface Binding {
  root: Root;
  /** Shows the module's state. */
  apply: (look: Look, now: number) => void;
  /** Parts the keyboard's 1–9 keys reach, in reading order. */
  parts: () => THREE.Object3D[];
  /** Thin parts picked by screen distance (wires). */
  thin: () => THREE.Object3D[];
  /** The module is focused (the Button's lid opens) or left. */
  focus?: (on: boolean) => void;
  /** How much of the screen's short side the module fills when focused (touch zooms closer). */
  fill: number;
}

/** A part the player can touch: the scene finds `userData.hit` on it or an ancestor. */
const hitOn = (o: THREE.Object3D, hit: () => Hit | null) => {
  o.userData.hit = hit;
  return o;
};

const PLAIN = {
  panel: 0x77736a,
  dark: 0x1d1d1f,
  key: 0xd8d2c4,
  metal: 0x9a9a9a,
};
const WIRE_RGB: Record<string, number> = {
  black: 0x1c1917,
  blue: 0x2563eb,
  red: 0xdc2626,
  white: 0xf5f5f4,
  yellow: 0xfacc15,
  green: 0x16a34a,
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The status light on `StatusLightParent`. */
function statusLight(ctx: BindCtx, root: Root) {
  const at = part(root, 'StatusLightParent', {
    at: [0.075, 0.075, 0.02],
    size: [0, 0, 0],
    colour: 0,
  });
  const led = instantiate(ctx.pack, 'statusLight');
  at.add(led);
  const off = part(led, 'Component_LED_OFF', {
    at: [0, 0, 0],
    size: [0.018, 0.018, 0.006],
    colour: 0x333333,
  });
  const pass = part(led, 'Component_LED_PASS', {
    at: [0, 0, 0.001],
    size: [0.018, 0.018, 0.006],
    colour: 0x30ff50,
  });
  const strike = part(led, 'Component_LED_STRIKE', {
    at: [0, 0, 0.001],
    size: [0.018, 0.018, 0.006],
    colour: 0xff2a10,
  });
  tint(led);
  return (s: Look['led']) => {
    off.visible = s === 'off' || s === null;
    pass.visible = s === 'pass';
    strike.visible = s === 'strike';
  };
}

/** The glow sprites take their light's colour: red for strikes and the timer, green for a pass. */
export function tint(root: THREE.Object3D, colour?: number) {
  root.traverse((o) => {
    if (o.name !== 'LightGlow' || !isMesh(o)) return;
    const p = o.parent?.name ?? '';
    const col =
      colour ??
      (/PASS/.test(p)
        ? 0x30ff50
        : /STRIKE/.test(p)
          ? 0xff2a10
          : /LED_(\w+)/.test(p)
            ? ({ Red: 0xff3020, Blue: 0x3060ff, White: 0xffffff, Yellow: 0xffd020 }[
                p.match(/LED_(\w+)/)![1]!
              ] ?? 0xffffff)
            : 0xffffff);
    const m = (o.material as THREE.MeshBasicMaterial).clone();
    m.color.set(col);
    m.opacity = 0.55;
    o.material = m;
  });
}

const glow = (o: THREE.Object3D | undefined, on: boolean) => {
  o?.traverse((x) => {
    if (!isMesh(x)) return;
    for (const m of ([] as THREE.Material[]).concat(x.material)) {
      const l = m as THREE.MeshLambertMaterial;
      if (l.userData[GLOWS] && l.emissive) l.emissive.set(on ? 0xffffff : 0x000000);
      else if (l.emissive && x.userData.plain) l.emissive.set(on ? 0x666666 : 0x000000);
    }
  });
};

/** `StageIndicatorBar`: `n` lamps along the bar, lit from the first. */
function stageBar(ctx: BindCtx, root: Root, n: number) {
  const bar = part(root, 'StageIndicator', {
    at: [0.075, -0.02, 0.01],
    size: [0, 0, 0],
    colour: 0,
  });
  const step = 0.105 / (n + 1);
  const lamps = Array.from({ length: n }, (_, i) => {
    const z = -0.105 / 2 + step * (i + 1);
    const off = instantiate(ctx.pack, 'StageIndicatorLED_Off');
    const on = instantiate(ctx.pack, 'StageIndicatorLED_On');
    for (const [o, c] of [
      [off, 0x333333],
      [on, 0x40ff60],
    ] as const) {
      if (o.userData.plain) {
        const b = part(o, 'lamp', { at: [0, 0, 0], size: [0.012, 0.008, 0.004], colour: c });
        b.userData.plain = true;
      }
      o.position.set(0, 0, z);
      bar.add(o);
    }
    return { off, on };
  });
  // The original's bar runs from its far end in prefab space: the first stage is the bottom lamp.
  lamps.reverse();
  return (lit: number) =>
    lamps.forEach((l, i) => {
      l.on.visible = i < lit;
      l.off.visible = i >= lit;
    });
}

/** A cut wire's two halves spring a few millimetres apart (`SnippableWire`). */
function part_(cut: THREE.Object3D) {
  const [a, b] = cut.children;
  if (!a || !b) return;
  if (!cut.userData.apart) {
    // Apart along the line between the halves' middles.
    const mid = (o: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(o);
      return box.isEmpty()
        ? o.position.clone()
        : cut.worldToLocal(box.getCenter(new THREE.Vector3()));
    };
    cut.updateWorldMatrix(true, true);
    const dir = mid(b).sub(mid(a)).normalize();
    cut.userData.apart = { dir, a: a.position.clone(), b: b.position.clone(), t: 0 };
  }
  const p = cut.userData.apart as {
    dir: THREE.Vector3;
    a: THREE.Vector3;
    b: THREE.Vector3;
    t: number;
  };
  p.t += (1 - p.t) * 0.25;
  a.position.copy(p.a).addScaledVector(p.dir, -0.002 * p.t);
  b.position.copy(p.b).addScaledVector(p.dir, 0.002 * p.t);
}

/** A key that sinks out of reach and rises again (Who's on First, Memory). */
function sinker(o: THREE.Object3D, depth: number) {
  const rest = o.position.y;
  return (up: boolean) => {
    const want = up ? rest : rest - depth;
    o.position.y += (want - o.position.y) * 0.25;
  };
}

// ---- The modules ----

function wires(ctx: BindCtx, root: Root): Binding {
  const led = statusLight(ctx, root);
  part(root, 'Component_PuzzleBackground', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  type W = {
    node: THREE.Object3D;
    colours: Map<string, { whole: THREE.Object3D; cut: THREE.Object3D }>;
  };
  const slots: W[] = [];
  for (let n = 1; n <= 6; n++) {
    const node = part(root, `Model/All_Wires/SnippableWire_${n}`);
    const colours = new Map<string, { whole: THREE.Object3D; cut: THREE.Object3D }>();
    for (const c of ['black', 'blue', 'red', 'white', 'yellow']) {
      const C = cap(c);
      const y = 0.07 - (n - 1) * 0.028;
      const g = part(root, `SnippableWire_${n}/${C}`, {
        at: [0, 0, 0],
        size: [0, 0, 0],
        colour: 0,
        parent: node,
      });
      const whole = part(root, `${C}/Wires_${n}_${C}`, {
        at: [-0.01, y, 0.012],
        size: [0.15, 0.006, 0.006],
        colour: WIRE_RGB[c]!,
        parent: g,
      });
      const cut = part(root, `${C}/Wires_Snipped_GRP_${n}_${C}`, {
        at: [0, 0, 0],
        size: [0, 0, 0],
        colour: 0,
        parent: g,
      });
      if (root.userData.plain) {
        part(root, `Wires_Snipped_GRP_${n}_${C}/L`, {
          at: [-0.06, y, 0.012],
          size: [0.06, 0.006, 0.006],
          colour: WIRE_RGB[c]!,
          parent: cut,
        });
        part(root, `Wires_Snipped_GRP_${n}_${C}/R`, {
          at: [0.04, y, 0.012],
          size: [0.06, 0.006, 0.006],
          colour: WIRE_RGB[c]!,
          parent: cut,
        });
      }
      colours.set(c, { whole, cut });
    }
    slots.push({ node, colours });
  }
  let cur: Extract<Look, { kind: 'wires' }> | null = null;
  const thin: THREE.Object3D[] = [];
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'wires') return;
      led(look.led);
      cur = look;
      thin.length = 0;
      slots.forEach((s, i) => {
        const w = look.wires.find((x) => x.slot === i);
        s.node.visible = !!w;
        for (const [c, v] of s.colours) {
          const on = !!w && w.colour === c;
          v.whole.parent!.visible = on;
          v.whole.visible = on && !w.cut;
          v.cut.visible = on && w.cut;
          if (on && w.cut) part_(v.cut);
          if (on && !w.cut) {
            const index = look.wires.indexOf(w);
            hitOn(v.whole, () => ({ op: { op: 'cut', wire: index }, punch: 1, sound: 'snip' }));
            thin.push(v.whole);
          }
        }
      });
    },
    parts: () =>
      cur
        ? cur.wires.flatMap((w) => {
            const v = slots[w.slot]!.colours.get(w.colour)!;
            return w.cut ? [] : [v.whole];
          })
        : [],
    thin: () => thin,
  };
}

function button(ctx: BindCtx, root: Root): Binding {
  const led = statusLight(ctx, root);
  part(root, 'Component_PuzzleBackground', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const top = part(root, 'Button/ButtonTop', {
    at: [-0.02, 0.01, 0.02],
    size: [0, 0, 0],
    colour: 0,
  });
  const caps = new Map(
    ['red', 'blue', 'white', 'yellow'].map((c) => [
      c,
      part(root, `ButtonTop/Button_Top_${cap(c)}`, {
        at: [0, 0, 0],
        size: [0.11, 0.11, 0.02],
        colour: WIRE_RGB[c]!,
        parent: top,
      }),
    ]),
  );
  find(root, 'ButtonTop/Button_Top_Green')?.removeFromParent();
  const strip = new Map(
    ['Off', 'Red', 'White', 'Blue', 'Yellow'].map((c) => [
      c,
      part(root, `Button/parts/LED_${c}`, {
        at: [0.08, -0.01, 0.012],
        size: [0.014, 0.12, 0.006],
        colour: c === 'Off' ? 0x333333 : WIRE_RGB[c.toLowerCase()]!,
      }),
    ]),
  );
  tint(root);
  const label = part(root, 'ButtonTop/ButtonInstruction', {
    at: [0, 0, 0.012],
    size: [0, 0, 0],
    colour: 0,
    parent: top,
  });
  const text = textPlane(0.07, 0.022, (px) => `${Math.round(px * 0.9)}px ${ctx.fonts.labels}`, {
    colour: '#f4f2ee',
  });
  onAnchor(label, text);
  if (root.userData.plain) flat(text);
  const lid = find(root, 'Button/Opening_LID');
  const lidClosed = lid?.quaternion.clone();
  let lidOpen = false;
  let lidT = 1;
  const rest = top.position.y;
  let down = false;
  hitOn(top, () => ({
    op: { op: 'down' },
    release: { op: 'up' },
    punch: 0.5,
    sound: 'bb-press-in',
  }));
  const base = find(root, 'Button/parts/base');
  if (base)
    hitOn(base, () => ({
      op: { op: 'down' },
      release: { op: 'up' },
      punch: 0.5,
      sound: 'bb-press-in',
    }));
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'button') return;
      led(look.led);
      for (const [c, o] of caps) o.visible = c === look.colour;
      for (const [c, o] of strip)
        o.visible = look.strip ? c.toLowerCase() === look.strip : c === 'Off';
      const dark = look.colour === 'white' || look.colour === 'yellow';
      text.userData.set(look.label, dark ? '#1c1917' : '#f4f2ee');
      down = look.down;
      top.position.y += (rest - (down ? 0.008 : 0) - top.position.y) * 0.4;
      if (lid && lidClosed && lidT < 1) {
        lidT = Math.min(1, lidT + 1 / 18);
        const open = lidClosed
          .clone()
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.9));
        const [a, b] = lidOpen ? [lidClosed, open] : [open, lidClosed];
        lid.quaternion.slerpQuaternions(a, b, -(Math.cos(Math.PI * lidT) - 1) / 2);
      }
    },
    focus: (on) => {
      if (on === lidOpen) return;
      lidOpen = on;
      lidT = 0;
    },
    parts: () => [top],
    thin: () => [],
  };
}

function keypad(ctx: BindCtx, root: Root): Binding {
  const led = statusLight(ctx, root);
  part(root, 'Model/PuzzleBackground', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const corner = ['TL', 'TR', 'BL', 'BR'];
  const loader = new THREE.TextureLoader();
  const keys = [0, 1, 2, 3].map((i) => {
    const at: [number, number, number] = [
      (i % 2 ? 1 : -1) * 0.035,
      (i < 2 ? 1 : -1) * 0.035 - 0.01,
      0.012,
    ];
    const btn = part(root, `Model/Button${i + 1}`);
    const key = part(root, `Button${i + 1}/Key_${corner[i]}`, {
      at,
      size: [0.055, 0.055, 0.012],
      colour: PLAIN.key,
      parent: btn,
    });
    const ledOf = (n: string, c: number) =>
      part(root, `Key_${corner[i]}/LED_${n}`, {
        at: [0, 0.022, 0.007],
        size: [0.016, 0.005, 0.003],
        colour: c,
        parent: key,
      });
    const leds = {
      off: ledOf('Off', 0x333333),
      correct: ledOf('Correct', 0x40ff60),
      wrong: ledOf('Wrong', 0xff3020),
    };
    const sym = find(root, `Button${i + 1}/SymbolImage`);
    let symbol: THREE.Mesh;
    if (isMesh(sym)) {
      // The symbol goes down with its key.
      const p = sym.position.clone().sub(key.position);
      key.add(sym);
      sym.position.copy(p);
      symbol = sym;
    } else {
      symbol = new THREE.Mesh(
        new THREE.PlaneGeometry(0.04, 0.04),
        new THREE.MeshBasicMaterial({ transparent: true }),
      );
      flat(symbol);
      symbol.position.set(0, 0.0065, 0.004);
      key.add(symbol);
    }
    hitOn(key, () => ({ op: { op: 'press', button: i }, punch: 1, sound: 'press-in', dip: key }));
    return { key, leds, symbol, glyph: -1 };
  });
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'keypad') return;
      led(look.led);
      keys.forEach((k, i) => {
        const s = look.keys[i] ?? 'off';
        k.leds.off.visible = s === 'off';
        k.leds.correct.visible = s === 'correct';
        k.leds.wrong.visible = s === 'wrong';
        const g = look.symbols[i] ?? -1;
        if (g !== k.glyph) {
          k.glyph = g;
          const url = ctx.glyph(g);
          if (url) {
            const t = loader.load(url);
            t.colorSpace = THREE.SRGBColorSpace;
            k.symbol.material = new THREE.MeshLambertMaterial({
              map: t,
              transparent: true,
              depthWrite: false,
              side: THREE.DoubleSide,
            });
          } else {
            const p = textPlane(0.04, 0.04, (px) => `${Math.round(px * 0.8)}px serif`, {
              colour: '#111',
            });
            p.userData.set(String(g));
            k.symbol.material = p.material;
          }
        }
      });
    },
    parts: () => keys.map((k) => k.key),
    thin: () => [],
  };
}

function simon(ctx: BindCtx, root: Root, tone: (i: number) => void): Binding {
  const led = statusLight(ctx, root);
  part(root, 'Component_PuzzleBackground', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const PLACE_AT: Record<string, [number, number]> = {
    left: [-0.045, 0],
    top: [0, 0.045],
    bottom: [0, -0.045],
    right: [0.045, 0],
  };
  const pads = SIMON_COLOURS.map((c, i) => {
    const place = SIMON_PLACE[c];
    const [x, y] = PLACE_AT[place]!;
    const node = part(root, `simonbutton-${place}/button`, {
      at: [x, y, 0.012],
      size: [0.04, 0.04, 0.01],
      colour: WIRE_RGB[c]!,
    });
    if (root.userData.plain && isMesh(node)) node.userData.plain = true;
    hitOn(node, () => ({
      op: { op: 'press', button: i },
      punch: 0.6,
      sound: 'tone',
      tone: i,
      dip: node,
    }));
    return node;
  });
  let last = -1;
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'simon') return;
      led(look.led);
      pads.forEach((p, i) =>
        glow(p, look.lit === i || p.userData.pressedUntil > performance.now()),
      );
      // The first stage's flashes are silent; tones play from the second (`lastIndex > 0`).
      if (look.lit >= 0 && look.lit !== last && look.stage > 0) tone(look.lit);
      last = look.lit;
    },
    parts: () => pads,
    thin: () => [],
  };
}

function whosOnFirst(ctx: BindCtx, root: Root): Binding {
  const led = statusLight(ctx, root);
  const bar = stageBar(ctx, root, 3);
  part(root, 'Component_PuzzleBackground', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const screen = part(root, 'DisplayText', {
    at: [-0.02, 0.06, 0.016],
    size: [0, 0, 0],
    colour: 0,
  });
  const display = textPlane(0.1, 0.028, (px) => `${Math.round(px * 0.8)}px ${ctx.fonts.labels}`, {
    colour: '#e8f4ff',
  });
  onAnchor(screen, display, 0.03, -0.003);
  const KEY = ['TL', 'TR', 'ML', 'MR', 'BL', 'BR'];
  const buttons = KEY.map((k, i) => {
    const off = part(root, `Component_Whose/button${i}/ModelPositionOffset`, {
      at: [(i % 2 ? 1 : -1) * 0.035 - 0.012, 0.015 - Math.floor(i / 2) * 0.035, 0.012],
      size: [0, 0, 0],
      colour: 0,
    });
    const key = part(root, `ModelPositionOffset/Key_${k}`, {
      at: [0, 0, 0],
      size: [0.055, 0.025, 0.01],
      colour: PLAIN.key,
      parent: off,
    });
    const anchor = part(root, `button${i}/ModelPositionOffset/ButtonText`, {
      at: [0, 0, 0.006],
      size: [0, 0, 0],
      colour: 0,
      parent: off,
    });
    const text = textPlane(0.05, 0.016, (px) => `${Math.round(px * 0.85)}px ${ctx.fonts.labels}`, {
      colour: '#1c1917',
    });
    onAnchor(anchor, text);
    if (root.userData.plain) flat(text);
    hitOn(key, () => ({ op: { op: 'press', button: i }, punch: 1, sound: 'press-in', dip: key }));
    return { off, key, text, sink: sinker(off, 0.012) };
  });
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'whos-on-first') return;
      led(look.led);
      bar(look.stages);
      display.userData.set(look.display);
      buttons.forEach((b, i) => {
        b.sink(look.up);
        b.text.userData.set(look.up ? (look.labels[i] ?? '') : '');
      });
    },
    parts: () => buttons.map((b) => b.key),
    thin: () => [],
  };
}

function memory(ctx: BindCtx, root: Root): Binding {
  const led = statusLight(ctx, root);
  const bar = stageBar(ctx, root, 5);
  part(root, 'Component_PuzzleBackground', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const screen = part(root, 'DisplayText', {
    at: [-0.015, 0.04, 0.016],
    size: [0, 0, 0],
    colour: 0,
  });
  const display = textPlane(0.06, 0.06, (px) => `${Math.round(px * 0.85)}px ${ctx.fonts.labels}`, {
    colour: '#e8f4ff',
  });
  onAnchor(screen, display);
  const KEY = ['A', 'B', 'C', 'D'];
  const buttons = KEY.map((k, i) => {
    const holder = part(root, `button${i}`, {
      at: [-0.06 + i * 0.03, -0.05, 0.012],
      size: [0, 0, 0],
      colour: 0,
    });
    const key = part(root, `button${i}/KEY_${k}`, {
      at: [0, 0, 0],
      size: [0.024, 0.04, 0.012],
      colour: PLAIN.key,
      parent: holder,
    });
    const anchor = part(root, `KEY_${k}/ButtonText`, {
      at: [0, 0, 0.007],
      size: [0, 0, 0],
      colour: 0,
      parent: key,
    });
    const text = textPlane(0.02, 0.024, (px) => `${Math.round(px * 0.85)}px ${ctx.fonts.labels}`, {
      colour: '#1c1917',
    });
    onAnchor(anchor, text);
    if (root.userData.plain) flat(text);
    hitOn(key, () => ({ op: { op: 'press', button: i }, punch: 1, sound: 'press-in', dip: key }));
    return { key, text, sink: sinker(holder, 0.012) };
  });
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'memory') return;
      led(look.led);
      bar(look.stages);
      display.userData.set(look.display);
      buttons.forEach((b, i) => {
        b.sink(look.up);
        b.text.userData.set(look.up ? (look.labels[i] ?? '') : '');
      });
    },
    parts: () => buttons.map((b) => b.key),
    thin: () => [],
  };
}

function morse(ctx: BindCtx, root: Root): Binding {
  const led = statusLight(ctx, root);
  part(root, 'Component_PuzzleBackground', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const lit = part(root, 'Component_Morse/LED_Lit', {
    at: [-0.06, 0.06, 0.012],
    size: [0.02, 0.02, 0.008],
    colour: 0xffc040,
  });
  const unlit = part(root, 'Component_Morse/LED_Unlit', {
    at: [-0.06, 0.06, 0.012],
    size: [0.02, 0.02, 0.008],
    colour: 0x554433,
  });
  tint(lit, 0xffc040);
  const screen = part(root, 'MorseComponent/DisplayText', {
    at: [0.0, -0.005, 0.014],
    size: [0, 0, 0],
    colour: 0,
  });
  const freq = textPlane(0.07, 0.022, (px) => `${Math.round(px * 0.85)}px ${ctx.fonts.digits}`, {
    colour: '#ffb02e',
  });
  onAnchor(screen, freq);
  if (root.userData.plain) flat(freq);
  const start = part(root, 'Component_Morse/StartPoint', {
    at: [-0.06, 0.02, 0.012],
    size: [0, 0, 0],
    colour: 0,
  });
  const end = part(root, 'Component_Morse/EndPoint', {
    at: [0.06, 0.02, 0.012],
    size: [0, 0, 0],
    colour: 0,
  });
  const marker = part(root, 'Component_Morse/Freq_Marker', {
    at: [-0.06, 0.02, 0.013],
    size: [0.003, 0.02, 0.003],
    colour: 0xff3030,
  });
  const markerRest = marker.position.clone();
  const left = part(root, 'Component_Morse/Button_LEFT', {
    at: [-0.06, -0.005, 0.012],
    size: [0.02, 0.02, 0.01],
    colour: PLAIN.key,
  });
  const right = part(root, 'Component_Morse/Button_RIGHT', {
    at: [0.06, -0.005, 0.012],
    size: [0.02, 0.02, 0.01],
    colour: PLAIN.key,
  });
  const tx = part(root, 'Component_Morse/button_transmit', {
    at: [0, -0.05, 0.012],
    size: [0.06, 0.02, 0.01],
    colour: PLAIN.key,
  });
  hitOn(left, () => ({ op: { op: 'dial', by: -1 }, punch: 0.5, sound: 'press-in', dip: left }));
  hitOn(right, () => ({ op: { op: 'dial', by: 1 }, punch: 0.5, sound: 'press-in', dip: right }));
  hitOn(tx, () => ({ op: { op: 'tx' }, punch: 1, sound: 'press-in', dip: tx }));
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'morse') return;
      led(look.led);
      lit.visible = look.lit;
      unlit.visible = !look.lit;
      freq.userData.set(look.freq);
      // The marker slides along the scale from the first frequency to the last.
      const f = look.dial / (MORSE.length - 1);
      const want = markerRest
        .clone()
        .add(end.position.clone().sub(start.position).multiplyScalar(f));
      marker.position.lerp(want, 0.3);
    },
    parts: () => [left, right, tx],
    thin: () => [],
  };
}

const VENN_GROUP: Record<string, string> = {
  white: 'White',
  red: 'Red',
  blue: 'Blue',
  'red-white': 'RedWhite',
  'blue-white': 'BlueWhite',
  'red-blue': 'RedBlue',
};

function venn(ctx: BindCtx, root: Root): Binding {
  const led = statusLight(ctx, root);
  part(root, 'Component_PuzzleBackground', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const slots = Array.from({ length: 6 }, (_, k) => {
    const n = k + 1;
    const x = -0.075 + k * 0.03;
    const lamp = part(root, `Component_VennWires/LED_${n}_ON`, {
      at: [x, 0.07, 0.012],
      size: [0.012, 0.008, 0.006],
      colour: 0xfff6c0,
    });
    const star = part(root, `Component_VennWires/Booleans/Boolean_${n}`, {
      at: [x, -0.075, 0.012],
      size: [0.014, 0.014, 0.002],
      colour: 0x111111,
    });
    const groups = new Map(
      Object.entries(VENN_GROUP).map(([c, G]) => {
        const g = part(root, `Component_VennWires/${G}`);
        const [c1, c2] = c.split('-');
        const whole = part(root, `${G}/Wires_Unsnipped_${n}`, {
          at: [x, 0, 0.012],
          size: [0.006, 0.12, 0.006],
          colour: WIRE_RGB[c2 ?? c1!]!,
          parent: g,
        });
        const cut = part(root, `${G}/Wires_Snipped_${n}`, {
          at: [0, 0, 0],
          size: [0, 0, 0],
          colour: 0,
          parent: g,
        });
        if (root.userData.plain) {
          part(root, `${G}/Wires_Snipped_${n}/L`, {
            at: [x, 0.04, 0.012],
            size: [0.006, 0.04, 0.006],
            colour: WIRE_RGB[c1!]!,
            parent: cut,
          });
          part(root, `${G}/Wires_Snipped_${n}/R`, {
            at: [x, -0.04, 0.012],
            size: [0.006, 0.04, 0.006],
            colour: WIRE_RGB[c1!]!,
            parent: cut,
          });
        }
        return [c, { whole, cut }] as const;
      }),
    );
    return { lamp, star, groups };
  });
  const thin: THREE.Object3D[] = [];
  let cur: Extract<Look, { kind: 'complicated-wires' }> | null = null;
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'complicated-wires') return;
      led(look.led);
      cur = look;
      thin.length = 0;
      slots.forEach((s, k) => {
        const w = look.wires.find((x) => x.slot === k);
        s.lamp.visible = !!w?.led;
        s.star.visible = !!w?.star;
        for (const [c, v] of s.groups) {
          const on = !!w && w.colour === c;
          v.whole.visible = on && !w.cut;
          v.cut.visible = on && w.cut;
          if (on && w.cut) part_(v.cut);
          if (on && !w.cut) {
            const index = look.wires.indexOf(w);
            hitOn(v.whole, () => ({ op: { op: 'cut', wire: index }, punch: 1, sound: 'snip' }));
            thin.push(v.whole);
          }
        }
      });
    },
    parts: () =>
      cur
        ? cur.wires.flatMap((w) => (w.cut ? [] : [slots[w.slot]!.groups.get(w.colour)!.whole]))
        : [],
    thin: () => thin,
  };
}

const SEQ_RGB = { red: 0xb3221c, blue: 0x2148b8, black: 0x1a1a1a } as const;

function sequence(ctx: BindCtx, root: Root): Binding {
  const led = statusLight(ctx, root);
  const bar = stageBar(ctx, root, 4);
  part(root, 'Component_WireSequence/Component_PuzzleBackground_WireSequence', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const anchor = part(root, 'Component_WireSequence/PageAnchor', {
    at: [-0.01, 0.0, 0.012],
    size: [0, 0, 0],
    colour: 0,
  });
  const page = instantiate(ctx.pack, 'WireSequencePageTemplate');
  anchor.add(page);
  const doorL = part(root, 'Component_WireSequence/Door_L', {
    at: [-0.04, 0.0, 0.02],
    size: [0.06, 0.13, 0.004],
    colour: 0x555555,
  });
  const doorR = part(root, 'Component_WireSequence/Door_R', {
    at: [0.02, 0.0, 0.02],
    size: [0.06, 0.13, 0.004],
    colour: 0x555555,
  });
  const restL = doorL.position.clone();
  const restR = doorR.position.clone();
  const down = part(root, 'Component_WireSequence/ButtonDown', {
    at: [0.075, -0.05, 0.012],
    size: [0.025, 0.02, 0.01],
    colour: PLAIN.key,
  });
  const up = part(root, 'Component_WireSequence/ButtonUp', {
    at: [0.075, 0.05, 0.012],
    size: [0.025, 0.02, 0.01],
    colour: PLAIN.key,
  });
  hitOn(down, () => ({ op: { op: 'next' }, punch: 0.5, sound: 'press-in', dip: down }));
  hitOn(up, () => ({ op: { op: 'back' }, punch: 0.5, sound: 'press-in', dip: up }));
  const numbers = ['OneText', 'TwoText', 'ThreeText'].map((n, r) => {
    const a = part(page, n, { at: [-0.05, 0.035 - r * 0.035, 0.004], size: [0, 0, 0], colour: 0 });
    const t = textPlane(0.016, 0.016, (px) => `${Math.round(px * 0.85)}px ${ctx.fonts.labels}`, {
      colour: '#f4f2ee',
    });
    onAnchor(a, t);
    if (page.userData.plain) flat(t);
    return t;
  });
  ['AText', 'BText', 'CText'].forEach((n, r) => {
    const a = part(page, n, { at: [0.05, 0.035 - r * 0.035, 0.004], size: [0, 0, 0], colour: 0 });
    const t = textPlane(0.016, 0.016, (px) => `${Math.round(px * 0.85)}px ${ctx.fonts.labels}`, {
      colour: '#f4f2ee',
    });
    onAnchor(a, t);
    if (page.userData.plain) flat(t);
    t.userData.set('ABC'[r]!);
  });
  const wire = (row: number, to: number) => {
    const name = `Scale/Wire_${row + 1}${'ABC'[to]}`;
    const g = part(page, name);
    const y0 = 0.035 - row * 0.035;
    const y1 = 0.035 - to * 0.035;
    const whole = part(page, `${name}/Wire_Unsnipped`, {
      at: [0, (y0 + y1) / 2, 0.004],
      size: [0.09, 0.005, 0.005],
      colour: 0x888888,
      parent: g,
    });
    const cut = part(page, `${name}/Wire_Snipped`, {
      at: [0, 0, 0],
      size: [0, 0, 0],
      colour: 0,
      parent: g,
    });
    if (page.userData.plain) {
      part(page, `${name}/Wire_Snipped/Wire_SnippedL`, {
        at: [-0.03, y0, 0.004],
        size: [0.03, 0.005, 0.005],
        colour: 0x888888,
        parent: cut,
      });
      part(page, `${name}/Wire_Snipped/Wire_SnippedR`, {
        at: [0.03, y1, 0.004],
        size: [0.03, 0.005, 0.005],
        colour: 0x888888,
        parent: cut,
      });
    }
    return { g, whole, cut };
  };
  const wires = [0, 1, 2].map((r) => [0, 1, 2].map((t) => wire(r, t)));
  const paint = (o: THREE.Object3D, colour: number) =>
    o.traverse((x) => {
      if (!isMesh(x)) return;
      const ms = ([] as THREE.Material[]).concat(x.material);
      ms.forEach((m, i) => {
        // The wire's own material (`?` in the pack, the first slot) takes the colour.
        if (i === 0 && (m as THREE.MeshLambertMaterial).color)
          (m as THREE.MeshLambertMaterial).color.set(colour);
      });
    });
  const thin: THREE.Object3D[] = [];
  let open = 0;
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'wire-sequence') return;
      led(look.led);
      bar(look.done ? 4 : look.page);
      thin.length = 0;
      page.visible = !!look.row;
      numbers.forEach((t, r) => t.userData.set(String(look.page * 3 + r + 1)));
      wires.forEach((row, r) =>
        row.forEach((w, to) => {
          const e = look.row?.[r];
          const on = !!e && !!e.colour && e.to === to;
          w.g.visible = on;
          if (!on || !e?.colour) return;
          paint(w.g, SEQ_RGB[e.colour]);
          w.whole.visible = !e.cut;
          w.cut.visible = e.cut;
          if (!e.cut) {
            hitOn(w.whole, () => ({ op: { op: 'cut', wire: r }, punch: 1, sound: 'snip' }));
            thin.push(w.whole);
          }
        }),
      );
      // The doors slide shut while the panel changes and once it is finished.
      const want = look.row ? 1 : 0;
      open += (want - open) * 0.2;
      doorL.position.copy(restL).add(new THREE.Vector3(-0.055 * open, 0, 0));
      doorR.position.copy(restR).add(new THREE.Vector3(0.055 * open, 0, 0));
    },
    parts: () => [...thin, up, down],
    thin: () => thin,
  };
}

function maze(ctx: BindCtx, root: Root): Binding {
  const led = statusLight(ctx, root);
  const layout =
    ctx.touch && find(root, 'Component_Maze/Layout_TOUCH') ? 'Layout_TOUCH' : 'Layout_DEFAULT';
  const other = find(
    root,
    `Component_Maze/${layout === 'Layout_TOUCH' ? 'Layout_DEFAULT' : 'Layout_TOUCH'}`,
  );
  if (other) other.visible = false;
  part(root, `${layout}/Component_PuzzleBackground_modified`, {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const on = part(root, `${layout}/ScreenOn`, {
    at: [0, 0, 0.011],
    size: [0.13, 0.13, 0.002],
    colour: 0x10241a,
  });
  const off = part(root, `${layout}/ScreenOff`, {
    at: [0, 0, 0.011],
    size: [0.13, 0.13, 0.002],
    colour: 0x111111,
  });
  const arrows: [Dir, string, [number, number]][] = [
    ['up', 'Button_TOP', [0, 0.085]],
    ['down', 'Button_BOT', [0, -0.085]],
    ['left', 'Button_LEFT', [-0.085, 0]],
    ['right', 'Button_RIGHT', [0.085, 0]],
  ];
  const buttons = arrows.map(([dir, n, [x, y]]) => {
    const b = part(root, `${layout}/${n}`, {
      at: [x, y, 0.012],
      size: [0.02, 0.02, 0.01],
      colour: PLAIN.key,
    });
    hitOn(b, () => ({ op: { op: 'move', dir }, punch: 0.5, sound: 'press-in', dip: b }));
    return b;
  });
  // `InvisibleWallsComponent.InitCells`: 6 × 6 cells over 90 % of the screen, row 0 at the top.
  const grid = new THREE.Group();
  root.add(grid);
  const sb = new THREE.Box3();
  if (isMesh(on)) {
    on.geometry.computeBoundingBox();
    sb.copy(on.geometry.boundingBox!).applyMatrix4(on.matrix);
    if (on.parent && on.parent !== root) {
      on.parent.updateMatrix();
      sb.applyMatrix4(on.parent.matrix);
    }
  }
  const size = sb.isEmpty()
    ? new THREE.Vector3(0.13, 0.002, 0.13)
    : sb.getSize(new THREE.Vector3());
  const centre = sb.isEmpty() ? new THREE.Vector3(0, 0.012, 0) : sb.getCenter(new THREE.Vector3());
  const cellSize = (0.9 * size.x) / 6;
  const cellAt = (x: number, y: number) =>
    new THREE.Vector3(
      centre.x - 0.45 * size.x + (x + 0.5) * cellSize,
      sb.isEmpty() ? 0.013 : sb.max.y + 0.0005,
      centre.z - 0.45 * size.z + (y + 0.5) * cellSize,
    );
  const proto = (n: string, colour: number, s: number) => {
    const found = find(root, n);
    if (isMesh(found)) {
      const c = found.clone();
      c.visible = true;
      return c;
    }
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(s, 0.002, s),
      new THREE.MeshBasicMaterial({ color: colour }),
    );
    return m;
  };
  const circles = [0, 1].map(() =>
    proto('InvisibleWallsCell/Maze_Circle1', 0x30c040, cellSize * 0.8),
  );
  const goal = proto('InvisibleWallsCell/Maze_Triangle', 0xff3030, cellSize * 0.6);
  const player = proto('PlayerIndicator', 0xffffff, cellSize * 0.35);
  for (const o of [...circles, goal, player]) {
    o.position.set(0, 0, 0);
    grid.add(o);
  }
  const sizeOf = (o: THREE.Object3D, rel: number) => {
    if (isMesh(o) && find(root, 'PlayerIndicator')) return;
    o.scale.setScalar(rel);
  };
  sizeOf(player, 1);
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'maze') return;
      led(look.led);
      on.visible = look.on;
      off.visible = !look.on;
      grid.visible = look.on;
      circles.forEach((c, i) => {
        const at = look.circles[i];
        c.visible = !!at;
        if (at) c.position.copy(cellAt(at[0], at[1]));
      });
      goal.position.copy(cellAt(look.goal[0], look.goal[1]));
      goal.visible = !look.led || look.led !== 'pass';
      player.position.copy(cellAt(look.at[0], look.at[1]));
      player.position.y += 0.0004;
    },
    parts: () => buttons,
    thin: () => [],
  };
}

function password(ctx: BindCtx, root: Root): Binding {
  const led = statusLight(ctx, root);
  const layout = ctx.touch ? 'Layout_TOUCH' : 'Layout_DEFAULT';
  const other = find(
    root,
    ctx.touch ? 'PasswordComponent/Layout_DEFAULT' : 'PasswordComponent/Layout_TOUCH',
  );
  if (other) other.visible = false;
  part(root, 'Component_PuzzleBackground', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const backOn = find(root, `${layout}/Component_Password_with/Backing_On`);
  const backOff = find(root, `${layout}/Component_Password_with/Backing_Off`);
  const columns = [0, 1, 2, 3, 4].map((c) => {
    const x = -0.07 + c * 0.032;
    const spinner = part(root, `${layout}/Spinner${c + 1}/SpinnerText`, {
      at: [x, 0.01, 0.014],
      size: [0, 0, 0],
      colour: 0,
    });
    const text = textPlane(0.022, 0.03, (px) => `${Math.round(px * 0.8)}px ${ctx.fonts.labels}`, {
      colour: '#1d2a14',
    });
    onAnchor(spinner, text);
    if (root.userData.plain) flat(text);
    const up = part(root, `${layout}/Component_Password_with/Button_TOP/Button_TOP_0${c + 1}`, {
      at: [x, 0.045, 0.012],
      size: [0.022, 0.012, 0.008],
      colour: PLAIN.key,
    });
    const down = part(root, `${layout}/Component_Password_with/Button_BOT_0${c + 1}`, {
      at: [x, -0.025, 0.012],
      size: [0.022, 0.012, 0.008],
      colour: PLAIN.key,
    });
    // `CharSpinner`: up shows the previous letter.
    hitOn(up, () => ({
      op: { op: 'spin', column: c, by: -1 },
      punch: 0.5,
      sound: 'press-in',
      dip: up,
    }));
    hitOn(down, () => ({
      op: { op: 'spin', column: c, by: 1 },
      punch: 0.5,
      sound: 'press-in',
      dip: down,
    }));
    return { text, up, down };
  });
  const submit = part(root, 'PasswordComponent/Submit_Button', {
    at: [0, -0.065, 0.012],
    size: [0.08, 0.02, 0.01],
    colour: PLAIN.key,
  });
  hitOn(submit, () => ({ op: { op: 'submit' }, punch: 1, sound: 'press-in', dip: submit }));
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'password') return;
      led(look.led);
      if (backOn) backOn.visible = look.on;
      if (backOff) backOff.visible = !look.on;
      columns.forEach((c, i) => c.text.userData.set(look.on ? (look.letters[i] ?? '') : ''));
    },
    parts: () => [...columns.flatMap((c) => [c.up, c.down]), submit],
    thin: () => [],
  };
}

/** The needy countdown display on top of a needy module (`NeedyTimer`). */
function needyTimer(ctx: BindCtx, root: Root) {
  const t = instantiate(ctx.pack, 'NeedyTimer');
  root.add(t);
  const active = part(t, 'ScreenActive', {
    at: [0, 0.075, 0.012],
    size: [0.05, 0.022, 0.002],
    colour: 0x1a0d08,
  });
  const inactive = part(t, 'ScreenInactive', {
    at: [0, 0.075, 0.012],
    size: [0.05, 0.022, 0.002],
    colour: 0x111111,
  });
  const anchor = part(t, 'SevenSegText', { at: [0, 0.075, 0.014], size: [0, 0, 0], colour: 0 });
  const text = textPlane(0.04, 0.02, (px) => `${Math.round(px * 0.95)}px ${ctx.fonts.digits}`, {
    colour: '#ff6a1a',
    glow: '#ff3a10',
  });
  onAnchor(anchor, text);
  if (t.userData.plain) flat(text);
  return (clock: { text: string | null; warn: boolean }) => {
    active.visible = clock.text !== null;
    inactive.visible = clock.text === null;
    text.userData.set(clock.text ?? '', clock.warn ? '#ff2a10' : '#ff6a1a');
  };
}

function vent(ctx: BindCtx, root: Root): Binding {
  part(root, 'Component_Needy_Background/Background', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const clock = needyTimer(ctx, root);
  part(root, 'Component_Needy_VentGas/Gas_Screen', {
    at: [0, 0.01, 0.012],
    size: [0.14, 0.06, 0.002],
    colour: 0x0b1a0b,
  });
  const lines = textPlane(0.12, 0.05, (px) => `${Math.round(px * 0.3)}px ${ctx.fonts.morse}`, {
    colour: '#7cff4a',
  });
  // The screen's words: drawn over the screen as the original's lines.
  const anchor = part(root, 'VentGasText', { at: [0, 0.01, 0.014], size: [0, 0, 0], colour: 0 });
  if (root.userData.plain) {
    anchor.add(lines);
    flat(lines);
  } else onAnchor(anchor, lines);
  const draw = (rows: string[]) => {
    lines.userData.set(rows.join('\n'));
  };
  // Multi-line text: redraw with line breaks.
  const canvas = (lines.material as THREE.MeshBasicMaterial).map!.image as HTMLCanvasElement;
  lines.userData.set = (text: string) => {
    if (lines.userData.text === text) return;
    lines.userData.text = text;
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const rows = text ? text.split('\n') : [];
    const h = canvas.height / Math.max(3, rows.length);
    c.font = `${Math.round(h * 0.8)}px ${ctx.fonts.morse}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#7cff4a';
    rows.forEach((r, i) =>
      c.fillText(r, canvas.width / 2, h * (i + 0.5) + (canvas.height - h * rows.length) / 2),
    );
    (lines.material as THREE.MeshBasicMaterial).map!.needsUpdate = true;
  };
  const yes = part(root, 'Component_Needy_VentGas/Key_Y', {
    at: [-0.04, -0.06, 0.012],
    size: [0.03, 0.02, 0.01],
    colour: PLAIN.key,
  });
  const no = part(root, 'Component_Needy_VentGas/Key_N', {
    at: [0.04, -0.06, 0.012],
    size: [0.03, 0.02, 0.01],
    colour: PLAIN.key,
  });
  hitOn(yes, () => ({ op: { op: 'answer', yes: true }, punch: 0.5, sound: 'press-in', dip: yes }));
  hitOn(no, () => ({ op: { op: 'answer', yes: false }, punch: 0.5, sound: 'press-in', dip: no }));
  for (const n of ['PreventsText', 'DetonateText', 'VentCompleteText'])
    find(root, n)?.children.forEach((c) => (c.visible = false));
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'venting-gas') return;
      clock(look.clock);
      draw(look.lines);
    },
    parts: () => [yes, no],
    thin: () => [],
  };
}

function capacitor(ctx: BindCtx, root: Root): Binding {
  part(root, 'Component_Needy_Background/Background', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const clock = needyTimer(ctx, root);
  const handle = part(root, 'Component_Needy_Capacitor/Handle', {
    at: [0.05, -0.04, 0.02],
    size: [0.02, 0.05, 0.02],
    colour: 0xaa2222,
  });
  const bulb = part(root, 'Component_Needy_Capacitor/LightBulb', {
    at: [0.05, 0.03, 0.02],
    size: [0.02, 0.02, 0.02],
    colour: 0xffeeaa,
  });
  const normal = part(root, 'Capacitor/Capacitor_normal', {
    at: [-0.04, 0.0, 0.03],
    size: [0.04, 0.08, 0.04],
    colour: 0x2a4fa8,
  });
  const blown = part(root, 'Capacitor/ExlpodedObjects', {
    at: [-0.04, 0.0, 0.03],
    size: [0.04, 0.03, 0.04],
    colour: 0x222222,
  });
  tint(blown, 0xff8a30);
  const bulbGlow = find(root, 'NeedyDischargeComponent/LightGlow');
  if (isMesh(bulbGlow)) {
    const m = (bulbGlow.material as THREE.MeshBasicMaterial).clone();
    m.color.set(0xfff2c0);
    m.opacity = 0.55;
    bulbGlow.material = m;
  }
  const restQ = handle.quaternion.clone();
  hitOn(handle, () => ({ op: { op: 'down' }, release: { op: 'up' }, punch: 0.5, sound: 'switch' }));
  // The charge bar (`DeathBar` on `DeathBarParent`), filling as the capacitor charges.
  const barAt = part(root, 'DeathBarParent', {
    at: [-0.04, -0.07, 0.012],
    size: [0, 0, 0],
    colour: 0,
  });
  const bar = instantiate(ctx.pack, 'DeathBar');
  barAt.add(bar);
  const fill = part(bar, 'DeathFill', {
    at: [0, 0, 0.001],
    size: [0.08, 0.01, 0.002],
    colour: 0xff3020,
  });
  const fillScale = fill.scale.clone();
  const fillPos = fill.position.clone();
  let toneAt = 0;
  return {
    root,
    fill: 0.72,
    apply: (look, now) => {
      if (look.kind !== 'capacitor') return;
      // The rising tone from 20 s charged (`NeedyDischargeComponent.Update`), 300 → 450 Hz.
      const into = Math.max(0, (look.charge * 45_000 - 20_000) / 25_000);
      if (look.clock.text !== null && into > 0 && now - toneAt > 400) {
        toneAt = now;
        ctx.beep(300 + into * 150, 380, into / 4);
      }
      clock(look.clock);
      glow(bulb, look.held);
      if (bulbGlow) bulbGlow.visible = look.held;
      normal.visible = !look.exploded;
      blown.visible = look.exploded;
      const want = restQ
        .clone()
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), look.held ? 0.5 : 0),
        );
      handle.quaternion.slerp(want, 0.35);
      fill.scale.set(fillScale.x * Math.max(0.001, look.charge), fillScale.y, fillScale.z);
      fill.position.x = fillPos.x - ((1 - look.charge) * fillScale.x) / 2;
    },
    parts: () => [handle],
    thin: () => [],
  };
}

const ANGLE: Record<Dir, number> = { up: 0, right: -Math.PI / 2, down: Math.PI, left: Math.PI / 2 };

function knob(ctx: BindCtx, root: Root): Binding {
  part(root, 'Component_Needy_Background/Background', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: PLAIN.panel,
  });
  const clock = needyTimer(ctx, root);
  const dial = part(root, 'Component_Needy_Knob/Dial', {
    at: [0, -0.03, 0.015],
    size: [0.06, 0.06, 0.01],
    colour: 0x444444,
  });
  const pointer = part(root, 'Dial/Red_Knob', {
    at: [0, 0.02, 0.006],
    size: [0.008, 0.03, 0.006],
    colour: 0xcc2222,
    parent: dial,
  });
  const upText = part(root, 'Dial/UpText', {
    at: [0, 0.037, 0.006],
    size: [0, 0, 0],
    colour: 0,
    parent: dial,
  });
  const up = textPlane(0.02, 0.01, (px) => `${Math.round(px * 0.9)}px ${ctx.fonts.labels}`, {
    colour: '#f4f2ee',
  });
  onAnchor(upText, up);
  if (root.userData.plain) flat(up);
  up.userData.set('UP');
  const dialQ = dial.quaternion.clone();
  const leds = Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    const x = -0.075 + (i % 6) * 0.03 + (i % 6 >= 3 ? 0.0 : 0);
    const on = part(root, `Component_Needy_Knob/LED_${n}_on`, {
      at: [x, 0.035 - Math.floor(i / 6) * 0.015, 0.013],
      size: [0.01, 0.01, 0.004],
      colour: 0x40ff60,
    });
    tint(on, 0x40ff60);
    return on;
  });
  hitOn(dial, () => ({ op: { op: 'turn' }, punch: 0.5, sound: 'switch' }));
  const pointerQ = pointer.quaternion.clone();
  const turnY = (q: THREE.Quaternion, a: number) =>
    q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));
  const ease = (from: number, to: number) => {
    const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + d * 0.3;
  };
  let dialA = 0;
  let knobA = 0;
  return {
    root,
    fill: 0.72,
    apply: (look) => {
      if (look.kind !== 'knob') return;
      clock(look.clock);
      leds.forEach((l, i) => (l.visible = !!look.leds[i]));
      // The dial (with its UP label) sits where the label is; the knob turns on it, so it points
      // at the label's place plus its own position.
      dialA = ease(dialA, ANGLE[look.label]);
      knobA = ease(knobA, ANGLE[look.points] - ANGLE[look.label]);
      dial.quaternion.copy(turnY(dialQ, dialA));
      pointer.quaternion.copy(turnY(pointerQ, knobA));
    },
    parts: () => [dial],
    thin: () => [],
  };
}

/** The timer module: the digits, the strike lamps, its glow. */
export function timer(ctx: BindCtx, root: Root) {
  part(root, 'TimerComponent/Component_Timer', {
    at: [0, 0, 0],
    size: [0.2, 0.2, 0.01],
    colour: 0x3b3b3b,
  });
  const noStrikes = find(root, 'TimerComponent/Component_TimerNoStrikes');
  const withStrikes = find(root, 'TimerComponent/Component_Timer');
  const glowNode = find(root, 'TimerComponent/LightGlow');
  if (glowNode) tint(glowNode.parent ?? glowNode, 0xff2a10);
  const anchor = part(root, 'TimerComponent/TimerText', {
    at: [0, -0.02, 0.014],
    size: [0, 0, 0],
    colour: 0,
  });
  const text = textPlane(0.088, 0.036, (px) => `${Math.round(px * 0.95)}px ${ctx.fonts.digits}`, {
    colour: '#ff3a26',
    glow: '#ff2010',
    ghost: 'rgba(255,40,30,0.12)',
  });
  onAnchor(anchor, text, 0, root.userData.plain ? 0 : -0.011);
  if (root.userData.plain) flat(text);
  const lamps = [0, 1].map((i) => ({
    off: part(root, `TimerComponent/Strike${i}_Inactive`, {
      at: [-0.012 + i * 0.024, 0.05, 0.013],
      size: [0.014, 0.014, 0.004],
      colour: 0x333333,
    }),
    on: part(root, `TimerComponent/Strike${i}_Active`, {
      at: [-0.012 + i * 0.024, 0.05, 0.013],
      size: [0.014, 0.014, 0.004],
      colour: 0xff2a10,
    }),
  }));
  for (const l of lamps)
    if (isMesh(l.on) && l.on.userData.highlight) l.on.userData.highlight = false;
  return (t: { text: string; lit: boolean; lamps: number; struck: number; defused: boolean }) => {
    text.visible = t.lit;
    text.userData.set(t.text);
    if (glowNode) glowNode.visible = t.lit;
    if (noStrikes) noStrikes.visible = t.lamps === 0;
    if (withStrikes && noStrikes) withStrikes.visible = t.lamps > 0;
    lamps.forEach((l, i) => {
      const exists = i < t.lamps;
      l.off.visible = exists && !(t.struck > i);
      l.on.visible = exists && t.struck > i;
    });
  };
}

export function bindModule(
  kind: Look['kind'],
  ctx: BindCtx,
  root: Root,
  tone: (i: number) => void,
): Binding {
  switch (kind) {
    case 'wires':
      return wires(ctx, root);
    case 'button':
      return button(ctx, root);
    case 'keypad':
      return keypad(ctx, root);
    case 'simon':
      return simon(ctx, root, tone);
    case 'whos-on-first':
      return whosOnFirst(ctx, root);
    case 'memory':
      return memory(ctx, root);
    case 'morse':
      return morse(ctx, root);
    case 'complicated-wires':
      return venn(ctx, root);
    case 'wire-sequence':
      return sequence(ctx, root);
    case 'maze':
      return maze(ctx, root);
    case 'password':
      return password(ctx, root);
    case 'venting-gas':
      return vent(ctx, root);
    case 'capacitor':
      return capacitor(ctx, root);
    case 'knob':
      return knob(ctx, root);
  }
}

export { findAll };
