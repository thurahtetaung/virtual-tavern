// The original's gameplay room around the bomb (`FacilityRoom`): the dark concrete room, the desk
// and the standing lamp, lit by the original's baked lightmaps, one per lighting config
// (`LightmapRoom`: Normal, LightsOff, EmergencyRed, LightsOnBuzz), the alarm clock on the desk and
// the Free Play briefcase. The room comes from its own pack (`3d/room/`, beside the bomb's); without
// it the bomb sits in the dark as before.
import * as THREE from 'three';
import { ALARM_MS, LIGHTS_OUT } from '../../logic/bomb.ts';
import type { CaseDial } from '../../logic/game.ts';
import type { Settings } from '../../logic/types.ts';
import type { BombView } from '../../logic/view.ts';
import { type Pack, type PackJson, find, findAll, instantiate, isMesh, textPlane } from './rig.ts';

export type ConfigName = 'Normal' | 'LightsOff' | 'EmergencyRed' | 'LightsOnBuzz';

interface PoseJson {
  p: [number, number, number];
  q: [number, number, number, number];
}

export interface RoomJson {
  default: number;
  configs: {
    name: ConfigName;
    lightmap: string;
    scale: number;
    on: boolean;
    ambient: [number, number, number];
    lights: {
      path: string;
      type: number;
      color: [number, number, number];
      intensity: number;
      runtime: boolean;
      at: [number, number, number];
    }[];
    lightmapInactive: string[];
    realtimeInactive: string[];
  }[];
  camera: {
    fov: number;
    default: PoseJson;
    bomb: PoseJson & { in: number; out: number };
    clock: PoseJson & { in: number; out: number };
  };
  spawn: { bomb: PoseJson; clock: PoseJson };
  focus: { bomb: number; clock: number; case: number };
  emergency: { on: number; offFrom: number; offTo: number };
}

/** `Bomb.Scale`: the original shrinks its bomb to 0.74 in the room; here the room grows instead. */
export const ROOM_SCALE = 1 / 0.74;

export type RoomPack = Pack & { json: PackJson & { room: RoomJson } };

// ---- What the room shows at a moment (pure) ----

export interface RoomLook {
  config: ConfigName;
  /** The alarm clock rings; `lit` is its blink (0.25 s off, 0.25 s on). */
  ringing: boolean;
  lit: boolean;
}

/** The room's emergency light (`EmergencyLight` on `FacilityRoom`): 1 s on, 1.5 s off. */
export const EMERGENCY = { on: 1000, off: 1500 };

/**
 * The room's lighting config at `t`, as `GameplayState`, `CeilingLight` and `EmergencyLight` set
 * it: dark until the modules wake (`KillLights`), then Normal; lights out runs buzz → off → buzz
 * (an override over the base); in the last minute the emergency light cycles the red config;
 * the round's end turns the emergency light off.
 */
export function roomLook(b: BombView | null, t: number): RoomLook {
  if (!b) return { config: 'Normal', ringing: false, lit: true };
  const ringing =
    !!b.alarm && t >= b.alarm.at && t < Math.min(b.alarm.until, b.alarm.at + ALARM_MS);
  const lit = !ringing || (t - b.alarm!.at) % 500 >= 250;
  const look = (config: ConfigName): RoomLook => ({ config, ringing, lit });
  if (t < b.activeAt) return look('LightsOff');
  if (b.lightsAt != null && !(b.end && b.end.at < t)) {
    const x = t - b.lightsAt;
    if (x >= 0 && x < LIGHTS_OUT.buzz) return look('LightsOnBuzz');
    if (x >= LIGHTS_OUT.buzz && x < LIGHTS_OUT.buzz + LIGHTS_OUT.dark) return look('LightsOff');
    if (
      x >= LIGHTS_OUT.buzz + LIGHTS_OUT.dark &&
      x < LIGHTS_OUT.buzz + LIGHTS_OUT.dark + LIGHTS_OUT.buzzBack
    )
      return look('LightsOnBuzz');
  }
  if (!b.end) {
    const since = emergencySince(b);
    if (since !== null && t >= since && (t - since) % (EMERGENCY.on + EMERGENCY.off) < EMERGENCY.on)
      return look('EmergencyRed');
  }
  return look('Normal');
}

/** The alarm clock's beep clip, repeated while it rings (`alarm_clock_beep`, 2.02 s). */
export const ALARM_BEEP_MS = 2020;

