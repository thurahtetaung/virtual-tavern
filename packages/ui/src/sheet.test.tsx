import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComponentSheet, SHEET_NOTICES, SHEET_TAGS, SHEET_VARIANTS } from './sheet.tsx';

/*
 * The gate for the shared parts: the component sheet, rendered in both themes, has every text at
 * WCAG AA against the surface it sits on (4.5, or 3 for placeholders, icons, input borders and
 * focus rings), and every control at least 44 × 44 px. Colours are resolved the way the browser
 * would: the element's own token class (with its `dark:`, `disabled:`, `aria-invalid:`… variants
 * when they apply), else its nearest ancestor's, against the token values in index.css.
 * e2e/component-sheet.spec.ts measures the same sheet in a real browser.
 */

type Theme = 'light' | 'dark';
type Rgb = [number, number, number];

// ---- tokens ----------------------------------------------------------------------------------

const css = readFileSync(new URL('../../../apps/web/src/index.css', import.meta.url), 'utf8');

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf('\n}', start));
  return new Map(
    [...body.matchAll(/--vt-([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!]),
  );
}
const TOKENS: Record<Theme, Map<string, string>> = {
  light: block(':root'),
  dark: block(":root[data-theme='dark']"),
};

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (top: Rgb, bottom: Rgb, alpha: number): Rgb =>
  top.map((v, i) => v * alpha + bottom[i]! * (1 - alpha)) as Rgb;

/** `color-mix(in oklab, X p%, black)`: oklab with black's L, a, b all 0, so it scales all three. */
function mixBlack(c: Rgb, p: number): Rgb {
  const [r, g, b] = c.map(lin) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) * p;
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) * p;
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) * p;
  const out = [
    4.0767416621 * l ** 3 - 3.3077115913 * m ** 3 + 0.2309699292 * s ** 3,
    -1.2684380046 * l ** 3 + 2.6097574011 * m ** 3 - 0.3413193965 * s ** 3,
    -0.0041960863 * l ** 3 - 0.7034186147 * m ** 3 + 1.707614701 * s ** 3,
  ];
  return out.map((v) => {
    const c2 = Math.min(1, Math.max(0, v));
    return 255 * (c2 <= 0.0031308 ? 12.92 * c2 : 1.055 * c2 ** (1 / 2.4) - 0.055);
  }) as Rgb;
}

// ---- markup ----------------------------------------------------------------------------------

interface Node {
  tag: string;
  attrs: Map<string, string>;
  children: Node[];
  parent: Node | null;
  text: string;
}
// HTML's void elements (React closes SVG's own elements explicitly).
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source']);

