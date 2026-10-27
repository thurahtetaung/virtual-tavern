// The scene pack (the private `3d/` folder the manifest's `scene` names): prefabs as node trees,
// their geometry and textures, and how one prefab becomes three.js objects. Without the pack
// (tests, a server with no asset storage) prefabs are built from plain boxes at the places the
// module bindings ask for, so the bomb still plays.
import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export interface PackMat {
  shader: string;
  color?: number[] | null;
  floats?: Record<string, number>;
  tex: Record<string, { file: string; st: [number, number, number, number] }>;
}

export interface PackNode {
  path: string;
  parent: number;
  p: [number, number, number];
  q: [number, number, number, number];
  s: [number, number, number];
  on: boolean;
  mesh?: number;
  hidden?: boolean;
  mats?: PackMat[];
}

export interface PackJson {
  v: number;
  prefabs: Record<string, PackNode[]>;
  meshes: {
    count: number;
    pos: number;
    nor: number;
    uv: number;
    /** The lightmap's coordinates (room meshes), each renderer's tiling baked in. */
    uv2?: number;
    u32: boolean;
    groups: { off: number; n: number }[];
  }[];
  /** `raw`: sampled as stored (the room's lightmapped and lightmap textures, gamma-space maths). */
  textures: Record<string, { alpha: boolean; w: number; h: number; raw?: boolean }>;
  /** The touch outline's falloff curve (`ScanlineFalloff`), 128 values from v = 0. */
  falloff?: number[];
}

export type Quality = 'hi' | 'lo';

export interface Pack {
  json: PackJson;
  geoms: THREE.BufferGeometry[];
  tex: Map<string, THREE.Texture>;
  /** GPU bytes of the uploaded textures (compressed), for the measurements. */
  bytes: number;
}

/**
 * Loads the pack from `base` (a URL ending in `/`): KTX2 textures transcoded on the device (the
 * transcoder comes from `base` + `basis/`, never a CDN), or the JPEG/PNG set when KTX2 can't load.
 */
