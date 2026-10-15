import { type ActOptions, type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import {
  Badge,
  Button,
  Countdown,
  Hint,
  Panel,
  Peek,
  Superlatives,
  cn,
  useSecondsLeft,
} from '@vt/ui';
import { type ReactNode, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { explainResult } from '../logic/explain.ts';
import { REPEAT, STEPS, buildNightPlan, stepDef } from '../logic/plan.ts';
import { recommended } from '../logic/presets.ts';
import {
  ARTIFACTS,
  type ArtifactId,
  type MarkId,
  ROLES,
  type RoleId,
  defaultArtifacts,
  marksInPlay,
  sidesIn,
  winFor,
} from '../logic/roles.ts';
import { numbersInPlay } from '../logic/tables.ts';
import {
  type Choice,
  type Note,
  type NightfallAction,
  type NightfallView,
  type NoteBody,
  type Prompt,
  type PublicNote,
  type TimelineEntry,
  VOTE_APP,
} from '../logic/types.ts';
import {
  type Numbered,
  alienRolesIn,
  announcementText,
  announcementTitle,
  nostraTeamWords,
  rippleText,
  toldText,
} from './alienText.ts';
import type { Deck } from './assets.ts';
import { type Shown, speaksTo } from './audio.ts';
import {
  ArtifactChip,
  CardBack,
  CardFace,
  MarkChip,
  MarkToken,
  PlayerNumber,
  RoleArt,
  RoleChip,
  Token,
  emblem,
  useRoleDetails,
} from './Cards.tsx';
import { standingOf } from './standing.ts';
import {
  type Status,
  nudgeFor,
  protectPossible,
  startBlocker,
  votePower,
  votePowerText,
} from './status.ts';
import {
  TEAM_LABEL,
  centreKinds,
  centreName,
  describeEntry,
  describeNote,
  foretoldBadge,
  foretoldInCentre,
  markHistory,
  marksIn,
  nameOfView,
  partText,
  promptText,
  teamLines,
  teamOutcome,
} from './text.ts';
import type { DeviceSound } from './useSound.ts';

type Act = (a: NightfallAction, options?: ActOptions) => Promise<boolean>;

// ---- Shared bits ----

/** The roles a note names, so they can be tapped. */
const rolesIn = (n: NoteBody | TimelineEntry['note']): RoleId[] => {
  if (n.kind === 'nobody') return [];
  if (n.kind === 'announced')
    return n.announcement.kind === 'ripple' && n.announcement.ripple.key === 'repeat-role'
      ? [n.announcement.ripple.role]
      : [];
  return [...('role' in n && n.role ? [n.role] : []), ...alienRolesIn(n)];
};

/** Player numbers, named: the narrator's "player 3" with the player's name. */
export const numberedOf = (view: NightfallView): Numbered => ({
  name: (n) =>
    view.table?.[n - 1]?.name ?? view.seats.filter((s) => s.playing)[n - 1]?.name ?? null,
});

/** A player's number token, when the game numbers its players. */
function Num({ view, id, deck }: { view: NightfallView; id: string; deck: Deck }) {
  if (!numbersInPlay(view.settings.roles)) return null;
  const n = (view.table?.findIndex((p) => p.id === id) ?? -1) + 1;
  return n > 0 ? <PlayerNumber n={n} deck={deck} className="size-5" /> : null;
}

/**
 * What the narrator said out loud for everyone (the Alien set: the Oracle's answers that are
 * public, Nostradamus's team, the Blob, the ripple). The same for every viewer.
 */
function Announcements({
  list,
  view,
  deck,
  title,
  light,
}: {
  list: readonly PublicNote[];
  view: NightfallView;
  deck: Deck;
  title?: string;
  light?: boolean;
}) {
  if (!list.length) return null;
  const at = numberedOf(view);
  return (
    <section
      aria-label={title ?? 'Said out loud'}
      className="space-y-1"
      data-testid="announcements"
    >
      {title && <p className="text-sm font-semibold">{title}</p>}
      <ul className="space-y-1">
        {list.map((a, i) => (
          <li
            key={`${a.step}:${i}`}
            data-testid="announcement"
            data-kind={a.kind}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm',
              light
                ? 'bg-emerald-950/80 text-emerald-50 ring-1 ring-success/40 dark:ring-emerald-400/40'
                : 'bg-success-soft text-emerald-950 ring-1 ring-success-line dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/30',
            )}
          >
            <span className="font-semibold">📣 {announcementTitle(a, deck)}: </span>
            <WithChips
              text={announcementText(a, at, deck)}
              roles={rolesIn({ kind: 'announced', announcement: a })}
              deck={deck}
              light={light}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Text with each named role (and Mark) turned into a tappable chip (first mention of each, in
 * the order they appear).
 */
function WithChips({
  text,
  roles,
  marks = [],
  deck,
  light,
}: {
  text: string;
  roles: RoleId[];
  marks?: MarkId[];
  deck: Deck;
  /** On a light strip in the always-dark night. */
  light?: boolean;
}) {
  const names = [
    ...[...new Set(roles)].map((role) => ({ name: deck.name(role), role, mark: null })),
    ...[...new Set(marks)].map((mark) => ({ name: deck.markName(mark), role: null, mark })),
  ];
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  for (;;) {
    const next = names
      .map((n) => ({ ...n, at: rest.indexOf(n.name) }))
      .filter((n) => n.at >= 0)
      .sort((a, b) => a.at - b.at || b.name.length - a.name.length)[0];
    if (!next) break;
    names.splice(
      names.findIndex((n) => n.name === next.name),
      1,
    );
    parts.push(
      rest.slice(0, next.at),
      next.role ? (
        <RoleChip key={key++} role={next.role} deck={deck} className="text-xs" light={light} />
      ) : (
        <MarkChip key={key++} mark={next.mark} deck={deck} className="text-xs" light={light} />
      ),
    );
    rest = rest.slice(next.at + next.name.length);
  }
  parts.push(rest);
  return <>{parts}</>;
}

/** The Mark you last saw (at dusk, or the Pickpocket's new one), or null. */
export function lastSeenMark(notes: readonly Note[]): { mark: MarkId; doppel: boolean } | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]!;
    if (n.kind === 'mark') return { mark: n.mark, doppel: n.doppel === true };
    if (n.kind === 'pickpocketed') return { mark: n.mark, doppel: false };
  }
  return null;
}

/** "Your Mark": the one you saw, tappable to read; it may have moved since. */
function MyMark({ view, deck }: { view: NightfallView; deck: Deck }) {
  const seen = lastSeenMark(view.notes);
  if (!view.myRole || !seen) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-sm" data-testid="my-mark">
      Your Mark <MarkChip mark={seen.mark} deck={deck} doppel={seen.doppel} />
    </span>
  );
}

export function SoundControls({
  view,
  room,
  device,
  setDevice,
  hasMusic,
}: {
  view: NightfallView;
  room: GameRoomInfo;
  device: DeviceSound;
  setDevice: (d: Partial<DeviceSound>) => void;
  hasMusic: boolean;
}) {
  const mode = view.settings.narration;
  const speaks = mode === 'all' || (mode === 'host' && room.isHost);
  if (!speaks || !view.settings.music || !hasMusic) return null;
  return (
    <div className="flex items-center gap-2 text-sm" data-testid="sound-controls">
      <button
        type="button"
        aria-pressed={device.music}
        onClick={() => setDevice({ music: !device.music })}
        className="rounded-lg px-2 py-1 font-semibold ring-1 ring-stone-300 dark:ring-stone-700"
      >
        {device.music ? '🎵 Music on' : '🔇 Music off'}
      </button>
      <label className="flex items-center gap-1">
        <span className="sr-only">Music volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(device.volume * 100)}
          disabled={!device.music}
          onChange={(e) => setDevice({ volume: Number(e.target.value) / 100 })}
          className="w-24"
        />
      </label>
    </div>
  );
}

