import { INDICATOR_LABELS } from './data.ts';
import { int, next, pick, type Stream } from './rand.ts';
import type { PortKind, Side, Widget } from './types.ts';

/**
 * The casing's ten widget areas (`BasicRectangleBomb.WidgetAreas`, in their order): the side each
 * is on, where along it (the area's local x), and its zone grid (lossy scale ÷ `Widget.BaseSize`).
 */
export const AREAS: { side: Side; x: number; cols: number; rows: number }[] = [
  { side: 'top', x: 0, cols: 3, rows: 2 },
  { side: 'top', x: 0.188, cols: 2, rows: 2 },
  { side: 'top', x: -0.188, cols: 2, rows: 2 },
  { side: 'right', x: -0.078, cols: 2, rows: 2 },
  { side: 'right', x: 0.079, cols: 2, rows: 2 },
  { side: 'left', x: -0.078, cols: 2, rows: 2 },
  { side: 'left', x: 0.079, cols: 2, rows: 2 },
  { side: 'bottom', x: 0, cols: 3, rows: 2 },
  { side: 'bottom', x: 0.188, cols: 2, rows: 2 },
  { side: 'bottom', x: -0.188, cols: 2, rows: 2 },
];

/** Every widget is 2 × 1 zones (`SizeX`, `SizeZ` in the prefabs). */
const SIZE_X = 2;
const SIZE_Z = 1;

interface Zone {
  area: number;
  x: number;
  z: number;
  sx: number;
  sz: number;
}

/** `SerialNumber.letters` as written in the code: no O or Y, E twice. */
const LETTERS = 'ABCDEFGHIJKLMNEPQRSTUVWXZ';
const DIGITS = '0123456789';

/** `SerialNumber.Awake`: two of letters + digits, a digit, two letters, a digit. */
export function makeSerial(r: Stream): string {
  const any = LETTERS + DIGITS;
  let s = '';
  for (let i = 0; i < 2; i++) s += any[int(r, any.length)];
  s += int(r, 10);
  for (let i = 3; i < 5; i++) s += any[int(r, any.length - 10)];
  s += int(r, 10);
  return s;
}

/** `PortWidget.PortGroups`: one group is chosen, then each of its ports is there 50 %. */
const PORT_GROUPS: PortKind[][] = [
  ['serial', 'parallel'],
  ['dvi', 'ps2', 'rj45', 'rca'],
];

/** `WidgetZone.GetZone` + `SubdivideZoneForWidget`: a random zone that fits, split around it. */
function place(zones: Zone[], r: Stream): Zone | null {
  const fits = zones.filter((z) => SIZE_X <= z.sx && SIZE_Z <= z.sz);
  if (!fits.length) return null;
  const zone = fits[int(r, fits.length)]!;
  zones.splice(zones.indexOf(zone), 1);
  const num = zone.sx - SIZE_X;
  const num2 = zone.sz - SIZE_Z;
  const num3 = int(r, num + 1);
  const num4 = int(r, num2 + 1);
  const num5 = num - num3;
  const num6 = num2 - num4;
  const at: Zone = { area: zone.area, x: zone.x + num3, z: zone.z + num4, sx: zone.sx - num, sz: zone.sz - num2 };
  const rest: Zone[] = [];
  if (num3 > 0) rest.push({ area: zone.area, x: zone.x, z: zone.z, sx: num3, sz: zone.sz });
  if (num4 > 0) rest.push({ area: zone.area, x: zone.x + num3, z: zone.z, sx: zone.sx - num, sz: num4 });
  if (num5 > 0)
    rest.push({ area: zone.area, x: zone.x + zone.sx - num + num3, z: zone.z, sx: num - num3, sz: zone.sz });
  if (num6 > 0)
    rest.push({
      area: zone.area,
      x: zone.x + num3,
      z: zone.z + zone.sz - num2 + num4,
      sx: zone.sx - num,
      sz: num2 - num4,
    });
  zones.push(...rest);
  return at;
}

/**
 * `WidgetGenerator.GenerateWidgets`: the serial tag, then `optional` widgets, each uniform of
 * indicator, battery holder and port plate; one that finds no free zone is dropped.
 */
export function makeWidgets(r: Stream, optional = 5): { serial: string; widgets: Widget[] } {
  const zones: Zone[] = AREAS.map((a, area) => ({ area, x: 0, z: 0, sx: a.cols, sz: a.rows }));
  const widgets: Widget[] = [];
  const serial = makeSerial(r);
  const spot = (z: Zone) => ({ area: z.area, x: z.x, z: z.z, turned: false });
  const first = place(zones, r);
  if (first) widgets.push({ kind: 'serial', ...spot(first) });
  for (let i = 0; i < optional; i++) {
    const kind = int(r, 3);
    if (kind === 0) {
      // BatteryWidget.Awake: DoubleA (2) or DCell (1).
      const batteries = int(r, 2) === 0 ? 2 : 1;
      const z = place(zones, r);
      if (z) widgets.push({ kind: 'battery', batteries, ...spot(z) });
    } else if (kind === 1) {
      const z = place(zones, r);
      if (!z) continue;
      // IndicatorWidget.InitWidget: a label not used yet ("NLL" once all are), lit 60 %.
      const used = new Set(widgets.flatMap((w) => (w.kind === 'indicator' ? [w.label] : [])));
      const free = INDICATOR_LABELS.filter((l) => !used.has(l));
      const label = free.length ? pick(r, free) : 'NLL';
      const lit = next(r) > 0.4;
      widgets.push({ kind: 'indicator', label, lit, ...spot(z) });
    } else {
      const z = place(zones, r);
      if (!z) continue;
      const group = PORT_GROUPS[int(r, PORT_GROUPS.length)]!;
      const ports = group.filter(() => next(r) > 0.5);
      widgets.push({ kind: 'ports', ports, ...spot(z) });
    }
  }
  return { serial, widgets };
}

// ---- What the rules read ----

export const batteries = (ws: readonly Widget[]) =>
  ws.reduce((n, w) => n + (w.kind === 'battery' ? w.batteries : 0), 0);
export const litIndicator = (ws: readonly Widget[], label: string) =>
  ws.some((w) => w.kind === 'indicator' && w.label === label && w.lit);
export const hasPort = (ws: readonly Widget[], port: PortKind) =>
  ws.some((w) => w.kind === 'ports' && w.ports.includes(port));
export const serialOdd = (serial: string) => Number(serial[serial.length - 1]) % 2 === 1;
export const serialVowel = (serial: string) => /[AEIOU]/.test(serial);