export async function loadPack<J extends PackJson = PackJson>(
  base: string,
  renderer: THREE.WebGLRenderer,
  quality: Quality,
  name = 'scene',
  transcoder = `${base}basis/`,
): Promise<Pack & { json: J }> {
  const [json, bin] = await Promise.all([
    fetch(`${base}${name}.json`, { credentials: 'same-origin' }).then((r) => {
      if (!r.ok) throw new Error(`scene ${r.status}`);
      return r.json() as Promise<J>;
    }),
    fetch(`${base}${name}.bin`, { credentials: 'same-origin' }).then((r) => {
      if (!r.ok) throw new Error(`geometry ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const geoms = json.meshes.map((m) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(bin, m.pos, m.count * 3), 3),
    );
    g.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(bin, m.nor, m.count * 3), 3),
    );
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, m.uv, m.count * 2), 2));
    if (m.uv2 !== undefined)
      g.setAttribute(
        'uv1',
        new THREE.BufferAttribute(new Float32Array(bin, m.uv2, m.count * 2), 2),
      );
    const parts = m.groups.map((gr) =>
      m.u32 ? new Uint32Array(bin, gr.off, gr.n) : new Uint16Array(bin, gr.off, gr.n),
    );
    const total = parts.reduce((n, p) => n + p.length, 0);
    const idx = m.u32 ? new Uint32Array(total) : new Uint16Array(total);
    let o = 0;
    parts.forEach((p, i) => {
      idx.set(p, o);
      g.addGroup(o, p.length, i);
      o += p.length;
    });
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  });
  const tex = new Map<string, THREE.Texture>();
  let bytes = 0;
  const names = Object.keys(json.textures);
  let ktxOk = true;
  try {
    const ktx = new KTX2Loader().setTranscoderPath(transcoder).detectSupport(renderer);
    await Promise.all(
      names.map(async (n) => {
        const t = await ktx.loadAsync(`${base}tex/${n}.${quality}.ktx2`);
        t.colorSpace = json.textures[n]!.raw ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        t.anisotropy = ANISOTROPY;
        tex.set(n, t);
      }),
    );
    ktx.dispose();
    // Upload now and drop the CPU copy three.js would otherwise keep of every compressed level.
    for (const t of tex.values()) {
      renderer.initTexture(t);
      const c = t as THREE.CompressedTexture;
      bytes += (c.mipmaps ?? []).reduce(
        (n, m) => n + ((m as { data?: ArrayBufferView }).data?.byteLength ?? 0),
        0,
      );
      c.mipmaps = (c.mipmaps ?? []).map((m) => ({
        ...m,
        data: new Uint8Array(0),
      })) as unknown as typeof c.mipmaps;
    }
  } catch {
    ktxOk = false;
  }
  if (!ktxOk) {
    tex.clear();
    const loader = new THREE.TextureLoader();
    await Promise.all(
      names.map(async (n) => {
        const t = await loader.loadAsync(
          `${base}tex/${n}.${quality}.${json.textures[n]!.alpha ? 'png' : 'jpg'}`,
        );
        t.colorSpace = json.textures[n]!.raw ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        t.anisotropy = ANISOTROPY;
        tex.set(n, t);
      }),
    );
  }
  return { json, geoms, tex, bytes };
}

// ---- Materials ----

const texCache = new WeakMap<Pack, Map<string, THREE.Texture>>();

function texOf(pack: Pack, ref: PackMat['tex'][string] | undefined): THREE.Texture | null {
  if (!ref) return null;
  const base = pack.tex.get(ref.file);
  if (!base) return null;
  const [sx, sy, ox, oy] = ref.st;
  if (sx === 1 && sy === 1 && !ox && !oy) return base;
  let cache = texCache.get(pack);
  if (!cache) texCache.set(pack, (cache = new Map<string, THREE.Texture>()));
  const k = `${ref.file}|${ref.st.join(',')}`;
  let t = cache.get(k);
  if (!t) {
    t = base.clone();
    t.repeat.set(sx, sy);
    t.offset.set(ox, oy);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    cache.set(k, t);
  }
  return t;
}

/** Marks a material whose emissive is the part lighting up (not a hover glow). */
export const GLOWS = 'glows';

/** A Unity shader as a three.js material: the original is almost all plain diffuse. */
function material(pack: Pack, mat: PackMat): THREE.Material | null {
  const map = texOf(pack, mat.tex._MainTex);
  switch (mat.shader) {
    case 'KT/Mobile/Diffuse':
    case 'Legacy Shaders/Diffuse':
      return new THREE.MeshLambertMaterial({ map });
    case 'Legacy Shaders/Transparent/Diffuse':
    case 'KT/Transparent/Mobile Diffuse Underlay200':
      return new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false });
    case 'Unlit/Texture':
      return new THREE.MeshBasicMaterial({ map });
    case 'KT/Unlit/TexturedLightmap': {
      // The room (`room.ts` gives it its lightmap); its texture's tiling goes to the shader.
      const ref = mat.tex._MainTex;
      const m = new THREE.MeshBasicMaterial({ map: ref ? (pack.tex.get(ref.file) ?? null) : null });
      m.userData.lightmapped = true;
      m.userData.st = ref?.st ?? [1, 1, 0, 0];
      return m;
    }
    case 'KT/Unlit/TransparentVertexColorUnderlay30':
      return new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
    case 'KT/LightGlowUnderlay20':
      return new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    case 'KT/Blend Lit and Unlit':
    case 'KT/Blend Lit and Unlit Vertex Color': {
      // The lit texture under the light; the unlit one shows as the part glows (`_Blend` 1).
      const m = new THREE.MeshLambertMaterial({
        map,
        emissiveMap: texOf(pack, mat.tex._UnlitTex),
        emissive: 0x000000,
      });
      m.userData[GLOWS] = true;
      if ((mat.floats?._Blend ?? 0) >= 1) m.emissive.set(0xffffff);
      return m;
    }
    case '?':
      // Set at run time by the original (Wire Sequence's wires): a colour the binding gives.
      return new THREE.MeshLambertMaterial({ color: 0x888888 });
    default:
      return null;
  }
}

/** A mesh, typed (three.js's `instanceof Mesh` narrows to `Mesh<any>`). */
export const isMesh = (o: unknown): o is THREE.Mesh => !!o && (o as THREE.Mesh).isMesh === true;

export type Root = THREE.Object3D & { userData: { nodes: THREE.Object3D[]; plain: boolean } };

/** Finds a node by the end of its path (`a/b` matches `…/a/b`). */
export function find(root: THREE.Object3D, end: string): THREE.Object3D | undefined {
  const nodes = (root as Root).userData.nodes ?? [];
  return nodes.find(
    (o) => o.userData.path === end || (o.userData.path as string).endsWith(`/${end}`),
  );
}

export function findAll(root: THREE.Object3D, re: RegExp): THREE.Object3D[] {
  const nodes = (root as Root).userData.nodes ?? [];
  return nodes.filter((o) => re.test(o.userData.path as string));
}

/** One instance of a prefab: a tree of Object3Ds named and pathed like the original's nodes. */
export function instantiate(pack: Pack | null, name: string): Root {
  const nodes = pack?.json.prefabs[name];
  if (!pack || !nodes) {
    const root = new THREE.Group() as unknown as Root;
    root.name = name;
    root.userData.path = name;
    root.userData.nodes = [root];
    root.userData.plain = true;
    return root;
  }
  const objs: THREE.Object3D[] = [];
  nodes.forEach((n, i) => {
    let o: THREE.Object3D;
    if (n.mesh !== undefined && n.mats) {
      const mats = n.mats.map((m) => material(pack, m));
      if (mats.every((m) => m === null)) o = new THREE.Object3D();
      else {
        o = new THREE.Mesh(
          pack.geoms[n.mesh],
          mats.length === 1
            ? mats[0]!
            : mats.map((m) => m ?? new THREE.MeshBasicMaterial({ visible: false })),
        );
        if (n.hidden) {
          // The original's highlight shapes: kept for the hover outline, never drawn as they are.
          o.userData.highlight = true;
          o.visible = false;
        }
      }
    } else o = new THREE.Object3D();
    o.name = n.path.slice(n.path.lastIndexOf('/') + 1);
    o.userData.path = n.path;
    o.position.fromArray(n.p);
    o.quaternion.set(n.q[0], n.q[1], n.q[2], n.q[3]);
    o.scale.fromArray(n.s);
    if (!n.hidden) o.visible = n.on;
    if (n.parent >= 0) objs[n.parent]!.add(o);
    objs[i] = o;
  });
  const root = objs[0] as Root;
  root.userData.nodes = objs;
  root.userData.plain = false;
  return root;
}

// ---- Plain parts (no pack) ----

const plainMats = new Map<number, THREE.MeshLambertMaterial>();
const plainMat = (colour: number) => {
  let m = plainMats.get(colour);
  if (!m) plainMats.set(colour, (m = new THREE.MeshLambertMaterial({ color: colour })));
  return m.clone();
};
const box = new THREE.BoxGeometry(1, 1, 1);

/**
 * A node a binding needs: the prefab's own, or (without the pack) a plain box of `size` metres at
 * `at`, given on the module's face as [right, up, height above it]. In prefab space a face looks
 * along +y, with its right −x and its up +z.
 */
export function part(
  root: THREE.Object3D,
  end: string,
  plain?: {
    at: [number, number, number];
    size: [number, number, number];
    colour: number;
    parent?: THREE.Object3D;
  },
): THREE.Object3D {
  const found = find(root, end);
  if (found) return found;
  const r = root as Root;
  const o = new THREE.Object3D();
  if (plain && plain.size.some((x) => x > 0)) {
    // The box is a child, so the node's own children keep their size.
    const mesh = new THREE.Mesh(box, plainMat(plain.colour));
    mesh.userData.plain = true;
    mesh.userData.path = `${r.userData.path as string}/${end}/box`;
    mesh.scale.set(plain.size[0], plain.size[2], plain.size[1]);
    o.add(mesh);
  }
  // On a module's face the screen's right is −x, its up +z, and out of the face +y.
  if (plain) o.position.set(-plain.at[0], plain.at[2], plain.at[1]);
  o.name = end.slice(end.lastIndexOf('/') + 1);
  o.userData.path = `${r.userData.path as string}/${end}`;
  (plain?.parent ?? root).add(o);
  r.userData.nodes?.push(o);
  return o;
}

/** Edges and small print are often seen at a slant: filter the pictures for that. */
const ANISOTROPY = 8;

/**
 * Canvas text's resolution (px per metre): at the closest zoom (`NEAREST_M`, 0.1 m) a phone
 * shows about 7,000 device px a metre, so the text stays sharp there; no canvas side goes past
 * `TEXT_MAX_PX`.
 */
export const TEXT_PX_PER_M = 8000;
export const TEXT_MAX_PX = 2048;

/** A text plane's canvas size for a plane `w` × `h` metres. */
export function textCanvasSize(w: number, h: number, px = TEXT_PX_PER_M): [number, number] {
  const k = Math.min(px, TEXT_MAX_PX / Math.max(w, h, 1e-6));
  return [Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k))];
}

/** Text the original draws at run time (TextMeshPro), on a canvas plane in its own fonts. */
export interface TextPlane extends THREE.Mesh {
  userData: { set: (text: string, colour?: string) => void; text: string };
}

export function textPlane(
  w: number,
  h: number,
  font: (px: number) => string,
  opts: { colour: string; align?: CanvasTextAlign; glow?: string; ghost?: string; px?: number } = {
    colour: '#111',
  },
): TextPlane {
  const c = document.createElement('canvas');
  [c.width, c.height] = textCanvasSize(w, h, opts.px);
  const ctx = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISOTROPY;
  const mat = new THREE.MeshBasicMaterial({
    map: t,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat) as unknown as TextPlane;
  mesh.renderOrder = 5;
  mesh.userData.text = '\u0000';
  mesh.userData.set = (text: string, colour = opts.colour) => {
    const key = `${text}|${colour}`;
    if (mesh.userData.text === key) return;
    mesh.userData.text = key;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = font(c.height);
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = 'middle';
    const x = opts.align === 'left' ? 0 : opts.align === 'right' ? c.width : c.width / 2;
    if (opts.ghost) {
      ctx.fillStyle = opts.ghost;
      ctx.fillText(text.replace(/\d/g, '8'), x, c.height * 0.54);
    }
    ctx.fillStyle = colour;
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = c.height * 0.12;
    }
    ctx.fillText(text, x, c.height * 0.54);
    ctx.shadowBlur = 0;
    t.needsUpdate = true;
  };
  return mesh;
}

/**
 * TextMeshPro's word wrap and auto-size for one box: the largest size from `max` down to `min`
 * (steps of a tenth) whose wrapped lines fit `w` × `h` (an em is `size / 10` of the box's units, a
 * line 1.2 em), else `min` with what overflows cut. `measure(text, em)` is a line's width.
 */
export function fitLines(
  text: string,
  w: number,
  h: number,
  max: number,
  min: number,
  wrap: boolean,
  measure: (text: string, em: number) => number,
): { size: number; lines: string[] } {
  const lay = (size: number) => {
    const em = size / 10;
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      if (!wrap) {
        lines.push(para);
        continue;
      }
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next, em) > w) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    const fits =
      lines.length * em * 1.2 <= h + 1e-9 && lines.every((l) => measure(l, em) <= w + 1e-9);
    return { size, lines, fits };
  };
  for (let size = max; size >= min - 1e-9; size = Math.round((size - 0.1) * 10) / 10) {
    const r = lay(size);
    if (r.fits) return { size, lines: r.lines };
  }
  const r = lay(min);
  return { size: min, lines: r.lines.slice(0, Math.max(1, Math.floor(h / ((min / 10) * 1.2)))) };
}

/**
 * A TextMeshPro box on a canvas plane, `w` × `h` in its node's units (`unit` metres each): wrapped
 * and sized down by `fitLines`, aligned as the original (`left`/`center` across, `top`/`middle`/
 * `bottom` down).
 */
export function textBlock(
  w: number,
  h: number,
  unit: number,
  font: (px: number) => string,
  opts: {
    colour: string;
    max: number;
    min: number;
    wrap: boolean;
    align: 'left' | 'center';
    valign: 'top' | 'middle' | 'bottom';
  },
): TextPlane {
  const c = document.createElement('canvas');
  [c.width, c.height] = textCanvasSize(w * unit, h * unit);
  const ctx = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISOTROPY;
  const mat = new THREE.MeshBasicMaterial({
    map: t,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat) as unknown as TextPlane;
  mesh.renderOrder = 5;
  mesh.userData.text = '\u0000';
  const k = c.height / h; // canvas px per unit
  mesh.userData.set = (text: string, colour = opts.colour) => {
    const key = `${text}|${colour}`;
    if (mesh.userData.text === key) return;
    mesh.userData.text = key;
    ctx.clearRect(0, 0, c.width, c.height);
    const measure = (line: string, em: number) => {
      ctx.font = font(em * k);
      return ctx.measureText(line).width / k;
    };
    const { size, lines } = fitLines(text, w, h, opts.max, opts.min, opts.wrap, measure);
    const em = size / 10;
    ctx.font = font(em * k);
    ctx.fillStyle = colour;
    ctx.textAlign = opts.align;
    ctx.textBaseline = 'middle';
    const line = em * 1.2;
    const block = lines.length * line;
    const top = opts.valign === 'top' ? 0 : opts.valign === 'bottom' ? h - block : (h - block) / 2;
    const x = opts.align === 'left' ? 0 : c.width / 2;
    lines.forEach((l, i) => ctx.fillText(l, x, (top + line * (i + 0.5)) * k));
    t.needsUpdate = true;
  };
  return mesh;
}

/**
 * Puts a text plane on a TextMeshPro anchor: the anchor's own scale is undone, and the plane is
 * turned to face out of the module (TextMeshPro text faces −z in its anchor).
 */
export function onAnchor(anchor: THREE.Object3D, plane: THREE.Object3D, dx = 0, dy = 0) {
  plane.scale.set(1 / (anchor.scale.x || 1), 1 / (anchor.scale.y || 1), 1);
  plane.rotation.set(0, Math.PI, 0);
  plane.position.set(dx / (anchor.scale.x || 1), dy / (anchor.scale.y || 1), 0);
  anchor.add(plane);
  return plane;
}

/** Lays a text plane flat on a plain part's face (right −x, up +z, facing +y). */
export function flat(plane: THREE.Object3D) {
  plane.rotation.set(Math.PI / 2, 0, Math.PI, 'ZYX');
}
