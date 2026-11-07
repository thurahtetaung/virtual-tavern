import { Button } from './components.tsx';
import { cn } from './cn.ts';

/**
 * The lobby's one guide link, worded and placed the same in every game: under the players card,
 * "📖 New to <title>? Read the guide". `title` is the room's own title (`room.gameName`).
 */
export function GuideLink({
  title,
  onClick,
  className,
}: {
  title: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <p className={cn('text-center text-small text-ink-muted', className)}>
      <span aria-hidden>📖 </span>
      New to {title}?{' '}
      <Button variant="quiet" size="sm" onClick={() => onClick()}>
        Read the guide
      </Button>
    </p>
  );
}