/**
 * The narration in progress, as text (always shown, whatever the sound setting), for as long as
 * the narrator is saying it (`useSound`). Players woken in the step it belongs to read the
 * narrator's words; everyone else, and everyone once that step is over, reads who is awake.
 */
function Narration({
  said,
  view,
  deck,
  awake,
  step,
  told = false,
  readyEarly = false,
}: {
  said: Shown | null;
  view: NightfallView;
  deck: Deck;
  awake: boolean;
  /** The night's current step (none in the day). */
  step?: number;
  /** The step's instruction already shows in your own "The narrator says" box. */
  told?: boolean;
  readyEarly?: boolean;
}) {
  const at = numberedOf(view);
  const yours = said !== null && speaksTo(said, awake, step);
  const text =
    said?.parts
      .map((part) =>
        partText(part, deck, {
          awake: yours,
          at,
          told: told && yours,
          readyEarly,
          roles: view.settings.roles,
        }),
      )
      .filter(Boolean)
      .join(' ') ?? '';
  return (
    <p
      aria-live="polite"
      data-testid="narration"
      className={cn(
        'min-h-12 rounded-xl bg-indigo-950/90 px-3 py-2 text-center font-serif text-indigo-100 italic',
        !text && 'opacity-0',
      )}
    >
      {text || '…'}
    </p>
  );
}

