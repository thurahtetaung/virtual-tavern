import { PlayerTag, cn, loadManifest } from '@vt/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { type Manifest, namesOf } from '../logic/manifest.ts';
import type { Names } from '../logic/names.ts';
import type { StampedeView } from '../logic/types.ts';

export const GAME_ID = 'stampede';

/** The private manifest's names (the Pink Cow's and the cows'), or the placeholders. */
export function useNames(): Names {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    let live = true;
    void loadManifest(GAME_ID).then((body) => {
      if (live && body) setManifest(body);
    });
    return () => {
      live = false;
    };
  }, []);
  return namesOf(manifest);
}

const CSS = `
@keyframes sp-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes sp-fly { 0% { opacity: 0; transform: translate(-40px, -30px) scale(.4) rotate(-20deg) } 70% { opacity: 1; transform: translate(0, 0) scale(1.25) } 100% { opacity: 1; transform: none } }
@keyframes sp-walk { 0% { transform: translateX(-12px) } 50% { transform: translateX(6px) rotate(6deg) } 100% { transform: none } }
@keyframes sp-moo { 0%,100% { transform: none } 25% { transform: rotate(-8deg) scale(1.1) } 75% { transform: rotate(8deg) scale(1.1) } }
.sp-rise { animation: sp-rise .35s ease-out both }
.sp-fly { display: inline-block; animation: sp-fly .7s cubic-bezier(.2,.8,.3,1.2) both }
.sp-walk { display: inline-block; animation: sp-walk .8s ease-in-out both }
.sp-moo { display: inline-block; animation: sp-moo .5s ease-in-out 2 }
@media (prefers-reduced-motion: reduce) {
  .sp-rise, .sp-fly, .sp-walk, .sp-moo { animation: none }
}
`;

export function StampedeStyles() {
  return <style>{CSS}</style>;
}

/** The Pink Cow marker, always next to its holder's name. */
export function PinkMark({ names, className }: { names: Names; className?: string }) {
  return (
    <span role="img" aria-label={names.pink} title={names.pink} className={className}>
      🩷
    </span>
  );
}

/** A player's name with their colour, the host's crown, and the Pink Cow when they hold it. */
export function Who({
  view,
  id,
  hostId,
  online,
  names,
  children,
  className,
}: {
  view: StampedeView;
  id: string;
  hostId: string;
  online: (id: string) => boolean;
  names: Names;
  children?: ReactNode;
  className?: string;
}) {
  const name =
    view.seats.find((s) => s.id === id)?.name ?? view.scores.find((s) => s.id === id)?.name ?? '?';
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <PlayerTag name={name} you={id === view.me?.id} host={id === hostId} offline={!online(id)} />
      {view.pinkCow === id && <PinkMark names={names} />}
      {children}
    </span>
  );
}

/** "🐄 5" with the right word for screen readers. */
export function CowCount({ n, names, className }: { n: number; names: Names; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`${n} ${n === 1 ? names.cow : names.cows}`}
      className={cn('font-bold tabular-nums', className)}
    >
      🐄 {n}
    </span>
  );
}
