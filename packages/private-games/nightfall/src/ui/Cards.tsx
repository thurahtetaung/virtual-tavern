import { Badge, Modal, ProtectedImage, cn } from '@vt/ui';
import { type ReactNode, createContext, useContext, useState } from 'react';
import {
  ARTIFACTS,
  type ArtifactId,
  type MarkId,
  ROLES,
  type RoleId,
  winFor,
} from '../logic/roles.ts';
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
  copycat: '🐱',
  vampire: '🧛',
  'the-master': '🦇',
  'the-count': '🕰️',
  renfield: '🪲',
  diseased: '🤢',
  cupid: '💘',
  instigator: '🗡️',
  priest: '✝️',
  assassin: '🎯',
  'apprentice-assassin': '🔪',
  marksman: '🔭',
  pickpocket: '👛',
  gremlin: '😈',
};

/** An emblem per Mark, for the placeholders. */
export const MARK_EMBLEM: Record<MarkId, string> = {
  clarity: '💧',
  vampire: '🧛',
  fear: '😱',
  bat: '🦇',
  disease: '☣️',
  love: '❤️',
  traitor: '🐍',
  assassin: '🎯',
};

const TEAM_TONE: Record<string, string> = {
  village:
    'from-sky-100 to-emerald-100 text-emerald-950 dark:from-sky-950 dark:to-emerald-950 dark:text-emerald-100',
  werewolf:
    'from-rose-100 to-red-200 text-red-950 dark:from-red-950 dark:to-stone-900 dark:text-red-100',
  tanner:
    'from-amber-100 to-orange-200 text-orange-950 dark:from-orange-950 dark:to-stone-900 dark:text-orange-100',
  vampire:
    'from-fuchsia-100 to-purple-200 text-purple-950 dark:from-purple-950 dark:to-stone-900 dark:text-purple-100',
  assassin:
    'from-stone-200 to-zinc-300 text-zinc-950 dark:from-zinc-800 dark:to-stone-950 dark:text-zinc-100',
  'apprentice-assassin':
    'from-stone-200 to-zinc-300 text-zinc-950 dark:from-zinc-800 dark:to-stone-950 dark:text-zinc-100',
};

export const emblem = (role: RoleId) => EMBLEM[role];

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
/** The cards in this game (and the Curator's artifacts), so a role's win reads for this setup. */
const Setup = createContext<{ roles: readonly RoleId[]; artifacts: readonly ArtifactId[] } | null>(
  null,
);
const MarkSheet = createContext<(mark: MarkId, doppel?: boolean) => void>(() => {});

/** Lets every `RoleChip` and `MarkChip` below open its details in one shared sheet. */
export function RoleDetailsProvider({
  deck,
  roles,
  artifacts,
  children,
}: {
  deck: Deck;
  roles?: readonly RoleId[];
  artifacts?: readonly ArtifactId[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState<RoleId | null>(null);
  const [mark, setMark] = useState<{ mark: MarkId; doppel: boolean } | null>(null);
  const setup = roles ? { roles, artifacts: artifacts ?? [] } : null;
  return (
    <Setup.Provider value={setup}>
      <Details.Provider value={setOpen}>
        <MarkSheet.Provider value={(m, doppel) => setMark({ mark: m, doppel: doppel === true })}>
          {children}
        </MarkSheet.Provider>
        <Modal
          open={open !== null}
          onClose={() => setOpen(null)}
          title={open ? deck.name(open) : ''}
        >
          {open && <RoleDetails role={open} deck={deck} />}
        </Modal>
        <Modal
          open={mark !== null}
          onClose={() => setMark(null)}
          title={mark ? deck.markName(mark.mark) : ''}
        >
          {mark && <MarkDetails mark={mark.mark} deck={deck} doppel={mark.doppel} />}
        </Modal>
      </Details.Provider>
    </Setup.Provider>
  );
}

export const useRoleDetails = () => useContext(Details);

export function RoleDetails({ role, deck }: { role: RoleId; deck: Deck }) {
  const def = ROLES[role];
  const setup = useContext(Setup);
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
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {setup ? winFor(role, setup.roles, setup.artifacts) : def.win}
        </p>
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
  light,
}: {
  role: RoleId;
  deck: Deck;
  className?: string;
  muted?: boolean;
  /** On a light strip in the always-dark night: keep the light colours. */
  light?: boolean;
}) {
  const open = useRoleDetails();
  return (
    <button
      type="button"
      onClick={() => open(role)}
      data-role={role}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 align-middle text-sm font-semibold ring-1 transition hover:brightness-95',
        light
          ? 'bg-white text-stone-950 ring-stone-500'
          : muted
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

// ---- Marks ----

/** A Mark's round token: its art from private storage, or a styled placeholder. */
export function MarkToken({
  mark,
  deck,
  size = 'md',
  doppel,
  className,
}: {
  mark: MarkId;
  deck: Deck;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  doppel?: boolean;
  className?: string;
}) {
  const art = deck.markArt(mark);
  const [failed, setFailed] = useState(false);
  const box = { xs: 'size-5', sm: 'size-8', md: 'size-16', lg: 'size-36' }[size];
  return (
    <span
      role="img"
      aria-label={deck.markName(mark)}
      data-mark={mark}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full align-middle',
        box,
        (!art || failed) &&
          'bg-gradient-to-b from-rose-100 to-stone-300 shadow ring-1 ring-black/10 dark:from-rose-950 dark:to-stone-800',
        className,
      )}
    >
      {art && !failed ? (
        <ProtectedImage
          src={art}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-contain"
        />
      ) : (
        <span
          aria-hidden
          className={{ xs: 'text-[0.6rem]', sm: 'text-sm', md: 'text-3xl', lg: 'text-7xl' }[size]}
        >
          {MARK_EMBLEM[mark]}
        </span>
      )}
      {doppel && size !== 'xs' && (
        <span
          aria-hidden
          title="The Doppelgänger’s"
          className="absolute -right-1 -bottom-1 rounded-full bg-stone-900 px-1 text-[0.6rem] text-white"
        >
          🎭
        </span>
      )}
    </span>
  );
}

/** What a Mark does: its token, name and text. */
export function MarkDetails({
  mark,
  deck,
  doppel,
}: {
  mark: MarkId;
  deck: Deck;
  doppel?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
      <MarkToken mark={mark} deck={deck} size="lg" doppel={doppel} />
      <div className="space-y-2">
        <p>{deck.markText(mark)}</p>
        {doppel && (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            One of the Doppelgänger’s own Marks: it works the same.
          </p>
        )}
      </div>
    </div>
  );
}

/** A Mark's name you can tap to read it. */
export function MarkChip({
  mark,
  deck,
  doppel,
  className,
  light,
}: {
  mark: MarkId;
  deck: Deck;
  doppel?: boolean;
  className?: string;
  /** On a light strip in the always-dark night: keep the light colours. */
  light?: boolean;
}) {
  const open = useContext(MarkSheet);
  return (
    <button
      type="button"
      onClick={() => open(mark, doppel)}
      data-mark={mark}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 align-middle text-sm font-semibold ring-1',
        light
          ? 'bg-white text-rose-950 ring-rose-500'
          : 'bg-rose-50 text-rose-950 ring-rose-300 dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/40',
        className,
      )}
    >
      <MarkToken mark={mark} deck={deck} size="xs" />
      <span className="truncate">{deck.markName(mark)}</span>
    </button>
  );
}