/** Roles in play, in the order they wake, with how each wins. */
export function RolesInPlay({ view, deck }: { view: NightfallView; deck: Deck }) {
  const unique = [...new Set(view.settings.roles)];
  const own = STEPS.filter((s) => !['dusk', 'lovers', 'ripple', 'aliens'].includes(s.id));
  const order = (r: RoleId) => {
    const step = own.find((s) => s.role === r && !s.doppel) ?? own.find((s) => s.role === r);
    const group = ROLES[r].wakesWithVampires
      ? -600
      : ROLES[r].wakesWithAliens || r === 'cow'
        ? 100
        : ROLES[r].wakesWithWerewolves
          ? 200
          : Infinity;
    return Math.min(
      step && buildNightPlan(view.settings.roles).includes(step.id) ? step.order : Infinity,
      group,
    );
  };
  const sorted = unique.sort((a, b) => order(a) - order(b));
  const roles = view.settings.roles;
  const copies = (r: RoleId) => roles.filter((x) => x === r).length;
  const rewakes = buildNightPlan(roles).flatMap((id) => {
    const def = stepDef(id);
    return def.doppel ? [def.role] : [];
  });
  const marks = marksInPlay(roles);
  const artifacts = roles.includes('curator')
    ? view.settings.artifacts.filter((a) => defaultArtifacts(roles).includes(a))
    : [];
  return (
    <div className="space-y-3">
      <ul className="space-y-2" aria-label="Roles in play">
        {sorted.map((r) => (
          <li key={r} className="flex gap-2">
            <span className="flex shrink-0 items-center gap-1">
              <RoleChip role={r} deck={deck} />
              {copies(r) > 1 && (
                <span className="text-xs font-semibold" data-testid="copies">
                  ×{copies(r)}
                </span>
              )}
            </span>
            <span className="text-sm text-stone-600 dark:text-stone-400">
              {order(r) === Infinity ? 'Doesn’t wake. ' : ''}
              {winFor(r, roles, view.settings.artifacts)}
            </span>
          </li>
        ))}
      </ul>
      {rewakes.length > 0 && (
        <p className="text-sm" data-testid="doppel-rewakes">
          The <RoleChip role="doppelganger" deck={deck} /> wakes again later if she copied:{' '}
          {rewakes.map((r) => (
            <RoleChip key={r} role={r} deck={deck} className="mr-1" />
          ))}
        </p>
      )}
      {marks.length > 0 && (
        <p className="text-sm" data-testid="marks-in-play">
          Marks that can turn up:{' '}
          {marks.map((m) => (
            <MarkChip key={m} mark={m} deck={deck} className="mr-1" />
          ))}
        </p>
      )}
      {artifacts.length > 0 && (
        <p className="text-sm" data-testid="artifacts-in-play">
          Artifacts the {deck.name('curator')} may place:{' '}
          {artifacts.map((a) => (
            <span key={a} className="mr-1 inline-block">
              <ArtifactChip id={a} deck={deck} />
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** "Where you stand now": the recap at the top of Learned. */
function WhereYouStand({ view, deck }: { view: NightfallView; deck: Deck }) {
  const st = standingOf(view, deck);
  if (!st) return null;
  return (
    <section
      aria-label="Where you stand now"
      data-testid="standing"
      className="space-y-1 rounded-lg bg-accent-soft px-3 py-2 text-sm ring-1 ring-accent-line dark:bg-amber-500/10 dark:ring-amber-500/30"
    >
      <p className="font-semibold">Where you stand now</p>
      <p className="flex flex-wrap items-center gap-1">
        Started as <RoleChip role={st.started} deck={deck} />
        <span aria-hidden>→</span>
        {st.now ? (
          <>
            now <RoleChip role={st.now} deck={deck} />
          </>
        ) : (
          <span>now unknown</span>
        )}
        {st.mark && (
          <>
            · Mark <MarkChip mark={st.mark.mark} deck={deck} doppel={st.mark.doppel} />
          </>
        )}
      </p>
      {st.meaning.map((line) => (
        <p key={line} className="text-stone-700 dark:text-stone-300">
          {line}
        </p>
      ))}
    </section>
  );
}

/** What you learned tonight. */
function Learned({ view, deck, me }: { view: NightfallView; deck: Deck; me: string }) {
  const nameOf = nameOfView(view);
  const kinds = view.day?.centerKinds ?? centreKinds(view.settings.roles);
  const at = numberedOf(view);
  const said = (
    <Announcements
      list={view.announcements}
      view={view}
      deck={deck}
      title="Said out loud tonight"
    />
  );
  if (!view.notes.length)
    return (
      <div className="space-y-2">
        <WhereYouStand view={view} deck={deck} />
        <p className="text-sm text-ink-muted italic">You didn’t learn anything tonight.</p>
        {said}
      </div>
    );
  return (
    <div className="space-y-2">
      <WhereYouStand view={view} deck={deck} />
      <ol className="space-y-1.5" aria-label="What you learned tonight">
        {view.notes.map((n) => (
          <li key={n.id} className="rounded-lg bg-stone-100 px-3 py-1.5 text-sm dark:bg-stone-800">
            {n.step >= 0 && view.night === null && (
              <span className="mr-1 text-xs text-ink-muted">{n.step + 1}.</span>
            )}
            <WithChips
              text={describeNote(n, nameOf, deck, kinds, me, at)}
              roles={rolesIn(n)}
              marks={marksIn(n)}
              deck={deck}
            />
            {n.auto && <span className="text-xs text-ink-muted"> (time ran out)</span>}
          </li>
        ))}
      </ol>
      {said}
    </div>
  );
}

/**
 * Your starting card, Mark and artifact: covered until you hold or Show, like the card at the deal,
 * so a phone left face up on the table says nothing about you.
 */
function MySecrets({ children }: { children: ReactNode }) {
  return (
    <div data-testid="my-secrets" className="w-full">
      <Peek
        what="your card"
        cover={
          <span className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stone-800 px-3 py-2 text-sm font-semibold text-stone-100 ring-1 ring-stone-700">
            <span aria-hidden>🂠</span> Hold to see your card
          </span>
        }
      >
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">{children}</div>
      </Peek>
    </div>
  );
}

function MyCardChip({ view, deck }: { view: NightfallView; deck: Deck }) {
  if (!view.myRole) return null;
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      You started as <RoleChip role={view.myRole} deck={deck} />
    </span>
  );
}

// ---- Getting ready ----

export function Ready({
  view,
  room,
  act,
  status,
  deck,
}: {
  view: NightfallView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  deck: Deck;
}) {
  // Ready unlocks once you've looked at this deal's card (a re-deal asks again).
  const deal = `${view.gamesPlayed}:${view.myRole}`;
  const [seenDeal, setSeenDeal] = useState<string | null>(null);
  const seen = seenDeal === deal;
  const role = view.myRole;
  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      {role && (
        <Panel className="flex flex-col items-center gap-3">
          <Peek
            key={deal}
            what="your card"
            onReveal={() => setSeenDeal(deal)}
            cover={
              <span className="flex flex-col items-center gap-2 font-semibold">
                <CardBack deck={deck} size="lg" />
                Hold to see your card
              </span>
            }
          >
            <div className="flex flex-col items-center gap-3">
              <CardFace role={role} deck={deck} size="lg" />
              <p className="text-lg">
                You are the <RoleChip role={role} deck={deck} />
              </p>
              <p className="text-sm text-stone-600 dark:text-stone-400">{deck.text(role)}</p>
            </div>
          </Peek>
          {!view.meReady ? (
            <>
              <Button size="lg" disabled={!seen} onClick={() => void act({ type: 'ready' })}>
                Ready
              </Button>
              {!seen && <p className="text-xs text-ink-muted">Look at your card first.</p>}
            </>
          ) : (
            <p className="text-sm">
              Ready · {view.readyCount} of {view.table?.filter((p) => !p.left).length}
            </p>
          )}
        </Panel>
      )}
      {room.isHost && (
        <div className="space-y-1">
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void act({ type: 'start-night' })}>
              Start the night now
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void act({ type: 'start' })}>
              Shuffle and deal again
            </Button>
          </div>
          <p className="text-xs text-ink-muted">
            Start the night now if someone can’t press Ready (they dropped out, say): their card
            still plays.
          </p>
        </div>
      )}
    </div>
  );
}

// ---- Night ----

/** What each choice button says (numbers say themselves). */
const CHOICE_LABEL: Partial<Record<Choice, string>> = {
  marks: 'Swap two Marks',
  cards: 'Swap two cards',
  yes: 'Yes',
  no: 'No',
  even: 'Even',
  odd: 'Odd',
};

function PromptPanel({
  view,
  prompt,
  act,
  deck,
}: {
  view: NightfallView;
  prompt: Prompt;
  act: Act;
  deck: Deck;
}) {
  const [players, setPlayers] = useState<string[]>([]);
  const [centre, setCentre] = useState<number[]>([]);
  const step = view.night!.index;
  const nameOf = nameOfView(view);
  const me = view.me?.id;
  // The vampires choose together: each tap shows the others who you have in mind.
  const pointing = prompt.stage === 'give-vampire';
  const team = view.night!.acting?.team ?? [];
  const togglePlayer = (id: string) => {
    if (!prompt.players?.ids.includes(id)) return;
    setCentre(prompt.either ? [] : centre);
    const next = players.includes(id)
      ? players.filter((x) => x !== id)
      : prompt.players.max === 1
        ? [id]
        : [...players, id].slice(-prompt.players.max);
    setPlayers(next);
    if (pointing) void act({ type: 'night', step, point: true, players: next });
  };
  const toggleCentre = (i: number) => {
    if (!prompt.center?.slots.includes(i)) return;
    setPlayers(prompt.either ? [] : players);
    setCentre((cur) =>
      cur.includes(i)
        ? cur.filter((x) => x !== i)
        : prompt.center!.max === 1
          ? [i]
          : [...cur, i].slice(-prompt.center!.max),
    );
  };
  const ready =
    (players.length > 0 &&
      prompt.players !== null &&
      players.length >= prompt.players.min &&
      players.length <= prompt.players.max) ||
    (centre.length > 0 &&
      prompt.center !== null &&
      centre.length >= prompt.center.min &&
      centre.length <= prompt.center.max);
  const send = (extra: Partial<NightfallAction>) =>
    void act({ type: 'night', step, ...extra } as NightfallAction);
  const kinds = centreKinds(view.settings.roles);
  const centreCount = Math.max(3, ...(prompt.center?.slots.map((i) => i + 1) ?? [0]));
  const seat = view.table!.findIndex((p) => p.id === me);
  const n = view.table!.length;
  const leftName = nameOf(view.table![(seat + 1) % n]!.id);
  const rightName = nameOf(view.table![(seat - 1 + n) % n]!.id);
  return (
    <div className="space-y-3" data-testid="prompt" data-stage={prompt.stage}>
      <p className="font-semibold">{promptText(prompt, deck)}</p>
      {prompt.players && (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" aria-label="Players">
          {view.table!.map((p) => {
            const legal = prompt.players!.ids.includes(p.id);
            const picked = players.includes(p.id);
            const by = team.filter((t) => t.pick === p.id).map((t) => nameOf(t.player));
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={!legal}
                  aria-pressed={picked}
                  onClick={() => togglePlayer(p.id)}
                  className={cn(
                    'flex h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold ring-1 transition',
                    picked
                      ? 'bg-accent-line dark:bg-amber-400 text-stone-950 ring-accent dark:ring-amber-500'
                      : 'bg-indigo-900/60 text-indigo-50 ring-special/40 dark:ring-indigo-400/40 hover:bg-indigo-800',
                    !legal && 'opacity-35',
                  )}
                >
                  {/* The Marksman looks at a Mark here, not a card; the Empath's players point. */}
                  <span aria-hidden>
                    {prompt.stage === 'view-mark' ? '🔘' : prompt.stage === 'point' ? '👉' : '🂠'}
                  </span>
                  <Num view={view} id={p.id} deck={deck} />
                  <span className="truncate">{p.id === me ? 'You' : p.name}</span>
                  {by.length > 0 && (
                    <span className="ml-auto truncate text-xs font-normal" data-testid="team-pick">
                      ← {by.join(', ')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {prompt.center && (
        <ul className="flex flex-wrap justify-center gap-2" aria-label="Centre cards">
          {Array.from({ length: centreCount }, (_, i) => {
            const legal = prompt.center!.slots.includes(i);
            const picked = centre.includes(i);
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!legal}
                  aria-pressed={picked}
                  aria-label={centreName(i, kinds)}
                  onClick={() => toggleCentre(i)}
                  className={cn(
                    'flex flex-col items-center gap-0.5 rounded-lg ring-offset-2 ring-offset-indigo-950 transition',
                    picked && 'ring-4 ring-accent dark:ring-amber-400',
                    !legal && 'opacity-35',
                  )}
                >
                  <CardBack deck={deck} size="sm">
                    <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs font-bold text-white">
                      {kinds[i] === 'wolf' ? '🐺' : i + 1}
                    </span>
                  </CardBack>
                  <span className="text-xs text-indigo-100">
                    {kinds[i] === 'wolf' ? 'Centre werewolf' : `Centre ${i + 1}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {prompt.choices ? (
          prompt.choices.map((c: Choice) => (
            <Button key={c} onClick={() => send({ choice: c })} data-choice={c}>
              {CHOICE_LABEL[c] ?? c}
            </Button>
          ))
        ) : prompt.sides ? (
          // Named, since left and right follow the app's seat order, not the room.
          prompt.stage === 'move-all' ? (
            <>
              <Button onClick={() => send({ side: 'left' })}>Pass left, towards {leftName}</Button>
              <Button onClick={() => send({ side: 'right' })}>
                Pass right, towards {rightName}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => send({ side: 'left' })}>
                {prompt.stage === 'tap' ? 'Tap' : 'Give it to'} {leftName} (left)
              </Button>
              <Button onClick={() => send({ side: 'right' })}>
                {prompt.stage === 'tap' ? 'Tap' : 'Give it to'} {rightName} (right)
              </Button>
            </>
          )
        ) : (
          <Button
            disabled={!ready}
            onClick={() => send(players.length ? { players } : { center: centre })}
          >
            Confirm
          </Button>
        )}
        {!prompt.mandatory && (
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-xl px-4 font-semibold text-indigo-50 ring-1 ring-special-line/60 dark:ring-indigo-300/60 transition hover:bg-indigo-800 focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-amber-400 focus-visible:outline-none"
            onClick={() => send({ pass: true })}
          >
            {prompt.stage === 'point' ? 'Point at nobody' : 'Skip'}
          </button>
        )}
      </div>
      {pointing && team.length > 0 && (
        <p className="text-xs text-indigo-100" data-testid="team-picks">
          {team
            .map((t) =>
              t.pick
                ? `${nameOf(t.player)} has ${t.pick === me ? 'you' : nameOf(t.pick)} in mind`
                : `${nameOf(t.player)} hasn’t chosen yet`,
            )
            .join(' · ')}
        </p>
      )}
      {prompt.mandatory && (
        <p className="text-xs text-indigo-200/80">
          You must choose: if time runs out, a choice is made for you.
        </p>
      )}
      {prompt.stage === 'move-all' && (
        <p className="text-xs text-indigo-200/80">
          Every card but yours moves one seat that way: “left” passes each card on towards{' '}
          {leftName}, “right” towards {rightName}.
        </p>
      )}
    </div>
  );
}

/**
 * The night's step clock: calm and dark, with no red pulse, so it neither glows in a dark room nor
 * reads as an alarm (every step is short and ends by itself). Like the shared countdown, it says
 * what it counts down to and what happens at zero.
 */
function NightClock({
  deadline,
  clockOffset,
  label,
  atZero,
}: {
  deadline: number | null;
  clockOffset: number;
  label: string;
  atZero: string;
}) {
  const left = useSecondsLeft(deadline, clockOffset);
  if (left === null) return null;
  return (
    <span
      role="timer"
      aria-label={`${left} seconds left ${label}, ${atZero}`}
      title={atZero}
      // vt-contrast: the night screen is dark in both themes
      className="inline-flex items-baseline gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-stone-400 ring-1 ring-white/10"
    >
      <span className="font-mono text-lg font-bold tabular-nums">
        ⏱ {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
      </span>
      <span aria-hidden className="text-xs">
        {label}
      </span>
    </span>
  );
}

/**
 * While the night is on, the whole page goes dark (header and margins included), whatever the
 * chosen theme, so no light strip glows around the night screen. The theme comes back at daybreak.
 */
function useDarkNight() {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.theme;
    root.dataset.theme = 'dark';
    return () => {
      // Leave it alone if the theme was changed during the night.
      if (root.dataset.theme === 'dark' && before !== undefined) root.dataset.theme = before;
    };
  }, []);
}

export function Night({
  view,
  room,
  act,
  status,
  deck,
  narration,
  sound,
}: {
  view: NightfallView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  deck: Deck;
  narration: Shown | null;
  sound: ReactNode;
}) {
  const night = view.night!;
  const acting = night.acting;
  const nameOf = nameOfView(view);
  const now = view.notes.filter(
    (n) => n.step === night.index && night.index >= 0 && n.kind !== 'told',
  );
  const dusk = acting?.step === 'dusk';
  const lovers = acting?.step === 'lovers';
  const duskMark = now.find((n) => n.kind === 'mark');
  const at = numberedOf(view);
  // Eyes closed: a fist out for the aliens (or the Cow's), or pointing for the Empath.
  const closed = acting?.eyes === 'closed';
  const pointing = closed && acting?.step.endsWith('empath');
  // The Empath herself (eyes open, watching the pointing), as opposed to those pointing.
  const watchingPoints = acting?.told?.kind === 'empath' && !closed;
  // What was said out loud for everyone at this step (or as the last one ended).
  const said = view.announcements.filter((a) => a.step >= night.index - 1 && night.index >= 0);
  const eyesOpen = view.notes.filter((n) => n.kind === 'watched').at(-1);
  useDarkNight();
  return (
    <div
      className={cn(
        acting
          ? // Your turn takes the whole screen, lit up, so nobody sleeps through it.
            'fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-indigo-950 text-indigo-50'
          : '-mx-4 -my-4 min-h-[70dvh] space-y-3 bg-stone-950 px-4 py-4 text-stone-300 sm:mx-0 sm:my-0 sm:rounded-2xl',
      )}
      data-testid={acting ? 'night-acting' : 'night-idle'}
    >
      {acting && (
        <div
          className="flex flex-col items-center gap-2 bg-accent-line dark:bg-amber-300 px-4 pt-6 pb-4 text-center text-stone-950"
          data-testid="your-turn"
        >
          <p className="text-4xl font-black tracking-widest" role="alert">
            YOUR TURN
          </p>
          {dusk || lovers || closed ? (
            <span aria-hidden className="text-5xl">
              {dusk ? '👁️' : lovers ? '💘' : pointing ? '👉' : '✊'}
            </span>
          ) : (
            <RoleArt role={acting.as} deck={deck} size="md" />
          )}
          <p className="text-sm font-semibold">
            {dusk
              ? 'Everyone is awake'
              : lovers
                ? 'The lovers wake'
                : closed
                  ? 'Keep your eyes closed'
                  : 'Open your eyes, quietly'}
          </p>
        </div>
      )}
      <div className={cn('space-y-3', acting && 'mx-auto max-w-xl px-4 py-4')}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            {night.index < 0 ? 'Night falls…' : `Step ${night.index + 1} of ${night.count}`}
          </span>
          <NightClock
            deadline={night.deadline}
            clockOffset={room.clockOffset}
            label={night.index < 0 ? 'until the first call' : 'this step'}
            atZero={
              acting?.prompt?.mandatory
                ? 'then a choice is made for you'
                : night.index + 1 >= night.count
                  ? 'then day breaks'
                  : 'then the next step'
            }
          />
        </div>
        <Narration
          said={narration}
          view={view}
          deck={deck}
          awake={acting !== null}
          step={night.index}
          told={acting?.told !== undefined}
        />
        {acting ? (
          // Its own surface rather than <Panel>: the night is dark in both themes.
          <div className="space-y-3 rounded-2xl bg-indigo-900/70 p-4 text-indigo-50 shadow-sm ring-1 ring-special/50 dark:ring-indigo-500/50">
            {dusk ? (
              <div className="flex flex-col items-center gap-2 text-center" data-testid="dusk">
                <p className="text-lg font-bold">Everyone is awake: look at your Mark</p>
                {duskMark?.kind === 'mark' && (
                  <>
                    <MarkToken
                      mark={duskMark.mark}
                      deck={deck}
                      size="lg"
                      doppel={duskMark.doppel}
                    />
                    <p className="text-sm">
                      Your Mark:{' '}
                      <MarkChip mark={duskMark.mark} deck={deck} doppel={duskMark.doppel} />
                    </p>
                    <p className="text-sm text-indigo-200">{deck.markText(duskMark.mark)}</p>
                  </>
                )}
              </div>
            ) : lovers ? (
              <div className="flex items-center gap-3" data-testid="lovers">
                <MarkToken mark="love" deck={deck} size="md" />
                <div>
                  <p className="text-lg font-bold">You’re in love</p>
                  <p className="text-sm">
                    Look for your love: if one of you dies, so do the others.
                  </p>
                </div>
              </div>
            ) : closed ? (
              <div className="flex items-center gap-3" data-testid="eyes-closed">
                <span aria-hidden className="text-4xl">
                  {pointing ? '👉' : '✊'}
                </span>
                <div>
                  <p className="text-lg font-bold">
                    {pointing ? 'Point, eyes closed' : 'Put out your fist, eyes closed'}
                  </p>
                  <p className="text-sm">
                    {pointing
                      ? 'The narrator named you: point at someone (or nobody).'
                      : acting.as === 'cow' && !acting.told
                        ? `As the ${deck.name('cow')}: if an alien sits right next to you, one of them must tap your fist.`
                        : 'The aliens may tap your fist.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <RoleArt role={acting.as} deck={deck} size="sm" />
                <div>
                  <p className="text-lg font-bold">You’re awake</p>
                  <p className="text-sm">
                    {acting.ripple ? (
                      'The ripple named you'
                    ) : (
                      <>
                        as the <RoleChip role={acting.as} deck={deck} />
                        {acting.step.startsWith('doppelganger-') && ' (your copy)'}
                        {acting.step.startsWith(REPEAT) && ' (again)'}
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}
            {(acting.told || acting.ripple) && (
              <p
                className="rounded-lg bg-indigo-950/80 px-3 py-2 text-sm ring-1 ring-special-line/40 dark:ring-indigo-300/40"
                data-testid="told"
              >
                <span className="font-semibold">The narrator says: </span>
                {acting.ripple
                  ? rippleText(acting.ripple, at, deck)
                  : toldText(acting.told!, at, deck, { empath: watchingPoints })}
              </p>
            )}
            {acting.prompt ? (
              <PromptPanel
                key={`${night.index}:${acting.prompt.stage}`}
                view={view}
                prompt={acting.prompt}
                act={act}
                deck={deck}
              />
            ) : null}
            {now.length > 0 && !dusk && (
              <ul className="space-y-1" data-testid="night-result">
                {now.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-lg bg-accent-line dark:bg-amber-300 px-3 py-2 text-sm font-semibold text-stone-950"
                  >
                    <WithChips
                      text={describeNote(
                        n,
                        nameOf,
                        deck,
                        centreKinds(view.settings.roles),
                        view.me?.id,
                        at,
                      )}
                      roles={rolesIn(n)}
                      marks={marksIn(n)}
                      deck={deck}
                      light
                    />
                  </li>
                ))}
              </ul>
            )}
            {!acting.prompt && (
              <p className="text-sm text-indigo-200">
                {closed
                  ? 'Put your hand away when the narrator says so.'
                  : 'Close your eyes when the narrator says so.'}
              </p>
            )}
            <Announcements list={said} view={view} deck={deck} light />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span aria-hidden className="text-6xl">
              {view.myRole ? '🌕' : '👀'}
            </span>
            <p className="font-serif text-2xl text-stone-100">
              {view.myRole ? 'Night has fallen…' : 'You’re watching the night'}
            </p>
            <p className="text-sm" data-testid="idle-hint">
              {view.myRole
                ? 'Keep your phone face up — it lights up when it’s your turn.'
                : status.text}
            </p>
            {view.myRole && (
              <MySecrets>
                <MyCardChip view={view} deck={deck} />
                <MyMark view={view} deck={deck} />
              </MySecrets>
            )}
            {eyesOpen?.kind === 'watched' && (
              <p
                className="rounded-lg bg-stone-800 px-3 py-2 text-sm text-stone-100"
                data-testid="eyes-open"
              >
                👁️{' '}
                {describeNote(
                  eyesOpen,
                  nameOf,
                  deck,
                  centreKinds(view.settings.roles),
                  view.me?.id,
                  at,
                )}
              </p>
            )}
            <div className="w-full text-left">
              <Announcements list={said} view={view} deck={deck} light />
            </div>
          </div>
        )}
        <div className="flex justify-center">{sound}</div>
      </div>
    </div>
  );
}

// ---- Day and vote ----

type DayTab = 'table' | 'learned' | 'roles';

const WIDE = '(min-width: 1024px)';

/** Whether the screen is `lg` or wider, where the day shows every section at once. */
function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const query = window.matchMedia(WIDE);
      query.addEventListener('change', changed);
      return () => query.removeEventListener('change', changed);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches,
    () => false,
  );
}

/**
 * The day's sections on a phone: a bottom tab bar like the other games'. From `lg` up every
 * section shows at once, so the bar hides.
 */
function DayTabBar({
  tabs,
  tab,
  onChange,
  idOf,
}: {
  tabs: { id: DayTab; icon: string; label: string }[];
  tab: DayTab;
  onChange: (t: DayTab) => void;
  idOf: (t: DayTab) => string;
}) {
  return (
    <div
      role="tablist"
      aria-label="The day"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-950/95"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={idOf(t.id)}
          aria-selected={tab === t.id}
          aria-controls={`${idOf(t.id)}-panel`}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex min-h-11 flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-semibold',
            tab === t.id ? 'text-amber-700 dark:text-amber-400' : 'text-ink-muted',
          )}
        >
          <span aria-hidden className="text-lg leading-none">
            {t.icon}
          </span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** What a ripple's rule means for the players it names, for the table. */
const RULE_BADGE = {
  'i-am-alien': ['👽', 'may only say “I am an alien”'],
  'face-away': ['🙈', 'faces away'],
  'no-speak': ['🤐', 'may not speak'],
} as const;

function TableList({
  view,
  deck,
  pick,
  picked,
  picked2,
  online,
}: {
  view: NightfallView;
  deck: Deck;
  pick?: (id: string) => void;
  picked?: string | null;
  /** Your second vote (a two-hand ripple). */
  picked2?: string | null;
  online: (id: string) => boolean;
}) {
  const me = view.me?.id;
  const day = view.day;
  // The buttons read the same for every role: a Bodyguard's pick is told only behind the peek.
  const rules = day?.rules;
  return (
    <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" aria-label="The table">
      {view.table!.map((p) => {
        const face = day?.faceUp.find((f) => f.player === p.id);
        const can = pick && p.id !== me;
        const body = (
          <>
            <span className="flex items-center gap-1 truncate font-semibold">
              <Num view={view} id={p.id} deck={deck} />
              {p.id === me ? `${p.name} (you)` : p.name}
            </span>
            <span className="flex flex-wrap items-center gap-1 text-xs">
              {face && (
                <span>
                  face up: {emblem(face.role)} {deck.name(face.role)}
                </span>
              )}
              {day?.shields.includes(p.id) && (
                <Token src={deck.token('shield')} emblem="🛡️" label="Shielded" />
              )}
              {day?.artifacts.includes(p.id) && (
                <Token src={null} emblem="🏺" label="Has an artifact" />
              )}
              {rules?.restrictions
                ?.filter((r) => r.players.includes(p.id))
                .map((r) => (
                  <span key={r.kind} data-testid="restriction" title={RULE_BADGE[r.kind][1]}>
                    {RULE_BADGE[r.kind][0]} {RULE_BADGE[r.kind][1]}
                  </span>
                ))}
              {rules?.twoVotes?.includes(p.id) && <span title="Votes twice">✌️ two votes</span>}
              {p.left ? (
                <span>left</span>
              ) : (
                !online(p.id) && <span className="text-ink-muted">offline</span>
              )}
              {view.phase === 'day' && view.waitingOn.includes(p.id) && !p.left && (
                <span className="text-ink-muted">· not ready yet</span>
              )}
            </span>
          </>
        );
        return (
          <li key={p.id}>
            {can ? (
              <button
                type="button"
                aria-pressed={picked === p.id || picked2 === p.id}
                aria-label={`Vote for ${p.name}`}
                onClick={() => pick(p.id)}
                className={cn(
                  'flex min-h-12 w-full flex-col items-start rounded-lg px-3 py-1.5 text-left ring-1 transition',
                  picked === p.id || picked2 === p.id
                    ? 'bg-danger dark:bg-rose-600 text-white ring-danger dark:ring-rose-600'
                    : 'bg-white ring-stone-300 hover:bg-danger-soft dark:bg-stone-900 dark:ring-stone-700 dark:hover:bg-rose-950',
                )}
              >
                {body}
                <span className="text-xs font-semibold">
                  🗳️ Vote
                  {picked === p.id && picked2 === p.id
                    ? ' · both your votes'
                    : picked === p.id
                      ? ' · your pick'
                      : picked2 === p.id
                        ? ' · your second vote'
                        : ''}
                </span>
              </button>
            ) : (
              <div className="flex min-h-12 flex-col rounded-lg bg-stone-100 px-3 py-1.5 dark:bg-stone-800/60">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Nudge({ view, room }: { view: NightfallView; room: GameRoomInfo }) {
  const deadline =
    view.phase === 'vote' ? (view.vote?.deadline ?? null) : (view.day?.deadline ?? null);
  const left = useSecondsLeft(deadline, room.clockOffset);
  const text = nudgeFor(view, left);
  return (
    <p
      aria-live="polite"
      data-testid="nudge"
      className={cn(
        'rounded-lg bg-special-soft px-3 py-1.5 text-center text-sm font-medium text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-200',
        !text && 'hidden',
      )}
    >
      {text}
    </p>
  );
}

export function Day({
  view,
  room,
  act,
  status,
  deck,
  narration,
  sound,
}: {
  view: NightfallView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  deck: Deck;
  narration: Shown | null;
  sound: ReactNode;
}) {
  const [tab, setTab] = useState<DayTab>('table');
  const [hand, setHand] = useState<1 | 2>(1);
  const wide = useWide();
  const voting = view.phase === 'vote';
  const me = view.me?.id ?? '';
  const playing = view.myRole !== null;
  const deadline = voting ? (view.vote?.deadline ?? null) : (view.day?.deadline ?? null);
  const myArtifact = view.notes.find((n) => n.kind === 'artifact');
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const tabs: { id: DayTab; icon: string; label: string }[] = [
    voting
      ? { id: 'table', icon: '🗳️', label: 'Vote' }
      : { id: 'table', icon: '🪑', label: 'Table' },
    { id: 'learned', icon: '📝', label: 'Learned' },
    { id: 'roles', icon: '🃏', label: 'Roles' },
  ];
  const tabsId = useId();
  const idOf = (t: DayTab) => `${tabsId}-${t}`;
  // On a phone only the chosen tab's panel shows; from `lg` up they all do.
  const panel = (t: DayTab) => ({
    role: 'tabpanel',
    id: `${idOf(t)}-panel`,
    'aria-labelledby': idOf(t),
    className: tab === t ? undefined : 'hidden lg:block',
  });
  return (
    <div className="mx-auto max-w-3xl space-y-3 pb-20 lg:grid lg:max-w-6xl lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0 lg:pb-0">
      <div className="space-y-3 lg:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 text-sm font-semibold whitespace-nowrap">
            {voting ? '🗳️ The vote' : '☀️ Day'}
          </span>
          <Countdown
            deadline={deadline}
            clockOffset={room.clockOffset}
            label={voting ? 'to vote' : 'to talk'}
            atZero={
              voting
                ? 'then the votes are counted (no vote counts for nobody)'
                : 'then the vote starts'
            }
          />
        </div>
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        <Narration
          said={narration}
          view={view}
          deck={deck}
          awake
          readyEarly={
            (view.day?.readyCount ?? 0) >= (view.table?.filter((p) => !p.left).length ?? 0)
          }
        />
        <Nudge view={view} room={room} />
      </div>
      <DayTabBar tabs={tabs} tab={tab} onChange={setTab} idOf={idOf} />
      <div {...panel('table')}>
        <Panel className="space-y-3">
          {playing && view.myRole && (
            <MySecrets>
              <MyCardChip view={view} deck={deck} />
              <MyMark view={view} deck={deck} />
              {myArtifact?.kind === 'artifact' && (
                <span className="text-sm">
                  Your card carries <ArtifactChip id={myArtifact.artifact} deck={deck} />
                </span>
              )}
            </MySecrets>
          )}
          {(view.day?.centerUp?.length ?? 0) > 0 && (
            <p className="flex flex-wrap items-center gap-1 text-sm" data-testid="centre-up">
              Face up in the centre:
              {view.day!.centerUp!.map((c) => (
                <span key={c.center} className="inline-flex items-center gap-1">
                  {centreName(c.center, view.day!.centerKinds)}
                  <RoleChip role={c.role} deck={deck} />
                </span>
              ))}
            </p>
          )}
          {voting && playing && view.vote?.hands === 2 && (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="hands">
              <span>✌️ You vote with both hands:</span>
              {([1, 2] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={hand === h}
                  onClick={() => setHand(h)}
                  className={cn(
                    'rounded-lg px-2 py-1 font-semibold ring-1 ring-stone-300 dark:ring-stone-700',
                    hand === h && 'bg-danger dark:bg-rose-600 text-white ring-danger',
                  )}
                >
                  {h === 1 ? 'First hand' : 'Second hand'}
                  {(h === 1 ? view.vote?.myVote : view.vote?.mySecond) ? ' ✓' : ''}
                </button>
              ))}
            </div>
          )}
          {voting && playing && protectPossible(view) && (
            <Peek
              what="what your pick does"
              cover={
                <span className="flex min-h-11 items-center gap-2 rounded-xl bg-stone-800 px-3 py-2 text-sm font-semibold text-stone-100 ring-1 ring-stone-700">
                  <span aria-hidden>🙈</span> Hold to see what your pick does
                </span>
              }
            >
              <p
                className="rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold dark:bg-stone-800"
                data-testid="vote-power"
              >
                {votePowerText(votePower(view))}
              </p>
            </Peek>
          )}
          <TableList
            view={view}
            deck={deck}
            pick={
              voting && playing
                ? (id) => void act({ type: 'vote', target: id, ...(hand === 2 ? { hand } : {}) })
                : undefined
            }
            picked={view.vote?.myVote}
            picked2={view.vote?.mySecond}
            online={online}
          />
          {voting && playing && view.vote?.app && (
            <Button
              variant={
                view.vote.myVote === VOTE_APP || view.vote.mySecond === VOTE_APP
                  ? 'primary'
                  : 'secondary'
              }
              className="w-full"
              data-testid="vote-app"
              onClick={() =>
                void act({ type: 'vote', target: VOTE_APP, ...(hand === 2 ? { hand } : {}) })
              }
            >
              📱 Vote for the app (if it gets the most votes, nobody dies)
              {view.vote.myVote === VOTE_APP ? ' · your pick' : ''}
            </Button>
          )}
          {!voting && playing && (
            <Button
              size="lg"
              className="w-full"
              variant={view.day?.meReady ? 'secondary' : 'primary'}
              onClick={() => void act({ type: 'ready-to-vote', ready: !view.day?.meReady })}
            >
              {view.day?.meReady ? 'Not ready yet' : 'Ready to vote'}
            </Button>
          )}
          {!voting && room.isHost && (
            <div className="space-y-1 text-center">
              <Button variant="ghost" size="sm" onClick={() => void act({ type: 'start-vote' })}>
                Start the vote now
              </Button>
              <p className="text-xs text-ink-muted">
                Opens the vote without waiting for everyone to be ready (someone dropped out, say).
              </p>
            </div>
          )}
        </Panel>
      </div>
      <div className="space-y-3">
        <div {...panel('learned')}>
          {/* What you learned is a secret: on a phone it's only rendered with its tab open; from
              `lg` up it sits beside the table behind a peek, so the default screen stays neutral. */}
          {wide ? (
            <Panel>
              <Peek what="what you learned">
                <Learned view={view} deck={deck} me={me} />
              </Peek>
            </Panel>
          ) : (
            tab === 'learned' && (
              <Panel>
                <Learned view={view} deck={deck} me={me} />
              </Panel>
            )
          )}
        </div>
        <div {...panel('roles')}>
          <Panel>
            {/* On a phone the tab names it; beside the table it needs a heading. */}
            <h3 className="mb-2 hidden text-sm font-semibold lg:block">🃏 Roles in play</h3>
            <RolesInPlay view={view} deck={deck} />
          </Panel>
        </div>
      </div>
      <div className="flex justify-center lg:col-span-2">{sound}</div>
    </div>
  );
}

// ---- The reveal ----

/** What an artifact did to the player whose card it ended on, for the reveal. */
export function artifactEffect(id: ArtifactId, deck: Deck): string {
  const a = ARTIFACTS[id];
  if (a.becomes) return `made them the ${deck.name(a.becomes)}`;
  if (a.traitor) return 'made them a traitor: they win only if a teammate dies';
  return 'no effect on the result';
}

/** The centre cards, face up at the end; tap one to read it. */
function CentreCards({
  reveal,
  deck,
}: {
  reveal: NonNullable<NightfallView['reveal']>;
  deck: Deck;
}) {
  const open = useRoleDetails();
  return (
    <section aria-label="The centre" className="space-y-1">
      <h4 className="text-sm font-semibold">The centre</h4>
      <ul className="flex flex-wrap gap-2">
        {reveal.center.map((c, i) => (
          <li key={i} className="flex flex-col items-center gap-0.5 text-xs">
            <button
              type="button"
              onClick={() => open(c.card.role)}
              aria-label={`Read ${deck.name(c.card.role)}`}
            >
              <CardFace role={c.card.role} deck={deck} size="sm" />
            </button>
            {c.kind === 'wolf' ? 'Wolf slot' : `Centre ${i + 1}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Why a player was on the aliens' side, as a badge. */
const ALIEN_BADGE = {
  card: '👽 Alien card',
  player: '👽 New Alien',
  helper: '👽 alien helper',
  oracle: '👽 joined the aliens',
} as const;

/** "voted Ana", "voted Ana and Ben", "voted the app", "no vote". */
function voteWords(
  first: string | null | undefined,
  second: string | null | undefined,
  nameOf?: (id: string) => string,
): string {
  const n = (id: string) => (id === VOTE_APP ? 'the app' : (nameOf?.(id) ?? id));
  if (!first && !second) return 'no vote';
  return `voted ${[first, second]
    .filter((x): x is string => !!x)
    .map(n)
    .join(' and ')}`;
}

export function Reveal({
  view,
  room,
  act,
  status,
  deck,
}: {
  view: NightfallView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  deck: Deck;
}) {
  const reveal = view.reveal!;
  const { result } = reveal;
  const nameOf = nameOfView(view);
  const explained = explainResult(
    result,
    {
      player: nameOf,
      role: (role) => deck.name(role),
      team: (team) => TEAM_LABEL[team],
      mark: (m) => deck.markName(m),
    },
    reveal.marks,
    sidesIn(view.settings.roles, view.settings.artifacts),
  );
  const history = markHistory(reveal.timeline, reveal.marks);
  // Someone left since the deal: the picked cards may no longer fit the table.
  const blocker = startBlocker(view);
  const seatedNow = view.seats.filter((s) => s.playing).length;
  const kinds = reveal.center.map((c) => c.kind);
  const [tab, setTab] = useState<'cards' | 'night'>('cards');
  // Where a time loop began (the plan grows by a whole night after the ripple).
  const base = buildNightPlan(view.settings.roles).length;
  const loopFrom = reveal.plan.length > base + 1 ? base : -1;
  const steps = reveal.plan.map((id, i) => ({
    id,
    i,
    def: stepDef(id),
    entries: reveal.timeline.filter((t) => t.step === i),
  }));
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Hint>{status.text}</Hint>
      <Panel className="space-y-1" data-testid="teams">
        {teamLines(result).map((t) => (
          <p key={t.team} className="text-sm" data-testid="team-line" data-won={t.won}>
            <span
              className={cn(
                'font-bold',
                t.won
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400',
              )}
            >
              {t.won ? '🏆' : '✗'}{' '}
              {t.sideWon && !t.won
                ? `${TEAM_LABEL[t.team]}: nobody on this side wins`
                : teamOutcome(t.team, t.won)}
            </span>{' '}
            <span className="text-stone-600 dark:text-stone-400">
              ({t.players.map(nameOf).join(', ')})
              {t.exceptions.length > 0 &&
                (t.won
                  ? ` · not ${t.exceptions.map(nameOf).join(', ')}`
                  : ` · ${t.exceptions.map(nameOf).join(', ')} won anyway`)}
              {t.team === 'nostradamus' &&
                t.players
                  .filter((p) => foretoldInCentre(result.identities[p]!))
                  .map(
                    (p) =>
                      ` · ${t.players.length > 1 ? `${nameOf(p)}: ` : ''}on the side of ${nostraTeamWords(result.identities[p]!.foretold!.team, deck)}, whose card ended in the centre, so nobody could win it`,
                  )}
            </span>
          </p>
        ))}
        {result.epic && (
          <p className="text-sm font-semibold" data-testid="epic">
            ⚔️ An epic battle: the most voted player dies (with at least 2 votes), and so does
            everyone tied for second; if several tie for the most votes, only they die.
          </p>
        )}
        {explained.tally.length > 0 && (
          <p className="text-sm" data-testid="tally">
            🗳️ Votes: {explained.tally.map((t) => `${nameOf(t.player)} ${t.votes}`).join(' · ')}
            {(result.appVotes ?? 0) > 0 && ` · the app ${result.appVotes}`}
          </p>
        )}
        <Announcements list={view.announcements} view={view} deck={deck} title="Said out loud" />
        {result.deaths.length === 0 && <p className="text-sm font-semibold">Nobody died.</p>}
        <ul className="space-y-1" data-testid="reasons">
          {explained.reasons.map(({ text, death: d }, i) =>
            d ? (
              <li
                key={i}
                className="flex items-center gap-1 text-sm"
                data-testid="death"
                data-cause={d.cause}
                data-place={d.place ?? ''}
              >
                {d.cause === 'vote' ? (
                  <Token
                    src={deck.token(d.place === 2 ? 'most-votes-2' : 'most-votes-1')}
                    emblem={d.place === 2 ? '🥈' : '☠️'}
                    label={d.place ? `Most votes #${d.place}` : 'Most votes'}
                    className="size-7"
                  />
                ) : d.cause === 'love' ? (
                  <span aria-hidden>💔</span>
                ) : (
                  <span aria-hidden>🏹</span>
                )}
                <span>{text}</span>
              </li>
            ) : (
              <li key={i} className="flex items-center gap-1 text-sm">
                <span aria-hidden>•</span>
                <span>{text}</span>
              </li>
            ),
          )}
        </ul>
        {explained.why.map((line) => (
          <p key={line} className="text-sm font-semibold" data-testid="why">
            {line}
          </p>
        ))}
        {explained.personal.map((line) => (
          <p key={line} className="text-sm" data-testid="personal">
            {line}
          </p>
        ))}
        <Superlatives lines={room.superlatives} className="mt-2" />
      </Panel>
      <div role="tablist" className="flex gap-1 rounded-xl bg-stone-200 p-1 dark:bg-stone-800">
        {(['cards', 'night'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'h-9 flex-1 rounded-lg text-sm font-semibold',
              tab === t && 'bg-white shadow dark:bg-stone-950',
            )}
          >
            {t === 'cards' ? 'Everyone’s cards' : 'The night, step by step'}
          </button>
        ))}
      </div>
      {tab === 'cards' ? (
        <Panel className="space-y-2">
          <p className="text-xs text-stone-600 dark:text-stone-400" data-testid="reveal-legend">
            The picture is the card in front of each player at the end. The chips read{' '}
            <strong>dealt → ended as</strong>: the second one, after swaps, copies and artifacts,
            decides their team.
          </p>
          <ul className="space-y-2" aria-label="Everyone’s cards">
            {view.table!.map((p) => {
              const card = reveal.cards[p.id]!;
              const id = result.identities[p.id]!;
              const pm = reveal.marks?.[p.id];
              const dead = result.deaths.some((d) => d.player === p.id);
              const won = result.winners.includes(p.id);
              return (
                <li
                  key={p.id}
                  data-testid="reveal-player"
                  data-player={p.name}
                  data-final={id.role}
                  data-team={id.team}
                  data-mark={pm?.id ?? ''}
                  data-won={won}
                  className="flex items-start gap-2 rounded-lg bg-stone-100 px-2 py-1.5 text-sm dark:bg-stone-800/60"
                >
                  <CardFace role={card.role} deck={deck} size="sm" className="w-12" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold">
                        {dead && '☠️ '}
                        {p.name}
                        {won && ' 🏆'}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {voteWords(result.votes[p.id], result.votes2?.[p.id], nameOf)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <RoleChip role={reveal.deal.players[p.id]!} deck={deck} muted />
                      <span aria-hidden>→</span>
                      <RoleChip role={id.role} deck={deck} />
                      {pm && !history[p.id] && (
                        <MarkChip mark={pm.id} deck={deck} doppel={pm.doppel} />
                      )}
                      {card.artifact && <ArtifactChip id={card.artifact} deck={deck} />}
                      {card.shield && (
                        <Token src={deck.token('shield')} emblem="🛡️" label="Shielded" />
                      )}
                      {id.converted && (
                        <Badge>
                          turned {TEAM_LABEL[id.team].toLowerCase()} by a{' '}
                          {id.converted === 'werewolf' ? 'werewolf' : 'vampire'}’s vote
                        </Badge>
                      )}
                      {id.team !== ROLES[id.role].team && !id.converted && (
                        <Badge>
                          {id.foretold && id.team === 'nostradamus'
                            ? foretoldBadge(id, deck, nameOf)
                            : TEAM_LABEL[id.team]}
                        </Badge>
                      )}
                      {id.alien && <Badge data-testid="alien-badge">{ALIEN_BADGE[id.alien]}</Badge>}
                      {id.oracle &&
                        id.oracle !== 'alien-card' &&
                        id.oracle !== 'aliens-win-only' && (
                          <Badge>
                            {id.oracle === 'werewolf-card' ? 'a werewolf card' : 'a vampire card'}
                          </Badge>
                        )}
                      {numbersInPlay(view.settings.roles) && (
                        <Num view={view} id={p.id} deck={deck} />
                      )}
                    </div>
                    {history[p.id] && (
                      <p
                        className="flex flex-wrap items-center gap-1 text-xs"
                        data-testid="mark-history"
                      >
                        Marks:
                        {history[p.id]!.map((m, k) => (
                          <span key={k} className="inline-flex items-center gap-1">
                            {k > 0 && <span aria-hidden>→</span>}
                            <MarkChip
                              mark={m}
                              deck={deck}
                              doppel={k === history[p.id]!.length - 1 && pm?.doppel}
                              className="text-xs"
                            />
                          </span>
                        ))}
                      </p>
                    )}
                    {card.role !== id.role && card.role !== reveal.deal.players[p.id] && (
                      <p className="text-xs text-ink-muted">
                        Card at the end: {deck.name(card.role)}
                      </p>
                    )}
                    {card.artifact && (
                      <p className="text-xs text-ink-muted" data-testid="artifact-effect">
                        {deck.artifactName(card.artifact)}: {artifactEffect(card.artifact, deck)}.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <CentreCards reveal={reveal} deck={deck} />
        </Panel>
      ) : (
        <Panel>
          <ol className="space-y-2" aria-label="The night, step by step">
            {steps.map(({ id, i, def, entries }) => (
              <li key={i} className="text-sm" data-testid="timeline-step" data-step={id}>
                {i === loopFrom && (
                  <p className="mt-3 font-bold" data-testid="time-loop">
                    🔁 The time loop: the night again
                  </p>
                )}
                <p className="font-semibold">
                  {i + 1}.{' '}
                  {id === 'dusk' ? (
                    'Dusk: everyone looks at their Mark'
                  ) : id === 'lovers' ? (
                    'The lovers'
                  ) : id === 'ripple' ? (
                    'The ripple'
                  ) : (
                    <>
                      {id === 'werewolves' && 'The werewolves: '}
                      {id === 'vampires' && 'The vampires: '}
                      {id === 'aliens' && 'The aliens: '}
                      {id === 'groob-zerb' && 'Groob and Zerb: '}
                      {def.repeat && 'Again (the ripple): '}
                      <RoleChip role={def.role} deck={deck} />
                      {id === 'groob-zerb' && <RoleChip role="zerb" deck={deck} className="ml-1" />}
                      {def.doppel && ' (the Doppelgänger’s copy)'}
                    </>
                  )}
                </p>
                <ul className="ml-4 list-disc">
                  {entries.map((e, k) => (
                    <li key={k}>
                      <WithChips
                        text={describeEntry(e, nameOf, deck, kinds, numberedOf(view))}
                        roles={[...rolesIn(e.note), ...(e.moved ?? []).map((m) => m.role)]}
                        marks={[
                          ...(e.note.kind === 'nobody' || e.note.kind === 'announced'
                            ? []
                            : marksIn(e.note)),
                          ...(e.marks ?? []).flatMap((m) => (m.mark ? [m.mark] : [])),
                        ]}
                        deck={deck}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      {room.isHost && blocker && seatedNow >= 3 && (
        <p className="text-sm" data-testid="play-again-blocker">
          {blocker} The table changed since the deal.
        </p>
      )}
      {room.isHost && (
        <div className="flex flex-wrap gap-2">
          {blocker && seatedNow >= 3 ? (
            <Button
              size="lg"
              onClick={() =>
                void act({ type: 'update-settings', roles: recommended(seatedNow) }).then(
                  (ok) => ok && act({ type: 'play-again' }),
                )
              }
            >
              Play again with the recommended cards for {seatedNow}
            </Button>
          ) : (
            <Button size="lg" onClick={() => void act({ type: 'play-again' })}>
              Play again
            </Button>
          )}
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change setup
          </Button>
        </div>
      )}
      {!room.isHost && (
        <p className="text-center text-sm text-ink-muted" data-testid="waiting-host">
          {waitingForHost(room, 'play again or change the setup')}
        </p>
      )}
    </div>
  );
}
