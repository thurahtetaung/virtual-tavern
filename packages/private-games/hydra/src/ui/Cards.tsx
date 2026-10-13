import { ProtectedImage, cn } from '@vt/ui';
import type { CSSProperties, ReactNode } from 'react';
import type { Ballot, Policy, Role, Team } from '../logic/types.ts';
import type { Content } from './assets.ts';

/** Colour plus a shape for every card, so nothing relies on colour alone. */
export const TEAM_ICON: Record<Team, string> = { blue: '🕊️', red: '☠️' };

const TEAM_BG: Record<Team, string> = {
  blue: 'bg-sky-600 ring-sky-800',
  red: 'bg-red-600 ring-red-800',
};
export const TEAM_TEXT: Record<Team, string> = {
  blue: 'text-sky-700 dark:text-sky-300',
  red: 'text-red-700 dark:text-red-400',
};
export const TEAM_SOFT: Record<Team, string> = {
  blue: 'bg-sky-50 ring-sky-200 dark:bg-sky-500/10 dark:ring-sky-500/30',
  red: 'bg-red-50 ring-red-200 dark:bg-red-500/10 dark:ring-red-500/30',
};

function Art({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <ProtectedImage
      src={src}
      alt={alt}
      className={cn('hy-art h-full w-full object-contain', className)}
      loading="lazy"
    />
  );
}

