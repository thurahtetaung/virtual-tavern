import type { LoadedRig } from './rig.ts';

let uid = 0;
/**
 * A rig symbol's inline SVG source, ready to draw: ids namespaced (rigs reuse them), textures
 * pointed at their URLs, and with `tint` every path filled with `var(--c)` (inline paths, since
 * `<use>` clones don't take CSS in every engine).
 */
export function symbolSource(rig: LoadedRig, key: string, tint = false): string {
  let src = rig.symbols[key];
  if (src?.startsWith('@')) src = rig.symbols[src.slice(1)];
  if (src == null) return '';
  const p = `r${++uid}_`;
  let out = src
    .replace(/id="([^"]+)"/g, `id="${p}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${p}$1"`)
    .replace(/href="([^"#:]+)"/g, (all, name: string) =>
      rig.textures[name] ? `href="${rig.textures[name]}"` : all,
    );
  if (tint) out = out.replace(/<path /g, '<path style="fill:var(--c)" ');
  return out;
}