/**
 * The room's sounds due in (`from`, `to`], as the original plays them: the ceiling light's
 * clunk as the modules wake (`CeilingLight.TurnOn`), lights out's buzzes, the alarm clock's
 * beeps and its snooze (also when it stops by itself or the round ends), and the emergency
 * light's alarm each time it comes on.
 */
export function roomCues(b: BombView, from: number, to: number): string[] {
  const out: string[] = [];
  const at = (t: number, name: string) => {
    if (t > from && t <= to) out.push(name);
  };
  at(b.activeAt, 'switch');
  if (b.lightsAt != null) {
    at(b.lightsAt, 'light-buzz');
    at(b.lightsAt + LIGHTS_OUT.buzz + LIGHTS_OUT.dark, 'light-buzz-short');
  }
  if (b.alarm) {
    const until = Math.min(b.alarm.until, b.alarm.at + ALARM_MS);
    for (let t = b.alarm.at; t < until && t <= to; t += ALARM_BEEP_MS) at(t, 'alarm-clock-beep');
    if (until > b.alarm.at) at(until, 'alarm-clock-snooze');
  }
  const since = emergencySince(b);
  if (since !== null) {
    const stop = b.end ? b.end.at : to;
    const period = EMERGENCY.on + EMERGENCY.off;
    const first = Math.max(0, Math.ceil((from - since) / period));
    for (let t = since + first * period; t <= Math.min(to, stop); t += period)
      at(t, 'emergencyalarm');
  }
  return out;
}

/** When the clock reached one minute (`PaceMaker.OnTimerTick`), as far as the view can tell. */
export function emergencySince(
  b: Pick<BombView, 'leftAtAnchor' | 'anchorAt' | 'rate' | 'clockAt'>,
): number | null {
  if (b.leftAtAnchor > 60_000) return b.anchorAt + (b.leftAtAnchor - 60_000) / b.rate;
  return Math.max(b.clockAt, b.anchorAt - (60_000 - b.leftAtAnchor) / b.rate);
}

/**
 * The bomb's own light per config (the bomb is lit in real time: the lamp's runtime light and
 * the config's flat ambient). Normal is the look the 3D build was tuned to; the others scale from
 * the original's numbers (ambient 0.588 Normal, 0.031 LightsOff, 0.059 LightsOnBuzz; the lamp
 * 2.7, 0.87 buzzing).
 */
export function bombLight(json: RoomJson | null, config: ConfigName) {
  const normal = { hemi: 1.6, hemiColour: 0xfff1dc, key: 2.1, keyColour: 0xffe2b8, fill: 0.25 };
  if (!json) {
    if (config === 'LightsOff') return { ...normal, hemi: 1.6 * 0.12, key: 2.1 * 0.12, fill: 0.03 };
    if (config === 'EmergencyRed')
      return { ...normal, hemi: 0.8, hemiColour: 0xff4a3a, keyColour: 0xff5040 };
    return normal;
  }
  const c = json.configs.find((x) => x.name === config)!;
  const n = json.configs.find((x) => x.name === 'Normal')!;
  const lamp = (cfg: typeof c) =>
    cfg.lights.filter((l) => l.runtime).reduce((s, l) => s + l.intensity, 0);
  const amb = Math.max(...c.ambient) / Math.max(...n.ambient);
  const colour = new THREE.Color(...c.ambient.map((x) => x / Math.max(...c.ambient)));
  return {
    hemi: normal.hemi * amb,
    hemiColour: config === 'Normal' ? normal.hemiColour : colour.getHex(),
    key: normal.key * (lamp(c) / (lamp(n) || 1)),
    keyColour: normal.keyColour,
    fill: normal.fill * Math.min(1, amb),
  };
}

// ---- The room's objects ----

/** The camera's pose in room space as three.js wants it (Unity's camera looks along +z). */
export function cameraMatrix(pose: PoseJson): THREE.Matrix4 {
  const q = new THREE.Quaternion(...pose.q).multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
  );
  return new THREE.Matrix4().compose(new THREE.Vector3(...pose.p), q, new THREE.Vector3(1, 1, 1));
}

export function poseMatrix(pose: PoseJson): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...pose.p),
    new THREE.Quaternion(...pose.q),
    new THREE.Vector3(1, 1, 1),
  );
}

const TINTS: [RegExp, number, number][] = [
  [/LightGlowParent\/LightGlow$/, 0xfff9e3, 1],
  [/AlarmClockLightGlow$/, 0x14fe00, 0.52],
  [/_LED_On\/LightGlow$/, 0xcbdba7, 1],
  [/Gauge_LED\/LightGlow$/, 0xea4e09, 1],
];