function parse(html: string): Node {
  const root: Node = { tag: 'root', attrs: new Map(), children: [], parent: null, text: '' };
  let at = root;
  for (const m of html.matchAll(
    /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g,
  )) {
    if (m[5] !== undefined) {
      at.text += m[5].replace(/&[a-z#0-9]+;/gi, 'x');
      continue;
    }
    const [, close, tag, rawAttrs, self] = m;
    if (close) {
      at = at.parent ?? root;
      continue;
    }
    const attrs = new Map(
      [...rawAttrs!.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map((a) => [a[1]!, a[2] ?? '']),
    );
    const node: Node = { tag: tag!, attrs, children: [], parent: at, text: '' };
    at.children.push(node);
    if (!self && !VOID.has(tag!)) at = node;
  }
  return root;
}

const walk = (n: Node, visit: (n: Node) => void) => {
  visit(n);
  for (const c of n.children) walk(c, visit);
};
const ancestors = function* (n: Node | null) {
  for (let a = n; a; a = a.parent) yield a;
};
const classes = (n: Node) => (n.attrs.get('class') ?? '').split(/\s+/).filter(Boolean);

// ---- resolving a property --------------------------------------------------------------------

/** The variants that apply to `n` in `theme` (pointer states, breakpoints and pseudo parts don't). */
function activeVariants(n: Node, theme: Theme) {
  const on = new Set<string>();
  if (theme === 'dark') on.add('dark');
  if (n.attrs.has('disabled')) on.add('disabled');
  if (n.attrs.get('aria-invalid') === 'true') on.add('aria-invalid');
  if (n.attrs.has('readonly')) on.add('read-only');
  if ([...ancestors(n)].some((a) => a.tag === 'details' && a.attrs.has('open')))
    on.add('group-open');
  return on;
}

/** The value of `n`'s own class for `prop` (`bg`, `text`, `border`, `outline`…), if any applies. */
function own(n: Node, theme: Theme, prop: string, extra: string[] = []): string | null {
  const active = activeVariants(n, theme);
  for (const v of extra) active.add(v);
  let best: { value: string; weight: number } | null = null;
  for (const c of classes(n)) {
    const parts = c.split(':');
    const util = parts.pop()!;
    if (!parts.every((p) => active.has(p))) continue;
    if (!util.startsWith(`${prop}-`)) continue;
    const value = util.slice(prop.length + 1);
    if (!isColor(value)) continue;
    if (!best || parts.length >= best.weight) best = { value, weight: parts.length };
  }
  return best?.value ?? null;
}

const TOKEN_NAMES = new Set([...TOKENS.light.keys()]);
const isColor = (v: string) =>
  v === 'transparent' || v.startsWith('[color-mix') || TOKEN_NAMES.has(v.split('/')[0]!);

function color(value: string, theme: Theme): { rgb: Rgb; alpha: number } | null {
  if (value === 'transparent') return null;
  const mix = /^\[color-mix\(in_oklab,var\(--vt-([\w-]+)\)_(\d+)%,black\)\]$/.exec(value);
  if (mix)
    return { rgb: mixBlack(rgb(TOKENS[theme].get(mix[1]!)!), Number(mix[2]) / 100), alpha: 1 };
  const [name, alpha] = value.split('/');
  const hex = TOKENS[theme].get(name!);
  if (!hex) throw new Error(`no token ${name}`);
  return { rgb: rgb(hex), alpha: alpha ? Number(alpha) / 100 : 1 };
}

/** The surface under `n`: the nearest background, blended over what is under it. */
function background(n: Node | null, theme: Theme): Rgb {
  const layers: { rgb: Rgb; alpha: number }[] = [];
  for (const a of ancestors(n)) {
    const v = own(a, theme, 'bg');
    const c = v && color(v, theme);
    if (c) {
      layers.push(c);
      if (c.alpha >= 1) break;
    }
  }
  let acc = rgb(TOKENS[theme].get('page')!);
  for (const l of layers.reverse()) acc = blend(l.rgb, acc, l.alpha);
  return acc;
}

/** The text colour of `n` (inherited), as painted on its background. */
function foreground(n: Node, theme: Theme, extra: string[] = []): Rgb {
  for (const a of ancestors(n)) {
    const v = own(a, theme, 'text', a === n ? extra : []);
    const c = v && color(v, theme);
    if (c) return blend(c.rgb, background(n, theme), c.alpha);
  }
  return rgb(TOKENS[theme].get('ink')!);
}

const hidden = (n: Node) => [...ancestors(n)].some((a) => a.attrs.get('aria-hidden') === 'true');
const inside = (n: Node, tag: string) => [...ancestors(n)].some((a) => a.tag === tag);
const name = (n: Node) =>
  [...ancestors(n)].find((a) => a.attrs.has('data-specimen'))?.attrs.get('data-specimen') ?? '?';

interface Miss {
  where: string;
  what: string;
  ratio: number;
  need: number;
}

function contrastMisses(theme: Theme): { misses: Miss[]; checked: number } {
  const root = parse(renderToStaticMarkup(<ComponentSheet cover="/cover.webp" />));
  const misses: Miss[] = [];
  let checked = 0;
  const check = (n: Node, what: string, fg: Rgb, bg: Rgb, need: number) => {
    checked++;
    const r = ratio(fg, bg);
    if (r < need) misses.push({ where: name(n), what, ratio: +r.toFixed(2), need });
  };
  walk(root, (n) => {
    if (n.tag === 'root' || inside(n, 'select')) return;
    const words = n.text.trim();
    // Text: everything a player reads. Disabled controls keep 4.5 on purpose (their label is
    // often why they are off).
    if (words && /[\p{L}\p{N}]/u.test(words) && !hidden(n))
      check(n, `text "${words.slice(0, 24)}"`, foreground(n, theme), background(n, theme), 4.5);
    // Icons are marks: 3:1.
    if (n.tag === 'svg') check(n, 'icon', foreground(n, theme), background(n, theme), 3);
    if (n.tag === 'input' && n.attrs.has('placeholder'))
      check(n, 'placeholder', foreground(n, theme, ['placeholder']), background(n, theme), 3);
    // Input borders (WCAG 1.4.11) while the field can be used.
    const ui = n.attrs.get('data-ui');
    if (
      (ui === 'input' || ui === 'select' || ui === 'stepper') &&
      !n.attrs.has('disabled') &&
      !n.attrs.has('aria-disabled')
    ) {
      const v = own(n, theme, 'border');
      if (v) check(n, 'input border', color(v, theme)!.rgb, background(n.parent, theme), 3);
    }
    // Focus rings, against what is around the control.
    const ring = own(n, theme, 'outline', ['focus-visible']);
    if (ring) check(n, 'focus ring', color(ring, theme)!.rgb, background(n.parent, theme), 3);
  });
  return { misses, checked };
}

// ---- target sizes ----------------------------------------------------------------------------

const TALL = /^(min-h|h|size)-(\d+)$/;
const WIDE = /^(min-w|w|size)-(\d+)$/;
const FULL = new Set(['w-full', 'flex-1', 'grow', 'flex', 'block', 'grid']);

/** Whether `n`'s own classes make it at least 44 px (11 units) tall and wide. */
function bigEnough(n: Node) {
  const cs = classes(n).filter((c) => !c.includes(':'));
  const units = (re: RegExp) =>
    Math.max(
      0,
      ...cs
        .map((c) => re.exec(c))
        .filter(Boolean)
        .map((m) => Number(m![2])),
    );
  const tall = units(TALL) >= 11;
  const wide = units(WIDE) >= 11 || cs.some((c) => FULL.has(c));
  return { tall, wide };
}

function interactive(n: Node) {
  const role = n.attrs.get('role');
  return (
    n.tag === 'button' ||
    n.tag === 'select' ||
    n.tag === 'summary' ||
    (n.tag === 'a' && n.attrs.has('href')) ||
    (n.tag === 'input' && n.attrs.get('type') !== 'hidden') ||
    role === 'switch' ||
    role === 'tab'
  );
}

function smallTargets(): string[] {
  const root = parse(renderToStaticMarkup(<ComponentSheet cover="/cover.webp" />));
  const small: string[] = [];
  walk(root, (n) => {
    if (!interactive(n)) return;
    // A checkbox inside its label: the label is the target.
    const box = n.tag === 'input' && /^(checkbox|radio)$/.test(n.attrs.get('type') ?? '');
    const target = box && n.parent?.tag === 'label' ? n.parent : n;
    const { tall, wide } = bigEnough(target);
    if (!tall || !wide)
      small.push(`${name(n)}: <${n.tag}> ${tall ? '' : 'short'} ${wide ? '' : 'narrow'}`.trim());
  });
  return small;
}

// ---- the tests -------------------------------------------------------------------------------

describe('component sheet', () => {
  it('reads the token values from index.css', () => {
    for (const theme of ['light', 'dark'] as const)
      for (const t of ['page', 'card', 'sunk', 'ink', 'accent', 'accent-fg', 'focus', 'on-fill'])
        expect(TOKENS[theme].get(t), `${theme} ${t}`).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('shows every button variant, tag and notice in every state', () => {
    const html = renderToStaticMarkup(<ComponentSheet />);
    for (const v of SHEET_VARIANTS)
      for (const s of ['rest', 'hover', 'pressed', 'focus', 'disabled', 'sending'])
        expect(html).toContain(`data-specimen="button/${v}/${s}"`);
    for (const t of SHEET_TAGS) expect(html).toContain(`>${t}</span>`);
    for (const t of SHEET_NOTICES) expect(html).toContain(`data-specimen="notice/${t}"`);
  });

  for (const theme of ['light', 'dark'] as const)
    it(`meets the contrast targets in ${theme} mode`, () => {
      const { misses, checked } = contrastMisses(theme);
      expect(checked).toBeGreaterThan(200);
      expect(misses).toEqual([]);
    });

  it('gives every control a target of at least 44 × 44 px', () => {
    expect(smallTargets()).toEqual([]);
  });

  it('measures what it claims (dark primary is the soft gold, not amber)', () => {
    const accent = rgb(TOKENS.dark.get('accent')!);
    const fg = rgb(TOKENS.dark.get('accent-fg')!);
    expect(ratio(fg, accent)).toBeGreaterThan(8);
    expect(TOKENS.dark.get('accent')!.toLowerCase()).toBe('#e0a456');
  });
});
