// The defuser's 3D bomb: the casing, its modules and edgework from the scene pack, held, turned
// and zoomed as the original does (`FloatingHoldable`, `MouseControls`, `TouchControls`,
// `SelectableManager`), lit like its room (one warm light, the timer's glow, the emergency light
// in the last minute). It draws what `look.ts` says and sends what the player touches; the
// server decides everything.
import * as THREE from 'three';
import type { ModuleOp, Widget } from '../../logic/types.ts';
import type { BombView } from '../../logic/view.ts';
import { AREAS } from '../../logic/edgework.ts';
import { type HapticType, hapticOf } from '../haptics.ts';
import {
  DRAG_PX,
  FOCUS_S,
  IDLE_MS,
  NEAR_PX,
  PICKUP_S,
  PUNCH_DEG,
  PUNCH_MS,
  PUTDOWN_S,
  SWEEP_MS,
  TWO_FINGER_TAP_MS,
  BACK_CLICK_MS,
  HOLD_DISTANCE,
  MODULE_MAX_ZOOM,
  anchorPan,
  clampPan,
  pinchRange,
  pinchZoom,
  zoomLimit,
  type HintEvent,
  type Turn,
  clamp,
  dragTurn,
  easeInOutSine,
  emergencyOn,
  faceAt,
  punchCurve,
  quarter,
  settleMouse,
  settleTouch,
  yawFor,
} from './controls.ts';
import { type BombLook, PREFAB, bombLook } from './look.ts';
import {
  type BindCtx,
  type Binding,
  type Hit,
  bindModule,
  timer as bindTimer,
  tint,
} from './modules.ts';
import {
  type Pack,
  type Root,
  find,
  findAll,
  flat,
  instantiate,
  isMesh,
  onAnchor,
  part,
  textPlane,
} from './rig.ts';

export type Pose = 'desk' | 'held' | 'module';

/** What a table screen needs to show the defuser's view. */
export interface Mirror {
  pose: Pose;
  yaw: number;
  settle: number;
  module: string | null;
}

export interface SceneOpts {
  pack: Pack | null;
  ctx: Omit<BindCtx, 'pack'>;
  /** Read-only (the table screen): no input, the pose comes from `mirror`. */
  readOnly: boolean;
  /** Sends a module action (with the server-clock time it happened). */
  act: (module: string, op: ModuleOp) => void;
  /** Local sounds: ticks, presses, the put-down, Simon's tones. */
  sound: (name: string, gain?: number) => void;
  tone: (i: number, ms: number) => void;
  /** The original's vibration for an interaction (`HapticType`, the punch's modifier). */
  vibrate: (type: HapticType, modifier: number) => void;
  hint: (e: HintEvent) => void;
  onPose: (m: Mirror) => void;
  /** The touch hint's scanline down the screen (0 top … 1 past the bottom), null when done. */
  scan?: (offset: number | null) => void;
  now: () => number;
}

const SPIN_ORDER = 'YXZ';
const FRONT_UP = new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ');
/** The original's gameplay camera (`FixedCam`, `MouseCam`): 60° tall. */
const FOV = 60;
/** `Selectable.DEFAULT_FOCUS_DISTANCE`. */
const MODULE_DISTANCE = 0.52;
/** `Selectable.DefaultZoom` of the modules on touch. */
const MODULE_ZOOM = MODULE_MAX_ZOOM;
const LIGHT = { hemi: 1.6, key: 2.1, fill: 0.25 };

interface Mod {
  id: string;
  face: 0 | 1;
  anchor: number;
  root: Root;
  bind: Binding | null;
  timer?: ReturnType<typeof bindTimer>;
  /** Its box in its own frame (found once, for the zoom's limits). */
  box?: THREE.Box3;
}

/**
 * The outline's width on screen (CSS px): the touch one is wide enough to see at arm's length
 * on a phone, round a whole module a little wider.
 */
const TOUCH_RIM_PX = 7;
const MOUSE_RIM_PX = 3;

/** `KeypadButton`: down by half its `ButtonHeightOverride` in 0.25 s, back in 0.25 s, easeOutQuint. */
const KEY_MS = 250;
const easeOutQuint = (x: number) => 1 - (1 - x) ** 5;

const isShown = (o: THREE.Object3D) => {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
};

/**
 * The outline is drawn over everything (the original's outline shaders are in the Overlay
 * queue), only round the part: the part's own shape is first marked in the stencil (`MASK`),
 * and the grown shell draws only outside it, so a thin wire or a module among others shows its
 * whole rim.
 */
const OUTLINE_STENCIL = {
  depthTest: false,
  depthWrite: false,
  transparent: true,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.NotEqualStencilFunc,
  stencilFail: THREE.KeepStencilOp,
  stencilZFail: THREE.KeepStencilOp,
  stencilZPass: THREE.KeepStencilOp,
} as const;

const MASK = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  side: THREE.DoubleSide,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
});

/** `KT/Outline` with a mouse: solid yellow. */
const MOUSE_OUTLINE = new THREE.MeshBasicMaterial({
  color: 0xffd21a,
  side: THREE.DoubleSide,
  opacity: 0.95,
  ...OUTLINE_STENCIL,
});

/**
 * `KT/OutlineScanline`, the touch outline, from the original's compiled shader (its D3D11
 * bytecode, disassembled): the outline is lit by the scanline's falloff, sampled at
 * v = (y − 1 + offset × (H + 1)) / H with y the screen height (0 bottom) and H
 * `_ScanlineHeight` 0.33, so the brightest band trails just above the line as it sweeps down.
 * Selected (`HIGHLIGHT_ON`, `SELECTABLE`) it also pulses: max(falloff,
 * cos(2π × frac(t × 0.416667)) × 0.25 + 0.75). Colour (1, 0.890, 0), alpha-blended, drawn
 * over the scene (see `OUTLINE_STENCIL`).
 */