/** The original's additive glow sprites take their colour from a `VertexColor` script. */
export function tintGlows(root: THREE.Object3D) {
  root.traverse((o) => {
    if (!isMesh(o)) return;
    const path = (o.userData.path as string) ?? '';
    const t = TINTS.find(([re]) => re.test(path));
    if (!t) return;
    const m = (o.material as THREE.MeshBasicMaterial).clone();
    m.color.set(t[1]);
    m.opacity = t[2];
    o.material = m;
    o.renderOrder = 6;
  });
}

const VERTEX = `
#ifndef USE_UV1
attribute vec2 uv1;
#endif
uniform vec4 st;
varying vec2 vUv;
varying vec2 vUv1;
void main() {
  vUv = uv * st.xy + st.zw;
  vUv1 = uv1;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * `KT/Unlit/TexturedLightmap`: the texture times the lightmap, in gamma space as the original
 * renders (both textures are sampled as stored and the result is written as it is).
 */
const FRAGMENT = `
uniform sampler2D map;
uniform sampler2D lightMap;
uniform float lmScale;
varying vec2 vUv;
varying vec2 vUv1;
void main() {
  gl_FragColor = vec4(texture2D(map, vUv).rgb * texture2D(lightMap, vUv1).rgb * lmScale, 1.0);
}`;

export class Room {
  readonly group = new THREE.Group();
  readonly json: RoomJson;
  readonly clock: THREE.Object3D;
  private lm = { value: null as THREE.Texture | null };
  private lmScale = { value: 1 };
  private nodes: THREE.Object3D[];
  private config: ConfigName | null = null;
  private clockText: ReturnType<typeof textPlane> | null = null;
  private clockGlow: THREE.Object3D[] = [];
  private minute = '';
  private glowParent: THREE.Object3D | undefined;

  private pack: RoomPack;

  constructor(pack: RoomPack, fonts: { digits: string; labels: string }) {
    this.pack = pack;
    this.json = pack.json.room;
    this.group.matrixAutoUpdate = false;
    const root = instantiate(pack, 'FacilityRoom');
    this.nodes = root.userData.nodes;
    root.traverse((o) => {
      if (!isMesh(o) || !o.userData.path) return;
      const mats = ([] as THREE.Material[]).concat(o.material);
      const mat = mats[0] as THREE.MeshBasicMaterial & { userData: Record<string, unknown> };
      if (!mat?.userData?.lightmapped || !o.geometry.getAttribute('uv1')) return;
      const st = (mat.userData.st as number[] | undefined) ?? [1, 1, 0, 0];
      o.material = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: mat.map },
          lightMap: this.lm,
          lmScale: this.lmScale,
          st: { value: new THREE.Vector4(...st) },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      });
    });
    tintGlows(root);
    this.glowParent = find(root, 'LightGlowParent');
    this.group.add(root);
    // The alarm clock where the original puts it without VR (`AlarmClockSpawnNonVR`).
    const clock = instantiate(pack, 'AlarmClock');
    tintGlows(clock);
    clock.applyMatrix4(poseMatrix(this.json.spawn.clock));
    this.group.add(clock);
    this.clock = clock;
    const lit = find(clock, 'AlarmClock/SevenSegText');
    if (lit) {
      // The seven-segment time, lit green over its own unlit segments, on the LCD (its middle,
      // just in front; the clock's face looks along −z).
      const text = textPlane(0.058, 0.026, (px) => `${Math.round(px * 0.9)}px ${fonts.digits}`, {
        colour: '#14ff00',
        ghost: '#0f150e',
        glow: '#14ff0066',
      });
      text.position.set(0.023, 0.0078, -0.0262);
      text.rotation.set(0, Math.PI, 0);
      lit.parent!.add(text);
      lit.visible = false;
      this.clockText = text;
    }
    this.clockGlow = findAll(clock, /AlarmClockLightGlow$/);
    this.setConfig('LightsOff');
  }

  /** The lightmap and the objects of one config (`LightmapRoom.SetConfig`). */
  setConfig(name: ConfigName) {
    if (this.config === name) return;
    this.config = name;
    const c = this.json.configs.find((x) => x.name === name);
    if (!c) return;
    this.lm.value = this.pack.tex.get(c.lightmap) ?? null;
    this.lmScale.value = c.scale;
    const byPath = (p: string) => this.nodes.find((o) => o.userData.path === p);
    for (const cfg of this.json.configs)
      for (const p of [...cfg.lightmapInactive, ...cfg.realtimeInactive]) {
        const o = byPath(p);
        if (o) o.visible = true;
      }
    for (const p of c.realtimeInactive) {
      const o = byPath(p);
      if (o) o.visible = false;
    }
  }

  /** The clock's face: the device's own time (`AlarmClock.UpdateTime`), blinking while it rings. */
  setClock(look: RoomLook, lightsOn: boolean) {
    const d = new Date();
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (hhmm !== this.minute) {
      this.minute = hhmm;
      this.clockText?.userData.set(hhmm);
    }
    if (this.clockText) this.clockText.visible = look.lit;
    for (const g of this.clockGlow) g.visible = look.lit && !lightsOn ? true : look.lit;
  }

  /** The lamp's glow sprite turns to the camera (`LookAtPlayerCenterEye`). */
  face(camera: THREE.Vector3) {
    if (!this.glowParent) return;
    const local = this.glowParent.parent!.worldToLocal(camera.clone());
    this.glowParent.lookAt(this.glowParent.parent!.localToWorld(local));
  }

  /** The lamp's position in room space (the bomb's key light comes from it). */
  lampAt(): THREE.Vector3 {
    const n = this.json.configs.find((x) => x.name === 'Normal')!;
    const l = n.lights.find((x) => x.runtime) ?? n.lights[0];
    return new THREE.Vector3(...(l?.at ?? [0.99, 1.75, -1.31]));
  }

  snoozeButton(): THREE.Object3D | undefined {
    return find(this.clock, 'AlarmClock/Button');
  }
}

// ---- The Free Play briefcase ----

/** The briefcase's displays and switches, read from the host's settings (`FreeplayDevice`). */
export function setCase(root: THREE.Object3D, s: Settings, fonts: { labels: string }) {
  const r = root as THREE.Object3D & {
    userData: { texts?: Map<string, ReturnType<typeof textPlane>> };
  };
  r.userData.texts ??= new Map();
  const put = (node: string, text: string, colour: string, em: number, chars: number) => {
    const at = find(root, node);
    if (!at) return;
    let t = r.userData.texts!.get(node);
    if (!t) {
      // TextMeshPro sizes these labels down to fit their boxes.
      const h = em * (chars > 5 ? 0.95 : 1.15);
      t = textPlane(h * chars * 0.9, h, (px) => `${Math.round(px * 0.78)}px ${fonts.labels}`, {
        colour,
      });
      (t.userData as unknown as Record<string, unknown>).caseText = true;
      // TextMeshPro's text faces −z in its node; the node's own scale is undone.
      const ws = at.getWorldScale(new THREE.Vector3());
      const rs = root.getWorldScale(new THREE.Vector3());
      t.scale.set(rs.x / ws.x, rs.y / ws.y, 1);
      t.rotation.set(0, Math.PI, 0);
      at.add(t);
      r.userData.texts!.set(node, t);
    }
    t.userData.set(text, colour);
  };
  const LABEL = '#93c4f5';
  const VALUE = '#fe9866';
  const min = Math.floor(s.time / 60);
  put('TimeSetting/TimeLabel', 'Time', LABEL, 0.0495, 6);
  put('TimeSetting/TimeValue', `${min}:${String(s.time % 60).padStart(2, '0')}`, VALUE, 0.045, 6);
  put('ModuleCountSetting/ModuleCountLabel', 'Modules', LABEL, 0.0495, 8);
  put('ModuleCountSetting/ModuleCountValue', String(s.modules), VALUE, 0.045, 4);
  put('NeedySetting/NeedyLabel', 'NEEDY', LABEL, 0.036, 7);
  put('NeedySetting/NeedyValue', s.needy ? 'ON' : 'OFF', s.needy ? '#2fe034' : '#fe0000', 0.045, 4);
  put('HardcoreSetting/HardcoreLabel', 'HARDCORE', LABEL, 0.036, 9);
  put(
    'HardcoreSetting/HardcoreValue',
    s.hardcore ? 'ON' : 'OFF',
    s.hardcore ? '#2fe034' : '#fe0000',
    0.045,
    4,
  );
  put('Start_btn/StartLabel', 'START', '#fecbcb', 0.0495, 6);
  put('Bot/FreeplayLabel', 'FREE PLAY', LABEL, 0.03, 10);
  put('Top/Free Play Label', 'Free Play', '#fafcffae', 0.072, 10);
  put(
    'DifficultyIndicator/EstimatedDifficultyLabel',
    'ESTIMATED DIFFICULTY',
    '#2d2d2d',
    0.01675,
    22,
  );
  // `ToggleSwitch`: on −30°, off 30° about z, turned in 0.1 s (`AnimationTime`) by `stepCase`.
  for (const [node, on] of [
    ['NeedySetting/NeedyMode_tgl', s.needy],
    ['HardcoreSetting/HardcoreMode_tgl', s.hardcore],
  ] as const) {
    const o = find(root, node);
    if (!o) continue;
    const u = o.userData;
    u.rest ??= o.quaternion.clone();
    const want = on ? 30 : -30;
    if (u.tglTo === want) continue;
    u.tglFrom = u.tglTo === undefined ? want : tglAngle(o, performance.now());
    u.tglTo = want;
    u.tglT0 = performance.now();
  }
  stepCase(root, performance.now());
}

const TOGGLE_MS = 100;
/** `KeypadButton`: down by half its height in 0.25 s, back in 0.25 s, easeOutQuint. */
const CASE_KEY_MS = 250;

function tglAngle(o: THREE.Object3D, now: number): number {
  const u = o.userData as { tglFrom: number; tglTo: number; tglT0: number };
  const x = Math.min(1, (now - u.tglT0) / TOGGLE_MS);
  return u.tglFrom + (u.tglTo - u.tglFrom) * x;
}

/** Presses one of the briefcase's keys: it goes down and comes back up. */
export function pressCaseKey(key: THREE.Object3D, now: number) {
  const u = key.userData;
  u.restY ??= key.position.y;
  if (u.depth === undefined) {
    // `ButtonHeightOverride` isn't in the pack: the key mesh's own height.
    const mesh = isMesh(key) ? key : null;
    mesh?.geometry.computeBoundingBox();
    const h = mesh?.geometry.boundingBox?.getSize(new THREE.Vector3()).y ?? 0.01;
    u.depth = Math.min(h, 0.02) * 0.5;
  }
  u.keyT0 = now;
}

/** The briefcase's moving parts at a moment: the switches turning, the keys going down and up. */
export function stepCase(root: THREE.Object3D, now: number) {
  for (const node of ['NeedySetting/NeedyMode_tgl', 'HardcoreSetting/HardcoreMode_tgl']) {
    const o = find(root, node);
    if (!o || o.userData.tglTo === undefined) continue;
    o.quaternion
      .copy(o.userData.rest as THREE.Quaternion)
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          THREE.MathUtils.degToRad(tglAngle(o, now)),
        ),
      );
  }
  for (const key of CASE_KEYS) {
    const o = find(root, key);
    const u = o?.userData;
    if (!o || u?.keyT0 === undefined) continue;
    const t = now - (u.keyT0 as number);
    const k =
      t < CASE_KEY_MS
        ? easeOutQuint(t / CASE_KEY_MS)
        : 1 - easeOutQuint(Math.min(1, (t - CASE_KEY_MS) / CASE_KEY_MS));
    o.position.y = (u.restY as number) - k * (u.depth as number);
    if (t >= 2 * CASE_KEY_MS) delete u.keyT0;
  }
}

const easeOutQuint = (x: number) => 1 - (1 - x) ** 5;

const CASE_KEYS = [
  'TimeSetting/Time_INCR_btn',
  'TimeSetting/Time_DECR_btn',
  'ModuleCountSetting/Modules_INCR_btn',
  'ModuleCountSetting/Modules_DECR_btn',
];

/** What a tap on the briefcase touches, and the node that moves (a key, a switch). */
export function caseButton(
  o: THREE.Object3D,
): { what: 'start' | CaseDial; node: THREE.Object3D } | null {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) {
    const p = (x.userData.path as string) ?? '';
    if (/\/StartButton$/.test(p) || /\/Start_btn$/.test(p)) return { what: 'start', node: x };
    const dial: CaseDial | null = /\/Time_INCR_btn$/.test(p)
      ? 'time-up'
      : /\/Time_DECR_btn$/.test(p)
        ? 'time-down'
        : /\/Modules_INCR_btn$/.test(p)
          ? 'modules-up'
          : /\/Modules_DECR_btn$/.test(p)
            ? 'modules-down'
            : /\/NeedyMode_tgl$/.test(p)
              ? 'needy'
              : /\/HardcoreMode_tgl$/.test(p)
                ? 'hardcore'
                : null;
    if (dial) return { what: dial, node: x };
  }
  return null;
}
