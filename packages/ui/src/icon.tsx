import { cn } from './cn.ts';
import { ICON_SPRITE, type IconName } from './icon-sprite.generated.ts';

export { ICON_NAMES, type IconName } from './icon-sprite.generated.ts';

/** The stroke every icon draws at, in screen pixels, whatever its size. */
const STROKE_PX = 1.5;

/**
 * The icon sprite: render it once at the root of the app, and every `Icon` points into it with
 * `<use>`. The icons ship inside the JavaScript, so there is no icon font and no request per icon.
 * The list lives in scripts/icon-sprite.mjs.
 */
export function IconSprite() {
  return (
    <svg
      aria-hidden
      focusable="false"
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      dangerouslySetInnerHTML={{ __html: ICON_SPRITE }}
    />
  );
}

/**
 * A Lucide icon from the sprite, in the colour of its text (`currentColor`). Hidden from screen
 * readers unless it has a `label`, which only an icon-only control needs; next to a word, leave it
 * out. Sizes: 16 inline in text, 20 in buttons and rows, 24 in header buttons, 48 as an emblem.
 */
export function Icon({
  name,
  size = 20,
  label,
  className,
}: {
  name: IconName;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      // The icons are drawn on a 24-unit grid, so this keeps the stroke 1.5 px at any size.
      strokeWidth={(STROKE_PX * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={cn('inline-block shrink-0', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}
