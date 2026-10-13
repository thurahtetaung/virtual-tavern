import { type ReactNode, useEffect, useState } from 'react';
import type { Content } from './assets.ts';

const loaded = new Map<string, Promise<boolean>>();

/** Loads a display font once per page; false where fonts can't be loaded (tests, old browsers). */
function loadFont(url: string, family: string): Promise<boolean> {
  let p = loaded.get(url);
  if (!p) {
    p = (async () => {
      if (typeof FontFace === 'undefined' || !document.fonts) return false;
      const face = new FontFace(family, `url(${JSON.stringify(url)})`, { display: 'swap' });
      await face.load();
      document.fonts.add(face);
      return true;
    })().catch(() => false);
    loaded.set(url, p);
  }
  return p;
}

/** The CSS font stack for display texts once the edition's font has loaded, else null. */
export function useDisplayFont(font: Content['font']): string | null {
  const [ready, setReady] = useState<string | null>(null);
  const url = font?.url;
  const family = font?.family;
  useEffect(() => {
    if (!url || !family) return;
    let live = true;
    void loadFont(url, family).then((ok) => {
      if (live && ok) setReady(url);
    });
    return () => {
      live = false;
    };
  }, [url, family]);
  return url && family && ready === url
    ? `${JSON.stringify(family)}, ui-serif, Georgia, serif`
    : null;
}

/**
 * The game's root: the edition's team colours (as CSS variables) and, unless the viewer chose
 * plain headings, its display font for the few big texts marked `hy-display`.
 */
export function ThemeRoot({
  c,
  plain,
  className,
  children,
}: {
  c: Content;
  plain: boolean;
  className?: string;
  children: ReactNode;
}) {
  const display = useDisplayFont(plain ? null : c.font);
  return (
    <div
      className={className}
      data-edition={c.gameId}
      style={{ ...c.colors, ...(display && { ['--hy-display' as string]: display }) }}
    >
      {children}
    </div>
  );
}
