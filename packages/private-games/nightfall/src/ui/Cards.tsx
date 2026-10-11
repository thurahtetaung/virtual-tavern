import { Badge, Modal, ProtectedImage, cn } from '@vt/ui';
import { type ReactNode, createContext, useContext, useState } from 'react';
import { ARTIFACTS, type ArtifactId, ROLES, type RoleId } from '../logic/roles.ts';
import type { Deck } from './assets.ts';
import { TEAM_LABEL } from './text.ts';

/** An emblem per role for the placeholders (no art without the manifest). */
const EMBLEM: Record<RoleId, string> = {
  doppelganger: '🎭',
  werewolf: '🐺',
  minion: '🦇',
  mason: '🧱',
  seer: '🔮',
  robber: '🗝️',
  troublemaker: '🃏',
  drunk: '🍺',
  insomniac: '🌙',
  villager: '🧑‍🌾',
  tanner: '🪢',
  hunter: '🏹',
  sentinel: '🛡️',
  'alpha-wolf': '👑',
  'mystic-wolf': '✨',
  'apprentice-seer': '🕯️',
  'paranormal-investigator': '🔎',
  witch: '🧪',
  'village-idiot': '🤪',
  revealer: '👁️',
  curator: '🏺',
  bodyguard: '⚔️',
  'dream-wolf': '💤',
  'aura-seer': '🌈',
  cursed: '🩸',
  prince: '🤴',
  'apprentice-tanner': '🧵',
  beholder: '👀',
  squire: '🐴',
  thing: '👻',
};

const TEAM_TONE: Record<string, string> = {
  village:
    'from-sky-100 to-emerald-100 text-emerald-950 dark:from-sky-950 dark:to-emerald-950 dark:text-emerald-100',
  werewolf:
    'from-rose-100 to-red-200 text-red-950 dark:from-red-950 dark:to-stone-900 dark:text-red-100',
  tanner:
    'from-amber-100 to-orange-200 text-orange-950 dark:from-orange-950 dark:to-stone-900 dark:text-orange-100',
  vampire: 'from-fuchsia-100 to-purple-200 text-purple-950 dark:from-purple-950 dark:to-stone-900',
};

export const emblem = (role: RoleId | 'vampire') => (role === 'vampire' ? '🧛' : EMBLEM[role]);

type Size = 'xs' | 'sm' | 'md' | 'lg';
const SIZE: Record<Size, { box: string; emoji: string; name: string }> = {
  xs: { box: 'w-8 rounded', emoji: 'text-sm', name: 'hidden' },
  sm: { box: 'w-16 rounded-md', emoji: 'text-xl', name: 'text-[0.6rem]' },
  md: { box: 'w-28 rounded-lg', emoji: 'text-4xl', name: 'text-xs' },
  lg: { box: 'w-44 rounded-xl', emoji: 'text-6xl', name: 'text-base' },
};

/** A role's picture: its portrait from private storage, or a styled placeholder. */
export function RoleArt({
  role,
  deck,
  size = 'md',
  className,
}: {
  role: RoleId;
  deck: Deck;
  size?: Size;
  className?: string;
}) {
  const art = deck.art(role);
  const [failed, setFailed] = useState(false);
  const s = SIZE[size];
  const name = deck.name(role);
  return (
    <span
      role="img"
      aria-label={name}
      data-role={role}
      className={cn(
        'relative inline-flex aspect-square shrink-0 flex-col items-center justify-center overflow-hidden bg-gradient-to-b shadow ring-1 ring-black/10',
        TEAM_TONE[ROLES[role].team],
        s.box,
        className,
      )}
    >
      {art && !failed ? (
        <ProtectedImage
          src={art}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <>
          <span aria-hidden className={s.emoji}>
            {EMBLEM[role]}
          </span>
          <span className={cn('mt-0.5 max-w-full truncate px-1 font-serif font-semibold', s.name)}>
            {name}
          </span>
        </>
      )}
    </span>
  );
}

const FACE: Record<Size, string> = {
  xs: 'w-9 rounded',
  sm: 'w-16 rounded-md',
  md: 'w-28 rounded-lg',
  lg: 'w-52 rounded-xl',
};

/**
 * A whole card, 5:7: the printed face from private storage, else the portrait in our own frame,
 * else the placeholder.
 */
