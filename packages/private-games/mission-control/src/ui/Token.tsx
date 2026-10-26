import { ProtectedImage, cn } from '@vt/ui';
import { useArt } from './assets.tsx';

export type TokenKind = 'token' | 'used' | 'captain' | 'distress' | 'distress-used' | 'reminder';

/** The emoji each token falls back to without the manifest's art. */
const FALLBACK: Record<TokenKind, string> = {
  token: '📡',
  used: '📴',
  captain: '⚓',
  distress: '🆘',
  'distress-used': '🆘',
  reminder: '🔖',
};

/**
 * A game token (the signal token, its used side, the captain marker, the distress token, the
 * reminder card): the real art from the manifest, else an emoji. `label` is what screen readers
 * hear; pass `decorative` when the text next to it says the same.
 */
export function TokenIcon({
  kind,
  label,
  decorative = false,
  className,
}: {
  kind: TokenKind;
  label: string;
  decorative?: boolean;
  className?: string;
}) {
  const art = useArt();
  const src =
    kind === 'distress-used'
      ? art.token('distress-down')
      : kind === 'distress'
        ? art.token('distress')
        : art.token(kind);
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label };
  if (!src)
    return (
      <span {...a11y} title={label} className={cn('inline-block leading-none', className)}>
        {FALLBACK[kind]}
      </span>
    );
  return (
    <span
      {...a11y}
      title={label}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
    >
      <ProtectedImage src={src} alt="" className="size-full object-contain" />
    </span>
  );
}