/** A policy card face (art, or a drawn card with the team's symbol and word). */
export function PolicyFace({
  policy,
  c,
  className,
}: {
  policy: Policy;
  c: Content;
  className?: string;
}) {
  const src = c.policy(policy);
  const label = c.t(`${c.policyName(policy)} {policy}`);
  return (
    <span
      className={cn('@container relative block aspect-[2/3] select-none', className)}
      role="img"
      aria-label={label}
    >
      {src ? (
        <Art src={src} alt={label} />
      ) : (
        <span
          className={cn(
            'flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-[10%] p-[8%] text-white shadow-md ring-2',
            TEAM_BG[policy],
          )}
        >
          <span className="flex w-full flex-1 flex-col items-center justify-center rounded-[8%] bg-white/95 text-center">
            <span aria-hidden className="text-[34cqw] leading-none">
              {TEAM_ICON[policy]}
            </span>
            <span
              className={cn(
                'mt-1 w-full truncate px-0.5 text-[12cqw] font-black tracking-wide uppercase',
                policy === 'blue' ? 'text-sky-700' : 'text-red-700',
              )}
            >
              {c.policyName(policy)}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

export function PolicyBack({ c, className }: { c: Content; className?: string }) {
  const src = c.policyBack;
  return (
    <span className={cn('relative block aspect-[2/3] select-none', className)} aria-hidden>
      {src ? (
        <Art src={src} alt="" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-[10%] bg-stone-800 text-lg font-black text-stone-200 shadow-md ring-2 ring-stone-950">
          ?
        </span>
      )}
    </span>
  );
}

/** A card that flips between its back and its face. */
export function FlipCard({
  up,
  front,
  back,
  className,
  style,
}: {
  up: boolean;
  front: ReactNode;
  back: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={cn('hy-card3d block', className)} style={style}>
      <span className="hy-flipper block h-full w-full" data-up={up}>
        <span className="invisible block">{back}</span>
        <span className="hy-face">{back}</span>
        <span className="hy-face hy-face-front">{front}</span>
      </span>
    </span>
  );
}

export function BallotFace({
  ballot,
  c,
  className,
}: {
  ballot: Ballot;
  c: Content;
  className?: string;
}) {
  const src = c.ballot(ballot);
  const label = `${c.ballotName(ballot)} ballot`;
  return (
    <span
      className={cn('relative block aspect-[13/9] select-none', className)}
      role="img"
      aria-label={label}
    >
      {src ? (
        // A thin light edge, so a dark ballot still stands out on the dark theme.
        <Art
          src={src}
          alt={label}
          className="rounded-[8%] ring-1 ring-stone-900/25 dark:ring-white/45"
        />
      ) : (
        <span
          className={cn(
            'flex h-full w-full items-center justify-center rounded-[8%] text-lg font-black shadow ring-2',
            ballot === 'yes'
              ? 'bg-white text-stone-900 ring-stone-800'
              : 'bg-stone-800 text-white ring-stone-950',
          )}
        >
          {c.ballotName(ballot)}
        </span>
      )}
    </span>
  );
}

export function BallotBack({ c, className }: { c: Content; className?: string }) {
  const src = c.ballotBack;
  return (
    <span className={cn('relative block aspect-[13/9] select-none', className)} aria-hidden>
      {src ? (
        <Art src={src} alt="" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-[8%] bg-emerald-500 text-xs font-black text-emerald-950 shadow ring-2 ring-emerald-800">
          ✉
        </span>
      )}
    </span>
  );
}

/** A role card (portrait art, or a drawn card). */
export function RoleFace({
  role,
  art,
  seed,
  c,
  className,
}: {
  role: Role;
  art: number;
  /** The game's portrait seed (`GameView.artSeed`). */
  seed?: number;
  c: Content;
  className?: string;
}) {
  const src = c.roleArt(role, art, seed);
  const team: Team = role === 'blue' ? 'blue' : 'red';
  const label = c.roleName(role);
  return (
    <span
      className={cn('@container relative block aspect-[5/7] select-none', className)}
      role="img"
      aria-label={label}
    >
      {src ? (
        <Art src={src} alt={label} />
      ) : (
        <span
          className={cn(
            'flex h-full w-full flex-col items-center justify-center gap-[3cqw] rounded-[7%] p-[6cqw] text-center text-white shadow-lg ring-2',
            role === 'leader'
              ? 'bg-gradient-to-b from-red-700 to-stone-900 ring-amber-400'
              : TEAM_BG[team],
          )}
        >
          <span className="text-[7cqw] font-bold tracking-widest uppercase opacity-80">
            Your secret role
          </span>
          <span aria-hidden className="text-[30cqw] leading-none">
            {role === 'leader' ? '👑' : TEAM_ICON[team]}
          </span>
          <span className="w-full truncate text-[12cqw] leading-tight font-black uppercase">
            {label}
          </span>
        </span>
      )}
    </span>
  );
}

export function RoleBack({ c, className }: { c: Content; className?: string }) {
  const src = c.roleBack;
  return (
    <span className={cn('relative block aspect-[5/7] select-none', className)} aria-hidden>
      {src ? (
        <Art src={src} alt="" />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center rounded-[7%] bg-gradient-to-br from-stone-700 to-stone-950 text-center text-sm font-black tracking-widest text-amber-200 uppercase shadow-lg ring-2 ring-stone-950">
          <span aria-hidden className="text-3xl">
            🐍
          </span>
          Secret role
        </span>
      )}
    </span>
  );
}

export function PartyFace({ team, c, className }: { team: Team; c: Content; className?: string }) {
  const src = c.party(team);
  const label = c.t(`${c.teamName(team)} {party} card`);
  return (
    <span
      className={cn('relative block aspect-[5/7] select-none', className)}
      role="img"
      aria-label={label}
    >
      {src ? (
        <Art src={src} alt={label} />
      ) : (
        <span
          className={cn(
            'flex h-full w-full flex-col items-center justify-center gap-1 rounded-[7%] bg-amber-300 text-center shadow ring-2 ring-amber-600',
          )}
        >
          <span className="text-[0.55rem] font-bold tracking-widest text-stone-800 uppercase">
            {c.t('{Party}')}
          </span>
          <span
            className={cn(
              'flex size-14 items-center justify-center rounded-full text-3xl text-white',
              TEAM_BG[team],
            )}
            aria-hidden
          >
            {TEAM_ICON[team]}
          </span>
          <span
            className={cn(
              'font-black uppercase',
              team === 'blue' ? 'text-sky-800' : 'text-red-800',
            )}
          >
            {c.teamName(team)}
          </span>
        </span>
      )}
    </span>
  );
}

export function PartyBack({ c, className }: { c: Content; className?: string }) {
  const src = c.partyBack;
  return (
    <span className={cn('relative block aspect-[5/7] select-none', className)} aria-hidden>
      {src ? (
        <Art src={src} alt="" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-[7%] bg-stone-800 text-2xl text-amber-300 shadow ring-2 ring-stone-950">
          ?
        </span>
      )}
    </span>
  );
}

/** Small coloured pips for a set of cards (claims, logs): colour plus symbol. */
export function Pips({
  cards,
  c,
  size = 'sm',
}: {
  cards: readonly Policy[];
  c: Content;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className="inline-flex gap-0.5 align-middle"
      role="img"
      aria-label={cards.map((x) => c.policyName(x)).join(', ')}
    >
      {cards.map((x, i) => (
        <span
          key={i}
          className={cn(
            'inline-flex items-center justify-center rounded-[3px] text-white shadow-sm',
            size === 'sm' ? 'h-4 w-3 text-[0.5rem]' : 'h-6 w-4 text-[0.65rem]',
            x === 'blue' ? 'bg-sky-600' : 'bg-red-600',
          )}
        >
          {x === 'blue' ? '✦' : '✕'}
        </span>
      ))}
    </span>
  );
}

/** "n blue of `total`" as red-first pips. */
export const bluesCards = (blues: number, total: number): Policy[] => [
  ...Array.from({ length: total - blues }, () => 'red' as const),
  ...Array.from({ length: blues }, () => 'blue' as const),
];