export function CardFace({
  role,
  deck,
  size = 'md',
  className,
}: {
  role: RoleId;
  deck: Deck;
  size?: Size;
  className?: string;
}) {
  const card = deck.card(role);
  const portrait = deck.art(role);
  const [failed, setFailed] = useState(false);
  const [portraitFailed, setPortraitFailed] = useState(false);
  const name = deck.name(role);
  const frame = cn(
    'relative inline-flex aspect-[5/7] shrink-0 flex-col items-center justify-center gap-1 overflow-hidden shadow ring-1 ring-black/10',
    FACE[size],
    className,
  );
  if (card && !failed)
    return (
      <span role="img" aria-label={name} data-role={role} className={frame}>
        <ProtectedImage
          src={card}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      </span>
    );
  return (
    <span
      role="img"
      aria-label={name}
      data-role={role}
      className={cn(frame, 'bg-gradient-to-b p-[6%]', TEAM_TONE[ROLES[role].team])}
    >
      <span
        aria-hidden
        className="absolute inset-[4%] rounded-[inherit] border border-current/20"
      />
      {portrait && !portraitFailed ? (
        <ProtectedImage
          src={portrait}
          alt=""
          loading="lazy"
          onError={() => setPortraitFailed(true)}
          className="aspect-square w-[78%] rounded-full object-cover shadow ring-1 ring-black/10"
        />
      ) : (
        <span
          aria-hidden
          className={
            size === 'lg'
              ? 'text-7xl'
              : size === 'md'
                ? 'text-4xl'
                : size === 'sm'
                  ? 'text-2xl'
                  : 'text-base'
          }
        >
          {EMBLEM[role]}
        </span>
      )}
      {(size === 'md' || size === 'lg') && (
        <span
          aria-hidden
          className={cn(
            'max-w-full truncate px-1 text-center font-serif font-bold',
            size === 'lg' ? 'text-lg' : size === 'md' ? 'text-xs' : 'text-[0.55rem]',
          )}
        >
          {name}
        </span>
      )}
    </span>
  );
}

/** The back of a card: face down in front of a player, or in the centre. */
export function CardBack({
  deck,
  size = 'sm',
  className,
  children,
}: {
  deck: Deck;
  size?: Size;
  className?: string;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        'relative inline-flex aspect-[5/7] shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-800 to-stone-950 text-indigo-100 shadow ring-1 ring-black/20',
        FACE[size],
        className,
      )}
    >
      {deck.back && !failed ? (
        <ProtectedImage
          src={deck.back}
          alt=""
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span aria-hidden className="text-xl">
          🌒
        </span>
      )}
      {children}
    </span>
  );
}

/** A small token (shield, artifact, most votes): its art when there is some, else an emblem. */
export function Token({
  src,
  emblem,
  label,
  className,
}: {
  src: string | null;
  emblem: string;
  label: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <ProtectedImage
      src={src}
      alt={label}
      title={label}
      onError={() => setFailed(true)}
      className={cn('inline-block size-6 shrink-0 object-contain align-middle', className)}
    />
  ) : (
    <span role="img" aria-label={label} title={label} className={className}>
      {emblem}
    </span>
  );
}

// ---- Tap any card name to read it ----

const Details = createContext<(role: RoleId) => void>(() => {});

/** Lets every `RoleChip` below open the card's details in one shared sheet. */
export function RoleDetailsProvider({ deck, children }: { deck: Deck; children: ReactNode }) {
  const [open, setOpen] = useState<RoleId | null>(null);
  return (
    <Details.Provider value={setOpen}>
      {children}
      <Modal open={open !== null} onClose={() => setOpen(null)} title={open ? deck.name(open) : ''}>
        {open && <RoleDetails role={open} deck={deck} />}
      </Modal>
    </Details.Provider>
  );
}

export const useRoleDetails = () => useContext(Details);

export function RoleDetails({ role, deck }: { role: RoleId; deck: Deck }) {
  const def = ROLES[role];
  return (
    <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
      <CardFace role={role} deck={deck} size="lg" />
      <div className="space-y-2">
        <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
          <Badge>{deck.setName(def.set)}</Badge>
          <Badge>{TEAM_LABEL[def.team]}</Badge>
          {def.count > 1 && <Badge>×{def.count} in the box</Badge>}
        </div>
        <p>{deck.text(role)}</p>
        <p className="text-sm text-stone-600 dark:text-stone-400">{def.win}</p>
      </div>
    </div>
  );
}

/** A card name you can tap to read the card. Shared by every screen. */
export function RoleChip({
  role,
  deck,
  className,
  muted,
}: {
  role: RoleId | 'vampire';
  deck: Deck;
  className?: string;
  muted?: boolean;
}) {
  const open = useRoleDetails();
  if (role === 'vampire')
    return <span className={cn('font-semibold', className)}>🧛 {deck.name(role)}</span>;
  return (
    <button
      type="button"
      onClick={() => open(role)}
      data-role={role}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 align-middle text-sm font-semibold ring-1 transition hover:brightness-95',
        muted
          ? 'bg-stone-100 text-stone-700 ring-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700'
          : 'bg-amber-50 text-amber-950 ring-amber-300 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/40',
        className,
      )}
    >
      <span aria-hidden>{EMBLEM[role]}</span>
      <span className="truncate">{deck.name(role)}</span>
    </button>
  );
}

/** An artifact's name, tap to read it. */
export function ArtifactChip({ id, deck }: { id: ArtifactId; deck: Deck }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-sm font-semibold text-violet-900 ring-1 ring-violet-300 dark:bg-violet-500/10 dark:text-violet-100 dark:ring-violet-500/40"
      >
        <Token src={deck.artifactArt(id)} emblem="🏺" label="" className="size-5" />
        {deck.artifactName(id)}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={deck.artifactName(id)}>
        <div className="flex items-start gap-3">
          <Token src={deck.artifactArt(id)} emblem="🏺" label="" className="size-20 text-4xl" />
          <p>{deck.artifactText(id)}</p>
        </div>
        {ARTIFACTS[id].becomes && (
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            It replaces the holder’s role, team and powers.
          </p>
        )}
      </Modal>
    </>
  );
}