function scanlineMaterial(
  selected: boolean,
  offset: { value: number },
  res: { value: THREE.Vector2 },
  falloff: { value: THREE.Texture },
  time: { value: number },
) {
  return new THREE.ShaderMaterial({
    uniforms: { uOffset: offset, uRes: res, uFalloff: falloff, uTime: time },
    vertexShader:
      'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uOffset; uniform vec2 uRes; uniform sampler2D uFalloff; uniform float uTime;
      void main() {
        float h = 0.33;
        float y = gl_FragCoord.y / uRes.y;
        float v = (y - 1.0 + uOffset * (h + 1.0)) / h;
        float a = texture2D(uFalloff, vec2(0.5, clamp(v, 0.0, 1.0))).r;
        ${selected ? 'a = max(a, cos(fract(uTime * 0.416667) * 6.28319) * 0.25 + 0.75);' : 'a = max(a, 0.0);'}
        gl_FragColor = vec4(1.0, 0.890196, 0.0, a);
      }`,
    side: THREE.DoubleSide,
    ...OUTLINE_STENCIL,
  });
}

/**
 * The falloff curve (`ScanlineFalloff`, 128 steps from v = 0): the pack's own values, or without
 * the pack a close fit (dark at both ends, a smooth rise to white just above the line).
 */
function falloffTexture(values?: number[]): THREE.Texture {
  const n = 128;
  const data = new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    const v = k / (n - 1);
    const fit = k < 4 || k > n - 3 ? 0 : 1 - v * v * (3 - 2 * v);
    const x = Math.round(255 * (values?.[k] ?? fit));
    data.set([x, x, x, 255], k * 4);
  }
  const t = new THREE.DataTexture(data, 1, n);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

let shared: { renderer: THREE.WebGLRenderer; dpr: number } | null = null;

/**
 * The page keeps one renderer: the pack's compressed textures are uploaded to its context once
 * (their CPU copies are dropped), so every later bomb reuses them.
 */
export function sharedRenderer(dpr: number): THREE.WebGLRenderer {
  if (!shared) {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'The bomb');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.outline = 'none';
    canvas.style.touchAction = 'none';
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      stencil: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    shared = { renderer, dpr };
  }
  shared.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
  return shared.renderer;
}

export class BombScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.02, 20);
  private hemi = new THREE.HemisphereLight(0xfff1dc, 0x2a2c34, LIGHT.hemi);
  private keyLight = new THREE.DirectionalLight(0xffe2b8, LIGHT.key);
  private fill = new THREE.DirectionalLight(0x9fb6ff, LIGHT.fill);
  private bomb = new THREE.Group();
  private spin = new THREE.Group();
  private punchG = new THREE.Group();
  private casing: Root | null = null;
  private mods: Mod[] = [];
  private bombNo = -1;
  private b: BombView | null = null;
  private look: BombLook | null = null;
  private opts: SceneOpts;
  private canvas: HTMLCanvasElement;
  // pose
  pose: Pose = 'desk';
  focused: Mod | null = null;
  private tween: {
    fp: THREE.Vector3;
    fq: THREE.Quaternion;
    tp: THREE.Vector3;
    tq: THREE.Quaternion;
    t0: number;
    dur: number;
  } | null = null;
  private turn: Turn = { yaw: 0, pitch: 0, settle: 0 };
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  /** Metres the camera has moved in along its axis (`FixedCameraRig.zoomLevel`). */
  private zoom = 0;
  private zoomT = 0;
  private zoomTween = { from: 0, to: 0, t0: 0, ms: 0 };
  /** Where the camera's centre has moved to (x, y), so a zoom stays on what it was aimed at. */
  private pan = new THREE.Vector2();
  private panT = new THREE.Vector2();
  /** The pan the player asked for; `panT` is it held inside what the zoom allows, every frame. */
  private panWant = new THREE.Vector2();
  /** The bomb's box in the casing's frame, for the zoom's limits. */
  private bombBox = new THREE.Box3();
  private punch: { axis: THREE.Vector3; amp: number; t0: number } | null = null;
  // input
  private pointers = new Map<
    number,
    { x: number; y: number; x0: number; y0: number; t0: number; type: string }
  >();
  private gesture:
    | { kind: 'maybe'; hit: Picked | null; x: number; y: number }
    | { kind: 'turn' }
    | { kind: 'rturn'; t0: number; moved: number }
    | {
        kind: 'pinch';
        d0: number;
        z0: number;
        t0: number;
        moved: boolean;
        /** The point the pinch is aimed at, in the bomb's own frame. */
        at: THREE.Vector3;
      }
    | { kind: 'press'; hit: Picked }
    | null = null;
  private hovered: THREE.Object3D | null = null;
  private hoverTouch = false;
  /** `_ScanlineOffset`, shared by every scanline outline (the original sets it globally). */
  private scan = { value: 0 };
  private scanRes = { value: new THREE.Vector2(1, 1) };
  private scanTime = { value: 0 };
  private scanFalloff: { value: THREE.Texture };
  private scanSelected: THREE.ShaderMaterial;
  private scanHint: THREE.ShaderMaterial;
  private hintGroups: THREE.Group[] = [];
  /** Where the mouse is over the canvas (null once it has left), for the hover outline. */
  private mouse: { x: number; y: number } | null = null;
  /** The outline was cleared by a move of the bomb or camera: pick again once it settles. */
  private rehover = false;
  private outline: THREE.Group = new THREE.Group();
  private kbIndex = -1;
  private kbPart = -1;
  private held: Picked | null = null;
  // light
  private idleSince = performance.now();
  private sweep: number | null = null;
  private frameId = 0;
  private last = performance.now();
  private disposed = false;
  private ended = false;
  stats = { frames: 0, t0: performance.now(), fps: 0, work: [] as number[] };
  private mirror: Mirror | null = null;
  private lastMirror = '';

  /** `renderer` is the page's one renderer (`sharedRenderer`); its canvas is the scene's. */
  constructor(renderer: THREE.WebGLRenderer, opts: SceneOpts) {
    this.canvas = renderer.domElement;
    this.opts = opts;
    this.scanFalloff = { value: falloffTexture(opts.pack?.json.falloff) };
    this.scanSelected = scanlineMaterial(
      true,
      this.scan,
      this.scanRes,
      this.scanFalloff,
      this.scanTime,
    );
    this.scanHint = scanlineMaterial(
      false,
      this.scan,
      this.scanRes,
      this.scanFalloff,
      this.scanTime,
    );
    this.renderer = renderer;
    this.scene.background = new THREE.Color(0x0b0b0d);
    this.keyLight.position.set(-0.6, 1.6, 0.9);
    this.fill.position.set(0.8, -0.4, 0.6);
    this.scene.add(this.hemi, this.keyLight, this.fill);
    this.bomb.add(this.spin);
    this.spin.add(this.punchG);
    this.scene.add(this.bomb);
    this.outline.renderOrder = 10;
    this.outline.userData.outline = true;
    if (!opts.readOnly) this.listen();
    this.resize();
    const [p, q] = this.deskPose();
    this.bomb.position.copy(p);
    this.bomb.quaternion.copy(q);
    this.frameId = requestAnimationFrame(this.frame);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.unlisten?.();
    this.outline.removeFromParent();
    this.scene.clear();
  }

  // ---- Building ----

  /** Shows a bomb (rebuilt when a new one starts) and its state. */
  setBomb(b: BombView) {
    this.b = b;
    if (b.no !== this.bombNo) this.build(b);
  }

  private build(b: BombView) {
    this.bombNo = b.no;
    this.punchG.clear();
    this.mods = [];
    const { pack } = this.opts;
    const ctx: BindCtx = { ...this.opts.ctx, pack };
    const casing = instantiate(pack, 'BasicRectangleBomb');
    this.casing = casing;
    casing.rotation.copy(FRONT_UP);
    this.punchG.add(casing);
    if (casing.userData.plain) {
      const body = part(casing, 'VisualTransform/BombVisual', {
        at: [0, 0, 0],
        size: [0.73, 0.5, 0.15],
        colour: 0x5d6670,
      });
      body.position.set(0, 0, 0);
      body.scale.set(0.73, 0.15, 0.5);
    }
    findAll(casing, /Foam_inserts\/.*_hole$/).forEach((o) => (o.visible = false));
    findAll(casing, /Foam_inserts\/(Front|Back)\/Foam_[FB]\d$/).forEach((o) => (o.visible = true));
    const tone = (i: number) => this.opts.tone(i, 600);
    for (const face of [0, 1] as const)
      for (let anchor = 0; anchor < 6; anchor++) {
        const faceName = face === 0 ? 'FrontFace' : 'RearFace';
        const slot = part(casing, `VisualTransform/${faceName}/Component${anchor + 1}Anchor`, {
          at: [0, 0, 0],
          size: [0, 0, 0],
          colour: 0,
        });
        if (casing.userData.plain) {
          // Front face +y; anchors 0–2 along the top row, 3–5 below.
          const x = [-0.2205, -0.0009, 0.2197][anchor % 3]!;
          const z = anchor < 3 ? 0.108 : -0.108;
          slot.position.set(-x, face === 0 ? 0.0861 : -0.0861, z);
          if (face === 1) slot.quaternion.set(0, 0, 1, 0);
        }
        const isTimer = b.timer.face === face && b.timer.anchor === anchor;
        const m = b.modules.find((x) => x.face === face && x.anchor === anchor);
        const prefab = isTimer ? 'TimerComponent' : m ? PREFAB[m.kind] : 'EmptyComponent';
        const root = instantiate(pack, prefab);
        slot.add(root);
        const mod: Mod = {
          id: isTimer ? 'timer' : (m?.id ?? `empty${face}${anchor}`),
          face,
          anchor,
          root,
          bind: null,
        };
        if (isTimer) mod.timer = bindTimer(ctx, root);
        else if (m) mod.bind = bindModule(m.kind, ctx, root, tone);
        else
          part(root, 'Component_empty', {
            at: [0, 0, 0],
            size: [0.2, 0.2, 0.01],
            colour: 0x8a5a2a,
          });
        root.userData.mod = mod;
        this.mods.push(mod);
      }
    this.widgets(b);
    tint(casing);
    this.bombBox = this.localBox(this.punchG);
  }

  /** A node's box (its shown, solid meshes) in its own frame. */
  private localBox(node: THREE.Object3D): THREE.Box3 {
    node.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const box = new THREE.Box3();
    node.traverse((o) => {
      if (!isMesh(o) || !isShown(o) || o.userData.text || o.userData.highlight) return;
      const mat = ([] as THREE.Material[]).concat(o.material)[0] as
        THREE.MeshBasicMaterial | undefined;
      if (mat?.blending === THREE.AdditiveBlending) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      box.union(o.geometry.boundingBox!.clone().applyMatrix4(m));
    });
    return box;
  }

  private widgets(b: BombView) {
    const casing = this.casing!;
    const { pack, ctx } = { pack: this.opts.pack, ctx: this.opts.ctx };
    const sideName = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' } as const;
    const areaNode = (i: number) => {
      const a = AREAS[i]!;
      const nodes = findAll(
        casing,
        new RegExp(`WidgetAreas/${sideName[a.side]}Faces/${sideName[a.side]}Face$`),
      );
      // Packed x is mirrored: the area at Unity x sits at −x here.
      const found = nodes.find((n) => Math.abs(-n.position.x - a.x) < 0.01);
      if (found) return found;
      // Plain: the area on the casing's edge.
      const o = new THREE.Object3D();
      const edge = {
        top: [0, 0, 0.254],
        bottom: [0, 0, -0.254],
        left: [0.366, 0, 0],
        right: [-0.366, 0, 0],
      }[a.side];
      o.position.set(
        edge[0]! + (a.side === 'top' || a.side === 'bottom' ? -a.x : 0),
        0,
        edge[2]! + (a.side === 'left' || a.side === 'right' ? -a.x : 0),
      );
      if (a.side === 'top') o.rotation.set(Math.PI / 2, 0, 0);
      if (a.side === 'bottom') o.rotation.set(-Math.PI / 2, 0, 0);
      if (a.side === 'left') o.rotation.set(0, 0, -Math.PI / 2);
      if (a.side === 'right') o.rotation.set(0, 0, Math.PI / 2);
      o.scale.set(a.cols * 0.06, 0.03, a.rows * 0.06 + 0.05);
      casing.add(o);
      return o;
    };
    for (const w of b.widgets) {
      const a = AREAS[w.area]!;
      const area = areaNode(w.area);
      // `WidgetZone`: the zone's centre in the area's unit square, then the area's own scale.
      const lx = (w.x + 1) / a.cols - 0.5;
      const lz = (w.z + 0.5) / a.rows - 0.5;
      const s = area.scale;
      const pos = new THREE.Vector3(-lx * s.x, 0, lz * s.z)
        .applyQuaternion(area.quaternion)
        .add(area.position);
      const node = this.widget(w, b);
      node.position.copy(pos);
      node.quaternion.copy(area.quaternion);
      if (w.turned)
        node.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
        );
      (area.parent ?? casing).add(node);
    }
    void pack;
    void ctx;
  }

  private widget(w: Widget, b: BombView): THREE.Object3D {
    const { pack, ctx } = this.opts;
    const label = (
      anchor: THREE.Object3D,
      w0: number,
      h0: number,
      text: string,
      colour: string,
      plain: boolean,
    ) => {
      const t = textPlane(w0, h0, (px) => `${Math.round(px * 0.9)}px ${ctx.fonts.labels}`, {
        colour,
      });
      onAnchor(anchor, t);
      if (plain) flat(t);
      t.userData.set(text);
    };
    switch (w.kind) {
      case 'serial': {
        const r = instantiate(pack, 'SerialNumber');
        part(r, 'Widget_serialNumber', {
          at: [0, 0, 0.003],
          size: [0.11, 0.05, 0.006],
          colour: 0xf2efe6,
        });
        const a = part(r, 'SerialText', { at: [0, -0.005, 0.007], size: [0, 0, 0], colour: 0 });
        label(a, 0.06, 0.016, b.serial, '#111', r.userData.plain);
        r.userData.serial = b.serial;
        return r;
      }
      case 'battery': {
        const r = instantiate(pack, 'BatteryWidget');
        const which = w.batteries === 2 ? 'DoubleA' : 'DCell';
        const n = part(r, which, {
          at: [0, 0, 0.01],
          size: [0.1, 0.04, 0.02],
          colour: w.batteries === 2 ? 0xc89a2a : 0x2a2a2a,
        });
        n.visible = true;
        n.traverse((o) => (o.visible = !o.userData.highlight));
        r.userData.batteries = w.batteries;
        return r;
      }
      case 'indicator': {
        const r = instantiate(pack, 'IndicatorWidget');
        part(r, 'Widget_lightIndicator/backing', {
          at: [0, 0, 0.003],
          size: [0.1, 0.04, 0.006],
          colour: 0x1c1c1c,
        });
        const on = part(r, 'Widget_lightIndicator/led_on', {
          at: [-0.03, 0, 0.007],
          size: [0.012, 0.012, 0.004],
          colour: 0xfff0c0,
        });
        const off = part(r, 'Widget_lightIndicator/led_off', {
          at: [-0.03, 0, 0.007],
          size: [0.012, 0.012, 0.004],
          colour: 0x333333,
        });
        on.visible = w.lit;
        off.visible = !w.lit;
        const g = find(r, 'IndicatorWidget/LightGlow');
        if (isMesh(g)) {
          g.userData.highlight = false;
          g.visible = w.lit;
          tint(r, 0xfff0c0);
        }
        const a = part(r, 'LabelText', { at: [0.012, 0, 0.007], size: [0, 0, 0], colour: 0 });
        label(a, 0.03, 0.014, w.label, '#eee', r.userData.plain);
        r.userData.indicator = `${w.label}${w.lit ? '*' : ''}`;
        return r;
      }
      case 'ports': {
        const r = instantiate(pack, 'PortWidget');
        part(r, 'Widget_PortPlate', {
          at: [0, 0, 0.003],
          size: [0.11, 0.05, 0.006],
          colour: 0x777777,
        });
        const NODE: Record<string, string> = {
          serial: 'Widget_Port_Serial',
          parallel: 'Widget_Port_Parallel',
          dvi: 'Widget_Port_DVI',
          ps2: 'Widget_Port_PS2',
          rj45: 'Widget_Port_RJ45',
          rca: 'Widget_Port_StereoRCA',
        };
        for (const [k, n] of Object.entries(NODE)) {
          const o = find(r, n);
          if (o) o.visible = w.ports.includes(k as never);
        }
        if (r.userData.plain && w.ports.length) {
          const a = part(r, 'PortText', { at: [0, 0, 0.007], size: [0, 0, 0], colour: 0 });
          label(a, 0.1, 0.012, w.ports.join(' ').toUpperCase(), '#111', true);
        }
        r.userData.ports = w.ports.join(',');
        return r;
      }
    }
  }

  // ---- Poses ----

  /**
   * The original's camera is landscape (`FixedCam`/`MouseCam`, 60° tall). On an upright screen
   * everything steps back just enough for the held bomb to fill 88 % of the width.
   */
  private fit() {
    const half = Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * this.camera.aspect;
    return Math.max(1, 0.74 / 0.88 / 2 / half / HOLD_DISTANCE);
  }

  /** `FloatingHoldable.FocusDistance`: the held bomb sits 0.63 m away. */
  private heldDistance() {
    return HOLD_DISTANCE * this.fit();
  }

  /**
   * `Selectable.GetFocusDistance`: every module's FocusDistance and TouchFocusDistance are 0 in
   * the original's prefabs, so the default 0.52 m applies; on touch the camera then moves in by
   * the module's `DefaultZoom` (0.3 m, `TouchControls.SetZoom`).
   */
  private moduleDistance(_m: Mod | null) {
    return MODULE_DISTANCE * this.fit();
  }

  /**
   * What the player looks at, in the world: the focused module's box, or the held bomb's. The
   * camera looks down −z from its zoom, so `max.z` is the nearest surface.
   */
  private viewBox(): THREE.Box3 {
    const m = this.pose === 'module' ? this.focused : null;
    const node = m ? m.root : this.punchG;
    let local = this.bombBox;
    if (m) {
      m.box ??= this.localBox(m.root);
      local = m.box;
    }
    node.updateWorldMatrix(true, false);
    return local.isEmpty()
      ? new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3().setFromMatrixPosition(node.matrixWorld),
          new THREE.Vector3(0.2, 0.2, 0.05),
        )
      : local.clone().applyMatrix4(node.matrixWorld);
  }

  /** How far the nearest surface looked at is from the eye with no zoom. */
  private surface() {
    return Math.max(0.05, -this.viewBox().max.z);
  }

  /**
   * How far the camera may move in: at least the original's `Selectable.MaxZoom` (the bomb
   * 0.15 m, a module 0.3 m), and on to `NEAREST_M` from the surface looked at, whichever side
   * of the bomb that is.
   */
  private maxZoom() {
    return zoomLimit(this.pose, this.surface(), this.fit());
  }

  /** Zooms to `z`, keeping the point `at` (bomb frame) under the screen point (x, y). */
  private zoomAt(z: number, at: THREE.Vector3 | null, x: number, y: number) {
    this.zoomT = z;
    this.zoom = z;
    this.zoomTween = { from: z, to: z, t0: 0, ms: 0 };
    if (!at) return;
    const p = this.bomb.localToWorld(at.clone());
    const ndc = this.ndc(x, y);
    const camZ = -z * this.fit();
    const pan = anchorPan(p, ndc, Math.max(0.01, camZ - p.z), FOV, this.camera.aspect);
    this.panWant.set(pan.x, pan.y);
    this.clampPanT();
    this.panWant.copy(this.panT);
    this.pan.copy(this.panT);
  }

  private clampPanT() {
    // While the bomb flies to a pose, what it is held to is still moving.
    if (this.tween) {
      this.panT.copy(this.panWant);
      return;
    }
    const b = this.viewBox();
    const max = this.maxZoom();
    const c = clampPan(
      { x: this.panWant.x, y: this.panWant.y },
      { minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y },
      Math.max(0, this.zoomT),
      max,
    );
    this.panT.set(c.x, c.y);
  }

  /** The point under a screen spot, in the bomb's frame (the bomb's middle depth if nothing). */
  private aimAt(x: number, y: number): THREE.Vector3 {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc(x, y), this.camera);
    const hit = this.ray
      .intersectObject(this.bomb, true)
      .find((h) => isShown(h.object) && !h.object.userData.text && !h.object.userData.highlight);
    const p =
      hit?.point ??
      this.ray.ray.at(
        Math.max(0.05, this.camera.position.z - this.viewBox().getCenter(new THREE.Vector3()).z),
        new THREE.Vector3(),
      );
    return this.bomb.worldToLocal(p.clone());
  }

  /** Pointers dropped because their lift never came (tests). */
  private stale = 0;

  private deskPose(): [THREE.Vector3, THREE.Quaternion] {
    const d = this.heldDistance() * 1.25;
    return [
      new THREE.Vector3(0, -0.16 * d, -d * 1.1),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.85, 0.16, 0.03)),
    ];
  }

  private heldPose(): [THREE.Vector3, THREE.Quaternion] {
    return [new THREE.Vector3(0, 0, -this.heldDistance()), new THREE.Quaternion()];
  }

  private moveTo(p: THREE.Vector3, q: THREE.Quaternion, s: number) {
    this.unhover();
    this.tween = {
      fp: this.bomb.position.clone(),
      fq: this.bomb.quaternion.clone(),
      tp: p,
      tq: q,
      t0: performance.now(),
      dur: s * 1000,
    };
  }

  private setPose(p: Pose, m: Mod | null = null) {
    this.unhover();
    if (this.focused && this.focused !== m) this.focused.bind?.focus?.(false);
    this.pose = p;
    this.focused = m;
    if (m) m.bind?.focus?.(true);
    this.idleSince = performance.now();
    if (this.sweep !== null) this.stopHint();
    this.emitPose();
  }

  private emitPose() {
    const m: Mirror = {
      pose: this.pose,
      yaw: Math.round(this.turn.yaw / 90) * 90,
      settle: this.turn.settle,
      module: this.focused?.id ?? null,
    };
    const key = JSON.stringify(m);
    if (key === this.lastMirror) return;
    this.lastMirror = key;
    this.opts.onPose(m);
  }

  pickUp() {
    if (this.pose !== 'desk') return;
    const [p, q] = this.heldPose();
    this.moveTo(p, q, PICKUP_S);
    this.opts.sound('selectiontick');
    this.setPose('held');
    this.opts.hint('picked');
  }

  putDown() {
    const [p, q] = this.deskPose();
    this.moveTo(p, q, PUTDOWN_S);
    this.turn = { yaw: Math.round(this.turn.yaw / 180) * 180, pitch: 0, settle: 0 };
    this.setPose('desk');
    setTimeout(() => this.opts.sound('putdownbomb', 0.8), 280);
  }

  focus(m: Mod) {
    const face = m.face;
    const yaw = yawFor(face, this.turn.yaw);
    this.turn = { yaw, pitch: 0, settle: 0 };
    const spinQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, THREE.MathUtils.degToRad(yaw), 0, SPIN_ORDER),
    );
    const inv = new THREE.Matrix4().copy(this.bomb.matrixWorld).invert();
    const local = this.middleOf(m).applyMatrix4(inv);
    local.applyQuaternion(this.spin.quaternion.clone().invert()).applyQuaternion(spinQ);
    const d = this.moduleDistance(m);
    this.moveTo(
      new THREE.Vector3(-local.x, -local.y, -d - local.z),
      new THREE.Quaternion(),
      FOCUS_S,
    );
    this.yaw = yaw;
    this.pitch = 0;
    this.zoomT = this.opts.ctx.touch ? MODULE_ZOOM : 0;
    this.panWant.set(0, 0);
    this.opts.sound('selectiontick');
    this.setPose('module', m);
    this.opts.hint('module');
  }

  back() {
    this.zoomT = 0;
    this.panWant.set(0, 0);
    if (this.pose === 'module') {
      const [p, q] = this.heldPose();
      this.moveTo(p, q, FOCUS_S);
      this.opts.sound('selectiontick');
      this.setPose('held');
    } else if (this.pose === 'held') this.putDown();
  }

  turnBy(dir: 'up' | 'down' | 'left' | 'right') {
    if (this.pose === 'desk') return;
    if (this.pose === 'module') this.back();
    this.turn = quarter(this.turn, dir);
    this.opts.sound('selectiontick', 0.6);
    this.opts.hint('turned');
    this.emitPose();
  }

  /** The table screen follows the defuser's pose. */
  setMirror(m: Mirror | null) {
    if (!m) return;
    const prev = this.mirror;
    this.mirror = m;
    if (
      prev &&
      prev.pose === m.pose &&
      prev.module === m.module &&
      prev.yaw === m.yaw &&
      prev.settle === m.settle
    )
      return;
    this.turn = { yaw: m.yaw, pitch: 0, settle: m.settle };
    const mod = m.module ? this.mods.find((x) => x.id === m.module) : null;
    if (m.pose === 'module' && mod) this.focus(mod);
    else if (m.pose === 'held') {
      const [p, q] = this.heldPose();
      this.moveTo(p, q, PICKUP_S);
      this.setPose('held');
    } else if (m.pose === 'desk' && this.pose !== 'desk') this.putDown();
  }

  // ---- Picking ----

  private ray = new THREE.Raycaster();

  private ndc(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  /** What is under a screen point: a part of the focused module, a module, the bomb, or nothing. */
  pick(x: number, y: number): Picked | null {
    this.ray.setFromCamera(this.ndc(x, y), this.camera);
    const hits = this.ray.intersectObject(this.bomb, true).filter((h) => {
      const o = h.object as THREE.Mesh;
      if (!o.visible || !isShown(o) || o.userData.highlight || o.userData.text) return false;
      const mat = ([] as THREE.Material[]).concat(o.material)[0] as
        THREE.MeshBasicMaterial | undefined;
      if (mat && (mat.blending === THREE.AdditiveBlending || mat.visible === false)) return false;
      return !/Opening_LID/.test((o.userData.path as string) ?? '');
    });
    // Thin parts of the focused module (wires) are picked within NEAR_PX of where they show.
    if (this.pose === 'module' && this.focused?.bind) {
      const r = this.canvas.getBoundingClientRect();
      let best: Picked | null = null;
      let bestD = NEAR_PX;
      const v = new THREE.Vector3();
      const meshes: [THREE.Object3D, THREE.Mesh][] = [];
      for (const t of this.focused.bind.thin())
        t.traverse((x) => {
          if (isMesh(x)) meshes.push([t, x]);
        });
      for (const [owner, o] of meshes) {
        if (!isShown(o)) continue;
        const pos = o.geometry.attributes.position as THREE.BufferAttribute;
        o.updateWorldMatrix(true, false);
        const step = Math.max(1, Math.floor(pos.count / 200));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          const w = v.clone();
          v.project(this.camera);
          const sx = ((v.x + 1) / 2) * r.width + r.left;
          const sy = ((1 - v.y) / 2) * r.height + r.top;
          const d = Math.hypot(sx - x, sy - y);
          if (d < bestD) {
            const hit = (owner.userData.hit as (() => Hit | null) | undefined)?.();
            if (hit) {
              bestD = d;
              best = { kind: 'part', mod: this.focused, node: owner, hit, point: w };
            }
          }
        }
      }
      if (best) {
        // A part drawn in front (a key, a button) still wins over a wire behind it.
        const front = hits[0] && this.partOf(hits[0].object);
        if (!front) return best;
      }
    }
    const h = hits[0];
    if (!h) return null;
    const mod = this.modOf(h.object);
    if (this.pose === 'desk' || !mod)
      return { kind: 'bomb', mod: null, node: h.object, point: h.point };
    if (this.pose !== 'module' || this.focused !== mod) {
      if (mod.bind || mod.id === 'timer')
        return { kind: 'module', mod, node: mod.root, point: h.point };
      return { kind: 'bomb', mod: null, node: h.object, point: h.point };
    }
    const p = this.partOf(h.object);
    if (p) return { kind: 'part', mod, node: p.node, hit: p.hit, point: h.point };
    return { kind: 'face', mod, node: h.object, point: h.point };
  }

  private modOf(o: THREE.Object3D): Mod | null {
    for (let x: THREE.Object3D | null = o; x; x = x.parent)
      if (x.userData.mod) return x.userData.mod as Mod;
    return null;
  }

  private partOf(o: THREE.Object3D): { node: THREE.Object3D; hit: Hit } | null {
    for (let x: THREE.Object3D | null = o; x; x = x.parent) {
      if (x.userData.mod) return null;
      const f = x.userData.hit as (() => Hit | null) | undefined;
      if (f) {
        const hit = f();
        return hit ? { node: x, hit } : null;
      }
    }
    return null;
  }

  // ---- Acting ----

  private addPunch(point: THREE.Vector3, mod: number, haptic: HapticType) {
    this.opts.vibrate(haptic, mod);
    const centre = new THREE.Vector3().setFromMatrixPosition(this.bomb.matrixWorld);
    const dir = point.clone().sub(centre).normalize();
    const axis = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
    if (axis.lengthSq() < 1e-6) return;
    this.punch = {
      axis: axis.applyQuaternion(this.bomb.quaternion.clone().invert()),
      amp: PUNCH_DEG * mod,
      t0: performance.now(),
    };
  }

  private press(p: Picked) {
    if (p.kind !== 'part' || !p.hit || !p.mod) return;
    const h = p.hit;
    if (h.punch) this.addPunch(p.point, h.punch, h.haptic ?? hapticOf(h.sound, h.op));
    if (h.sound === 'tone' && h.tone !== undefined) this.opts.tone(h.tone, 300);
    else if (h.sound && h.sound !== 'snip') this.opts.sound(h.sound);
    if (h.dip) {
      h.dip.userData.down = true;
      h.dip.userData.keyDepth = h.depth ?? 0;
      h.dip.userData.pressedUntil = performance.now() + 350;
      this.key = p;
    }
    this.opts.act(p.mod.id, h.op);
    this.opts.hint('acted');
    if (h.release) this.held = p;
  }

  /** The key held down (`KeypadButton`): it comes back up when let go. */
  private key: Picked | null = null;

  private release() {
    const k = this.key;
    this.key = null;
    if (k?.hit?.dip) {
      const node = k.hit.dip;
      node.userData.down = false;
      // `KeypadButton.InteractEnded`: press-release, unless it stays down (Simon has none).
      if (!node.userData.stay && k.hit.sound === 'press-in') this.opts.sound('press-release');
    }
    const p = this.held;
    this.held = null;
    if (!p?.hit?.release || !p.mod) return;
    // Only the Button punches on letting go (`ButtonComponent`, −0.35).
    if (p.hit.releasePunch)
      this.addPunch(p.point, p.hit.releasePunch, hapticOf(p.hit.sound, p.hit.release, true));
    this.opts.sound(p.hit.sound === 'bb-press-in' ? 'bb-press-release' : 'press-release');
    this.opts.act(p.mod.id, p.hit.release);
  }

  private tap(p: Picked | null) {
    if (this.ended) return;
    if (this.pose === 'desk') {
      if (p) this.pickUp();
      return;
    }
    if (!p) return this.back(); // a tap off the bomb steps back
    if (p.kind === 'module' && p.mod) return this.focus(p.mod);
    if (p.kind === 'bomb' && this.pose === 'module') return this.back();
  }

  // ---- Input ----

  private unlisten: (() => void) | null = null;

  private listen() {
    const c = this.canvas;
    const touch = this.opts.ctx.touch;
    const down = (e: PointerEvent) => {
      // The first finger of a new touch: any pointer still listed lost its lift (the page was
      // switched away, a system gesture took it), and would pair with this one as a pinch.
      if (e.isPrimary && this.pointers.size) {
        this.stale += this.pointers.size;
        this.pointers.clear();
        if (this.gesture?.kind === 'press') this.release();
        this.gesture = null;
        this.dragging = false;
      }
      c.focus();
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // a pointer the page no longer has
      }
      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        x0: e.clientX,
        y0: e.clientY,
        t0: performance.now(),
        type: e.pointerType,
      });
      this.idleSince = performance.now();
      if (this.sweep !== null) this.stopHint();
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        if (this.gesture?.kind === 'press') this.release();
        if (this.gesture?.kind === 'turn') {
          // The first finger had started a turn: it settles as the pinch takes over.
          this.dragging = false;
          this.onDrag?.(false);
          this.turn = settleTouch(this.turn);
          this.emitPose();
        }
        this.gesture = {
          kind: 'pinch',
          d0: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          z0: this.zoomT,
          t0: performance.now(),
          moved: false,
          at: this.aimAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2),
        };
        return;
      }
      if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
        this.gesture = { kind: 'rturn', t0: performance.now(), moved: 0 };
        this.dragging = true;
        return;
      }
      if (e.button !== 0) return;
      const p = this.pick(e.clientX, e.clientY);
      // `TouchControls.Select`: the finger selects what it is on (the tick, the scanline outline).
      if (e.pointerType !== 'mouse' && !this.ended) this.hover(p, true);
      // Parts act on touch-down (`TouchControls`); a held part waits for the lift.
      if (p && p.kind === 'part' && this.pose === 'module' && !this.ended) {
        this.gesture = { kind: 'press', hit: p };
        this.press(p);
        return;
      }
      this.gesture = { kind: 'maybe', hit: p, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType !== 'mouse') return;
        this.mouse = { x: e.clientX, y: e.clientY };
        // The outline follows the cursor; while the bomb or camera moves it waits.
        if (this.ended) this.unhover();
        else if (this.busy()) {
          this.unhover();
          this.rehover = true;
        } else this.hover(this.pick(e.clientX, e.clientY));
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      const g = this.gesture;
      if (!g) return;
      // The selection follows the finger, and goes once it turns or pinches the bomb.
      if (e.pointerType !== 'mouse') {
        if (g.kind === 'maybe' || g.kind === 'press')
          this.hover(this.pick(e.clientX, e.clientY), true);
        else this.unhover();
      }
      if (g.kind === 'pinch' && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (Math.abs(d - g.d0) > 12) g.moved = true;
        if (this.pose === 'desk') return;
        // `TouchControls.HandleZoom`: the pinch moves the camera, a little past the limits while
        // held; ours aims it at the point between the fingers and pans with them.
        const max = this.maxZoom();
        const range = pinchRange(max, this.surface(), this.fit());
        const z = pinchZoom(g.z0, d - g.d0, max, range);
        this.zoomAt(z, g.at, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
        if (g.moved) this.opts.hint('zoomed');
        return;
      }
      if (g.kind === 'rturn') {
        g.moved += Math.abs(dx) + Math.abs(dy);
        if (this.pose !== 'desk') this.addTurn(dx, dy);
        return;
      }
      if (
        g.kind === 'maybe' &&
        Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > DRAG_PX &&
        this.pose !== 'desk' &&
        // On touch only a drag that starts off a selectable turns the bomb (`TouchControls`);
        // one that starts on a module moves the selection with the finger.
        !(e.pointerType !== 'mouse' && (g.hit?.kind === 'module' || g.hit?.kind === 'part'))
      ) {
        this.gesture = { kind: 'turn' };
        this.dragging = true;
        this.onDrag?.(true);
        if (this.pose === 'module') this.back();
      }
      if (this.gesture?.kind === 'turn') this.addTurn(dx, dy);
    };
    const up = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      // `TouchControls.Deselect`: lifting the finger clears the selection.
      if (e.pointerType !== 'mouse') {
        this.rehover = false;
        this.hover(null);
      }
      const g = this.gesture;
      if (!p || !g) return;
      if (g.kind === 'pinch') {
        if (this.pointers.size === 0) {
          if (!g.moved && performance.now() - g.t0 < TWO_FINGER_TAP_MS) this.back();
          // Ours: a module pinched out past its widest steps back to the whole bomb.
          else if (this.pose === 'module' && this.zoomT < -0.5 * MODULE_ZOOM * 0.2) this.back();
          this.gesture = null;
        }
        return;
      }
      this.gesture = null;
      const wasDragging = this.dragging;
      this.dragging = false;
      if (wasDragging) this.onDrag?.(false);
      if (g.kind === 'turn') {
        this.turn = p.type === 'touch' ? settleTouch(this.turn) : settleMouse(this.turn);
        this.emitPose();
        return;
      }
      if (g.kind === 'rturn') {
        if (g.moved < DRAG_PX && performance.now() - g.t0 < BACK_CLICK_MS) this.back();
        else {
          this.turn = settleMouse(this.turn);
          this.emitPose();
        }
        return;
      }
      if (g.kind === 'press') {
        this.release();
        return;
      }
      // On touch the selection may have moved with the finger: the lift acts on what it is on,
      // and a finger that slid off the bomb does nothing (only a tap off it steps back).
      if (p.type === 'mouse') this.tap(g.hit);
      else {
        const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > DRAG_PX;
        const there = this.pick(e.clientX, e.clientY);
        if (!moved || there) this.tap(there);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.pose === 'desk') return;
      // The wheel zooms toward the cursor, as a pinch does toward the fingers.
      const z = clamp(this.zoomT - e.deltaY * 0.0004, 0, this.maxZoom());
      this.zoomAt(z, this.aimAt(e.clientX, e.clientY), e.clientX, e.clientY);
      this.opts.hint('zoomed');
    };
    const menu = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => this.onKey(e);
    const keyUp = (e: KeyboardEvent) => {
      if ((this.held || this.key) && (e.key === ' ' || e.key === 'Enter' || /^[1-9]$/.test(e.key)))
        this.release();
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    const leave = () => {
      this.mouse = null;
      this.rehover = false;
      this.unhover();
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('contextmenu', menu);
    c.addEventListener('pointerleave', leave);
    c.addEventListener('blur', leave);
    window.addEventListener('blur', leave);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', keyUp);
    void touch;
    this.unlisten = () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('wheel', wheel);
      c.removeEventListener('contextmenu', menu);
      c.removeEventListener('pointerleave', leave);
      c.removeEventListener('blur', leave);
      window.removeEventListener('blur', leave);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', keyUp);
    };
  }

  /** The rotate arrows fade out while a drag turns the bomb. */
  onDrag: ((on: boolean) => void) | null = null;

  private addTurn(dx: number, dy: number) {
    const r = this.canvas.getBoundingClientRect();
    this.turn = dragTurn(this.turn, dx, dy, r.width, r.height);
    this.opts.hint('turned');
  }

  private playable() {
    return [...this.mods]
      .filter((m) => m.bind)
      .sort((a, b) => a.face - b.face || a.anchor - b.anchor);
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (this.ended || e.repeat) return;
    const k = e.key.toLowerCase();
    this.idleSince = performance.now();
    if (k === 'escape' || k === 'backspace') {
      e.preventDefault();
      this.back();
      return;
    }
    const dirs: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      arrowleft: 'left',
      a: 'left',
      arrowright: 'right',
      d: 'right',
      arrowup: 'up',
      w: 'up',
      arrowdown: 'down',
      s: 'down',
    };
    if (dirs[k] && this.pose !== 'desk') {
      e.preventDefault();
      this.turnBy(dirs[k]);
      return;
    }
    if (k === 'f' && this.pose !== 'desk') {
      this.turn = { ...this.turn, yaw: this.turn.yaw + 180 };
      this.emitPose();
      return;
    }
    if (k === '+' || k === '=') this.zoomT = Math.min(this.maxZoom(), this.zoomT + 0.05);
    if (k === '-' || k === '_') this.zoomT = Math.max(0, this.zoomT - 0.05);
    if (k === '+' || k === '=' || k === '-' || k === '_') this.opts.hint('zoomed');
    if (k === 'tab') {
      e.preventDefault();
      if (this.pose === 'desk') return;
      const list = this.playable();
      if (!list.length) return;
      this.kbIndex = (this.kbIndex + (e.shiftKey ? list.length - 1 : 1)) % list.length;
      const m = list[this.kbIndex]!;
      if (this.pose === 'module') this.focus(m);
      else this.hover({ kind: 'module', mod: m, node: m.root, point: new THREE.Vector3() });
      return;
    }
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
      if (this.pose === 'desk') return this.pickUp();
      const list = this.playable();
      if (this.pose === 'held') return this.focus(list[Math.max(0, this.kbIndex)] ?? list[0]!);
      if (this.pose === 'module' && this.kbPart >= 0) this.numberKey(this.kbPart);
      return;
    }
    if (this.pose === 'module' && /^[1-9]$/.test(k)) this.numberKey(Number(k) - 1);
  }

  private numberKey(i: number) {
    const parts = this.focused?.bind?.parts() ?? [];
    const node = parts[i];
    if (!node || !this.focused) return;
    const f = node.userData.hit as (() => Hit | null) | undefined;
    const hit = f?.();
    if (!hit) return;
    this.kbPart = i;
    const point = node.getWorldPosition(new THREE.Vector3());
    this.press({ kind: 'part', mod: this.focused, node, hit, point });
  }

  // ---- Hover outline (mouse) ----

  /** The bomb or the camera is moving (a pick-up, a zoom, a turn settling). */
  private busy() {
    return (
      !!this.tween ||
      Math.abs(this.yaw - this.turn.yaw) > 0.5 ||
      Math.abs(this.pitch - this.turn.pitch) > 0.5 ||
      Math.abs(this.zoom - this.zoomT) > 0.002 ||
      this.pan.distanceTo(this.panT) > 0.002 ||
      this.dragging
    );
  }

  /** Clears the hover outline; it comes back under a still cursor once nothing moves. */
  private unhover() {
    if (this.hovered) this.rehover = true;
    this.hover(null);
  }

  /** The parts lit by the hover outline (tests): at most one. */
  lit(): string[] {
    const out: string[] = [];
    this.scene.traverse((o) => {
      if (o.userData.outline && o.parent && o.children.length)
        out.push(o.parent.userData.path as string);
    });
    return out;
  }

  /** The node a pick lights: a part, a whole module, or the bomb on the desk. */
  private litNode(p: Picked | null) {
    return p?.kind === 'part'
      ? p.node
      : p?.kind === 'module'
        ? (p.mod?.root ?? null)
        : p?.kind === 'bomb' && this.pose === 'desk'
          ? this.casing
          : null;
  }

  /**
   * `Selectable.HandleSelect` / `Highlightable`: the outline round the selectable, its own shape
   * (the part's meshes grown a few millimetres about their own middles, drawn behind them so only
   * the rim shows). With a mouse it is the solid yellow `KT/Outline`; on touch the scanline one
   * (`ScanlineMode`, `KT/OutlineScanline`).
   */
  private hover(p: Picked | null, touch = false) {
    const node = this.litNode(p);
    if (node === this.hovered && touch === this.hoverTouch) return;
    const same = node === this.hovered;
    this.hovered = node;
    this.hoverTouch = touch;
    this.outline.removeFromParent();
    this.outline.clear();
    if (!node) return;
    this.shells(
      node,
      p?.kind !== 'part',
      touch ? this.scanSelected : MOUSE_OUTLINE,
      this.outline,
      touch ? TOUCH_RIM_PX : MOUSE_RIM_PX,
    );
    node.add(this.outline);
    if (!same) {
      this.opts.sound('selectiontick', 0.35);
      if (touch) this.opts.vibrate('Selection', 1);
    }
  }

  private shells(
    node: THREE.Object3D,
    whole: boolean,
    mat: THREE.Material,
    group: THREE.Group,
    rimPx = TOUCH_RIM_PX,
  ) {
    const meshes: THREE.Mesh[] = [];
    node.traverse((o) => {
      if (isMesh(o) && isShown(o) && !o.userData.text && !o.userData.highlight) {
        const m0 = ([] as THREE.Material[]).concat(o.material)[0] as
          THREE.MeshBasicMaterial | undefined;
        if (m0 && m0.blending !== THREE.AdditiveBlending && !m0.transparent) meshes.push(o);
      }
    });
    node.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const vol = (o: THREE.Mesh) => {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const z = o.geometry
        .boundingBox!.getSize(new THREE.Vector3())
        .multiply(o.getWorldScale(new THREE.Vector3()));
      return Math.abs(z.x * z.y * z.z) + Math.abs(z.x * z.z);
    };
    // A whole module or the bomb: its biggest part (the frame) carries the rim; a part: all of it.
    const targets = whole
      ? meshes.sort((a, b) => vol(b) - vol(a)).slice(0, 1)
      : meshes.slice(0, 40);
    // The rim is a few px wide on screen wherever the part is (the original's `_Outline` is a
    // width on screen too): metres per CSS px at the node's depth.
    const r = this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const at = node.getWorldPosition(new THREE.Vector3());
    const depth = Math.max(0.03, at.distanceTo(this.camera.position));
    const mpp = (2 * depth * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / Math.max(1, r.height);
    const grow = Math.max(whole ? 0.003 : 0.0015, rimPx * mpp);
    for (const o of targets) {
      const bb = o.geometry.boundingBox!;
      const c = bb.getCenter(new THREE.Vector3());
      const z = bb.getSize(new THREE.Vector3()).multiply(o.getWorldScale(new THREE.Vector3()));
      // Grown about the part's own middle, by the same width all round.
      const k = (a: number) => Math.min(4, 1 + (2 * grow) / Math.max(1e-4, Math.abs(a)));
      const own = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const mask = new THREE.Mesh(o.geometry, MASK);
      mask.matrixAutoUpdate = false;
      mask.matrix.copy(own);
      mask.renderOrder = 20;
      mask.userData.text = true;
      group.add(mask);
      const m = own
        .clone()
        .multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z))
        .multiply(new THREE.Matrix4().makeScale(k(z.x), k(z.y), k(z.z)))
        .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      const shell = new THREE.Mesh(o.geometry, mat);
      shell.matrixAutoUpdate = false;
      shell.matrix.copy(m);
      shell.renderOrder = 21;
      shell.userData.text = true;
      group.add(shell);
    }
  }

  // ---- The touch hint (`InteractionHint`) ----

  /**
   * After 10 s untouched (on touch only, as the original), a scanline sweeps down the screen in
   * 1.5 s (after 0.2 s) and lights the outline of every selectable thing it passes: the bomb on
   * the desk, the modules when it is held, the parts of a module looked at.
   */
  private startHint(now: number) {
    this.sweep = now;
    const nodes: [THREE.Object3D, boolean][] =
      this.pose === 'desk' && this.casing
        ? [[this.casing, true]]
        : this.pose === 'held'
          ? this.mods.filter((m) => m.bind || m.id === 'timer').map((m) => [m.root, true])
          : (this.focused?.bind?.parts() ?? []).map((n) => [n, false]);
    for (const [n, whole] of nodes) {
      const g = new THREE.Group();
      g.userData.hint = true;
      this.shells(n, whole, this.scanHint, g);
      n.add(g);
      this.hintGroups.push(g);
    }
  }

  private stopHint() {
    this.sweep = null;
    this.scan.value = 0;
    for (const g of this.hintGroups) g.removeFromParent();
    this.hintGroups = [];
    this.opts.scan?.(null);
  }

  // ---- Frame ----

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.renderer.getDrawingBufferSize(this.scanRes.value);
    this.camera.aspect = w / h;
    this.camera.fov = FOV;
    this.camera.updateProjectionMatrix();
    if (!this.tween && this.pose !== 'module') {
      const [p, q] = this.pose === 'desk' ? this.deskPose() : this.heldPose();
      this.bomb.position.copy(p);
      this.bomb.quaternion.copy(q);
    }
  }

  setEnded(on: boolean) {
    this.ended = on;
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    const work0 = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = this.opts.now();
    this.scanTime.value = now / 1000;
    if (this.b) {
      this.look = bombLook(this.b, t);
      for (const m of this.mods) {
        if (m.timer) m.timer(this.look.timer);
        const l = m.bind && this.look.modules.find((x) => x.id === m.id);
        if (m.bind && l) m.bind.apply(l, t);
      }
    }
    // pose tween
    if (this.tween) {
      const x = Math.min(1, (now - this.tween.t0) / this.tween.dur);
      const e = easeInOutSine(x);
      this.bomb.position.lerpVectors(this.tween.fp, this.tween.tp, e);
      this.bomb.quaternion.slerpQuaternions(this.tween.fq, this.tween.tq, e);
      if (x >= 1) this.tween = null;
    }
    // The hover outline under a still cursor: cleared while anything moves, picked again after.
    if (this.mouse && !this.pointers.size && !this.ended) {
      if (this.busy()) {
        if (this.hovered) this.unhover();
      } else if (this.rehover) {
        this.rehover = false;
        this.hover(this.pick(this.mouse.x, this.mouse.y));
      }
    }
    // turning: smoothed toward the target; the pitch springs back to its settle angle when let go
    if (!this.dragging)
      this.turn.pitch += (this.turn.settle - this.turn.pitch) * Math.min(1, dt * 10);
    const s = Math.min(1, dt * 14);
    this.yaw += (this.turn.yaw - this.yaw) * s;
    this.pitch += (this.turn.pitch - this.pitch) * s;
    this.spin.quaternion.setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(this.pitch),
        THREE.MathUtils.degToRad(this.yaw),
        0,
        'XYZ',
      ),
    );
    // zoom: the camera moves along its axis
    if (this.pose === 'desk') this.zoomT = 0;
    // A pinch let go past the limits springs back inside them.
    if (!this.pointers.size) this.zoomT = clamp(this.zoomT, 0, this.maxZoom());
    // `FixedCameraRig.SetZoomLevel`: the camera reaches the new zoom in |Δ| / 4 s (8 while a
    // pinch holds it), eased in and out; in real time, whatever the frame rate.
    if (this.zoomT !== this.zoomTween.to) {
      const speed = this.pointers.size >= 2 ? 8 : 4;
      this.zoomTween = {
        from: this.zoom,
        to: this.zoomT,
        t0: now,
        ms: (Math.abs(this.zoomT - this.zoom) / speed) * 1000,
      };
    }
    {
      const z = this.zoomTween;
      const x = z.ms > 0 ? Math.min(1, (now - z.t0) / z.ms) : 1;
      const e = x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
      this.zoom = z.from + (z.to - z.from) * e;
    }
    this.camera.position.z = -this.zoom * this.fit();
    // The pan follows the zoom: it eases back toward the middle as the zoom goes out.
    if (this.pointers.size < 2) {
      this.clampPanT();
      this.pan.lerp(this.panT, Math.min(1, dt * 14));
    }
    this.camera.position.x = this.pan.x;
    this.camera.position.y = this.pan.y;
    // the interaction punch
    if (this.punch) {
      const x = (now - this.punch.t0) / PUNCH_MS;
      if (x >= 1) {
        this.punch = null;
        this.punchG.quaternion.identity();
      } else
        this.punchG.quaternion.setFromAxisAngle(
          this.punch.axis,
          THREE.MathUtils.degToRad(this.punch.amp * punchCurve(x)),
        );
    }
    // Keys go down while pressed, or for good once right (`KeypadButton.SetAnimation`).
    for (const m of this.mods)
      for (const p of m.bind?.parts() ?? []) {
        const u = p.userData;
        if (u.down === undefined && !u.stay && u.keyAt === undefined) continue;
        const want = u.down || u.stay ? 1 : 0;
        u.rest ??= p.position.y;
        if (u.keyWant !== want) {
          u.keyFrom = (u.keyAt as number | undefined) ?? 0;
          u.keyWant = want;
          u.keyT0 = now;
        }
        const x = Math.min(1, (now - (u.keyT0 as number)) / KEY_MS);
        u.keyAt = (u.keyFrom as number) + (want - (u.keyFrom as number)) * easeOutQuint(x);
        p.position.y =
          (u.rest as number) - (u.keyAt as number) * ((u.keyDepth as number | undefined) ?? 0);
      }
    // light: dark until the modules wake, the emergency light in the last minute
    const look = this.look;
    const awake = !look || look.awake;
    const dim = awake ? 1 : 0.12;
    if (look?.lastMinute && emergencyOn(look.left, t)) {
      this.hemi.color.set(0xff4a3a);
      this.hemi.intensity = 0.8;
      this.keyLight.color.set(0xff5040);
      this.keyLight.intensity = LIGHT.key;
    } else {
      this.hemi.color.set(0xfff1dc);
      this.hemi.intensity = LIGHT.hemi * dim * (look?.lastMinute ? 0.7 : 1);
      this.keyLight.color.set(0xffe2b8);
      this.keyLight.intensity = LIGHT.key * dim;
    }
    this.fill.intensity = LIGHT.fill * dim;
    // the idle hint (`InteractionHint`): touch only, a scanline down the screen
    if (
      this.opts.ctx.touch &&
      !this.opts.readOnly &&
      !this.ended &&
      !this.pointers.size &&
      now - this.idleSince > IDLE_MS &&
      this.sweep === null
    )
      this.startHint(now);
    if (this.sweep !== null) {
      // `HintRoutine`: 0.2 s, then the offset runs 0 → 1 over 1.5 s.
      const x = (now - this.sweep - 200) / SWEEP_MS;
      if (x >= 1) {
        this.stopHint();
        this.idleSince = now;
      } else {
        this.scan.value = Math.max(0, x);
        this.opts.scan?.(Math.max(0, x));
      }
    }
    this.bomb.visible = !(this.ended && this.b?.end && this.b.end.how !== 'defused');
    this.renderer.render(this.scene, this.camera);
    const work = performance.now() - work0;
    this.stats.frames++;
    this.stats.work.push(work);
    if (this.stats.work.length > 600) this.stats.work.shift();
    if (now - this.stats.t0 > 1000) {
      this.stats.fps = (this.stats.frames * 1000) / (now - this.stats.t0);
      this.stats.frames = 0;
      this.stats.t0 = now;
    }
    this.frameId = requestAnimationFrame(this.frame);
  };

  // ---- Test hooks (non-production builds) ----

  /** Where a module, or one of its parts (by the 1–9 keys' order), shows on screen (CSS px). */
  where(id: string, partIndex?: number): { x: number; y: number } | null {
    const m = this.mods.find((x) => x.id === id);
    if (!m) return null;
    const o = partIndex === undefined ? m.root : m.bind?.parts()[partIndex];
    if (!o) return null;
    o.updateWorldMatrix(true, false);
    let v = o.getWorldPosition(new THREE.Vector3());
    if (isMesh(o) && partIndex !== undefined) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      v = o.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(o.matrixWorld);
    }
    v.project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** Which of a module's parts (in the number keys' order) sends `op` (a `tap` is the press). */
  partFor(id: string, op: ModuleOp): number {
    const m = this.mods.find((x) => x.id === id);
    const want = JSON.stringify(op.op === 'tap' ? { op: 'down' } : op);
    return (m?.bind?.parts() ?? []).findIndex((p) => {
      const h = (p.userData.hit as (() => Hit | null) | undefined)?.();
      return !!h && JSON.stringify(h.op) === want;
    });
  }

  /** What a module shows now (tests read the dials and displays through it). */
  lookOf(id: string) {
    return this.look?.modules.find((m) => m.id === id) ?? null;
  }

  /** A module's middle in world space: the centre of its box (its origin isn't always there). */
  private middleOf(m: Mod) {
    this.bomb.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    m.root.traverse((o) => {
      if (!isMesh(o) || !isShown(o) || o.userData.text || o.userData.highlight) return;
      const mat = ([] as THREE.Material[]).concat(o.material)[0] as
        THREE.MeshBasicMaterial | undefined;
      if (mat?.blending === THREE.AdditiveBlending) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld));
    });
    return box.isEmpty()
      ? new THREE.Vector3().setFromMatrixPosition(m.root.matrixWorld)
      : box.getCenter(new THREE.Vector3());
  }

  /** Where a module's middle shows on screen, as fractions of the canvas (tests). */
  middle(id: string) {
    const m = this.mods.find((x) => x.id === id);
    if (!m) return null;
    const v = this.middleOf(m).project(this.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  /** The zoom, its limit here, the pan and how far the surface looked at is (tests). */
  zoomState() {
    return {
      zoom: this.zoom,
      max: this.maxZoom(),
      pan: { x: this.pan.x, y: this.pan.y },
      surface: this.surface(),
      pointers: this.pointers.size,
      stale: this.stale,
    };
  }

  /** The face the player is turned to. */
  face(): 0 | 1 {
    return faceAt(this.turn.yaw);
  }

  /** Presses part `i` of the focused module as the number keys do. */
  pressPart(i: number) {
    this.numberKey(i);
  }

  releasePart() {
    this.release();
  }

  focusById(id: string) {
    if (this.pose === 'desk') this.pickUp();
    const m = this.mods.find((x) => x.id === id);
    if (m) this.focus(m);
  }

  edges(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    this.casing?.traverse((o) => {
      const d = o.userData;
      if (d.serial) out.push({ serial: d.serial });
      if (d.batteries) out.push({ batteries: d.batteries });
      if (d.indicator) out.push({ indicator: d.indicator });
      if (d.ports !== undefined) out.push({ ports: d.ports });
    });
    return out;
  }

  info() {
    const i = this.renderer.info;
    const w = [...this.stats.work].sort((a, b) => a - b);
    const q = (f: number) => (w.length ? w[Math.min(w.length - 1, Math.floor(w.length * f))]! : 0);
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      textures: i.memory.textures,
      geometries: i.memory.geometries,
      fps: this.stats.fps,
      workP50: q(0.5),
      workP95: q(0.95),
      textureBytes: this.opts.pack?.bytes ?? 0,
      plain: !this.opts.pack,
    };
  }
}

export interface Picked {
  kind: 'part' | 'module' | 'bomb' | 'face';
  mod: Mod | null;
  node: THREE.Object3D;
  hit?: Hit;
  point: THREE.Vector3;
}
