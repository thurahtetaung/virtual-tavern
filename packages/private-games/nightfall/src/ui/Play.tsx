import type { GameRoomInfo } from '@vt/game-sdk';
import { Badge, Button, Countdown, Hint, Panel, cn, useSecondsLeft } from '@vt/ui';
import { type ReactNode, useState } from 'react';
import { STEPS, buildNightPlan, stepDef } from '../logic/plan.ts';
import { ROLES, type RoleId } from '../logic/roles.ts';
import type { NightfallAction, NightfallView, Prompt } from '../logic/types.ts';
import type { Deck } from './assets.ts';
import {
  ArtifactChip,
  CardBack,
  CardFace,
  RoleArt,
  RoleChip,
  Token,
  emblem,
  useRoleDetails,
} from './Cards.tsx';
import { type Status, nudgeFor } from './status.ts';
import {
  TEAM_LABEL,
  centreName,
  describeEntry,
  describeNote,
  lineText,
  nameOfView,
  promptText,
} from './text.ts';
import type { DeviceSound } from './useSound.ts';

type Act = (a: NightfallAction) => Promise<boolean>;

// ---- Shared bits ----

/** The roles a note names, so they can be tapped. */
const rolesIn = (n: { kind: string; role?: RoleId }): RoleId[] => (n.role ? [n.role] : []);

/** Text with each named role turned into a tappable chip (first mention of each). */
function WithChips({ text, roles, deck }: { text: string; roles: RoleId[]; deck: Deck }) {
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  for (const role of [...new Set(roles)]) {
    const name = deck.name(role);
    const at = rest.indexOf(name);
    if (at < 0) continue;
    parts.push(
      rest.slice(0, at),
      <RoleChip key={key++} role={role} deck={deck} className="text-xs" />,
    );
    rest = rest.slice(at + name.length);
  }
  parts.push(rest);
  return <>{parts}</>;
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

/** The narration in progress, as text (always shown, whatever the sound setting). */
function Narration({ lines, deck }: { lines: string[]; deck: Deck }) {
  const text = lines
    .map((l) => lineText(l, deck))
    .filter(Boolean)
    .join(' ');
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
  const order = (r: RoleId) => {
    const step = STEPS.find((s) => s.role === r && !s.doppel) ?? STEPS.find((s) => s.role === r);
    const wolf = ROLES[r].wakesWithWerewolves ? 200 : Infinity;
    return Math.min(
      step && buildNightPlan(view.settings.roles).includes(step.id) ? step.order : Infinity,
      wolf,
    );
  };
  const sorted = unique.sort((a, b) => order(a) - order(b));
  return (
    <ul className="space-y-2" aria-label="Roles in play">
      {sorted.map((r) => (
        <li key={r} className="flex gap-2">
          <RoleChip role={r} deck={deck} className="shrink-0" />
          <span className="text-sm text-stone-600 dark:text-stone-400">
            {order(r) === Infinity ? 'Doesn’t wake. ' : ''}
            {ROLES[r].win}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What you learned tonight. */
function Learned({ view, deck, me }: { view: NightfallView; deck: Deck; me: string }) {
  const nameOf = nameOfView(view);
  const kinds = view.day?.centerKinds;
  if (!view.notes.length)
    return <p className="text-sm text-stone-500 italic">You didn’t learn anything tonight.</p>;
  return (
    <ol className="space-y-1.5" aria-label="What you learned tonight">
      {view.notes.map((n) => (
        <li key={n.id} className="rounded-lg bg-stone-100 px-3 py-1.5 text-sm dark:bg-stone-800">
          {n.step >= 0 && view.night === null && (
            <span className="mr-1 text-xs text-stone-500">{n.step + 1}.</span>
          )}
          <WithChips
            text={describeNote(n, nameOf, deck, kinds, me)}
            roles={rolesIn(n)}
            deck={deck}
          />
          {n.auto && <span className="text-xs text-stone-500"> (time ran out)</span>}
        </li>
      ))}
    </ol>
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
  const [shown, setShown] = useState(false);
  const role = view.myRole;
  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      {role && (
        <Panel className="flex flex-col items-center gap-3">
          {shown ? (
            <>
              <CardFace role={role} deck={deck} size="lg" />
              <p className="text-lg">
                You are the <RoleChip role={role} deck={deck} />
              </p>
              <p className="text-sm text-stone-600 dark:text-stone-400">{deck.text(role)}</p>
              <Button variant="ghost" size="sm" onClick={() => setShown(false)}>
                Cover it again
              </Button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShown(true)}
              aria-label="Tap to see your card"
              className="flex flex-col items-center gap-2 font-semibold"
            >
              <CardBack deck={deck} size="lg" />
              Tap to see your card
            </button>
          )}
          {!view.meReady ? (
            <Button size="lg" onClick={() => void act({ type: 'ready' })}>
              Ready
            </Button>
          ) : (
            <p className="text-sm">
              Ready · {view.readyCount} of {view.table?.filter((p) => !p.left).length}
            </p>
          )}
        </Panel>
      )}
      {room.isHost && (
        <Button variant="ghost" size="sm" onClick={() => void act({ type: 'start-night' })}>
          Start the night now
        </Button>
      )}
    </div>
  );
}

// ---- Night ----

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
  const togglePlayer = (id: string) => {
    if (!prompt.players?.ids.includes(id)) return;
    setCentre(prompt.either ? [] : centre);
    setPlayers((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : prompt.players!.max === 1
          ? [id]
          : [...cur, id].slice(-prompt.players!.max),
    );
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
  const centreCount = Math.max(3, ...(prompt.center?.slots.map((i) => i + 1) ?? [0]));
  return (
    <div className="space-y-3" data-testid="prompt" data-stage={prompt.stage}>
      <p className="font-semibold">{promptText(prompt, deck)}</p>
      {prompt.players && (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" aria-label="Players">
          {view.table!.map((p) => {
            const legal = prompt.players!.ids.includes(p.id);
            const picked = players.includes(p.id);
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
                      ? 'bg-amber-400 text-stone-950 ring-amber-500'
                      : 'bg-indigo-900/60 text-indigo-50 ring-indigo-400/40 hover:bg-indigo-800',
                    !legal && 'opacity-35',
                  )}
                >
                  <span aria-hidden>🂠</span>
                  <span className="truncate">{p.id === me ? 'You' : p.name}</span>
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
                  aria-label={centreName(i, i === 3 ? ['', '', '', 'wolf'] : undefined)}
                  onClick={() => toggleCentre(i)}
                  className={cn(
                    'rounded-lg ring-offset-2 ring-offset-indigo-950 transition',
                    picked && 'ring-4 ring-amber-400',
                    !legal && 'opacity-35',
                  )}
                >
                  <CardBack deck={deck} size="sm">
                    <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs font-bold text-white">
                      {i === 3 ? '🐺' : i + 1}
                    </span>
                  </CardBack>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {prompt.sides ? (
          <>
            <Button onClick={() => send({ side: 'right' })}>← Right</Button>
            <Button onClick={() => send({ side: 'left' })}>Left →</Button>
          </>
        ) : (
          <Button
            disabled={!ready}
            onClick={() => send(players.length ? { players } : { center: centre })}
          >
            Confirm
          </Button>
        )}
        {!prompt.mandatory && (
          <Button
            variant="ghost"
            className="text-indigo-100 hover:bg-indigo-800 dark:text-indigo-100"
            onClick={() => send({ pass: true })}
          >
            Skip
          </Button>
        )}
      </div>
      {prompt.mandatory && (
        <p className="text-xs text-indigo-200/80">
          You must choose: if time runs out, a choice is made for you.
        </p>
      )}
      {prompt.sides && (
        <p className="text-xs text-indigo-200/80">
          Your left is{' '}
          {nameOf(
            view.table![(view.table!.findIndex((p) => p.id === me) + 1) % view.table!.length]!.id,
          )}
          ; your right is{' '}
          {nameOf(
            view.table![
              (view.table!.findIndex((p) => p.id === me) - 1 + view.table!.length) %
                view.table!.length
            ]!.id,
          )}
          .
        </p>
      )}
    </div>
  );
}

export function Night({
  view,
  room,
  act,
  status,
  deck,
  lines,
  sound,
}: {
  view: NightfallView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  deck: Deck;
  lines: string[];
  sound: ReactNode;
}) {
  const night = view.night!;
  const acting = night.acting;
  const nameOf = nameOfView(view);
  const now = view.notes.filter((n) => n.step === night.index && night.index >= 0);
  return (
    <div
      className={cn(
        '-mx-4 -my-4 min-h-[70dvh] space-y-3 px-4 py-4 transition-colors sm:mx-0 sm:my-0 sm:rounded-2xl',
        acting ? 'bg-indigo-950 text-indigo-50' : 'bg-stone-950 text-stone-300',
      )}
      data-testid={acting ? 'night-acting' : 'night-idle'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          {night.index < 0 ? 'Night falls…' : `Night ${night.index + 1}/${night.count}`}
        </span>
        <Countdown deadline={night.deadline} clockOffset={room.clockOffset} />
      </div>
      <Narration lines={lines} deck={deck} />
      {acting ? (
        // Its own surface rather than <Panel>: the night is dark in both themes.
        <div className="space-y-3 rounded-2xl bg-indigo-900/70 p-4 text-indigo-50 shadow-sm ring-1 ring-indigo-500/50">
          <div className="flex items-center gap-3">
            <RoleArt role={acting.as} deck={deck} size="sm" />
            <div>
              <p className="text-lg font-bold">You’re awake</p>
              <p className="text-sm">
                as the <RoleChip role={acting.as} deck={deck} />
                {acting.step.startsWith('doppelganger-') && ' (your copy)'}
              </p>
            </div>
          </div>
          {acting.prompt ? (
            <PromptPanel
              key={`${night.index}:${acting.prompt.stage}`}
              view={view}
              prompt={acting.prompt}
              act={act}
              deck={deck}
            />
          ) : null}
          {now.length > 0 && (
            <ul className="space-y-1" data-testid="night-result">
              {now.map((n) => (
                <li
                  key={n.id}
                  className="rounded-lg bg-amber-300 px-3 py-2 text-sm font-semibold text-stone-950"
                >
                  <WithChips
                    text={describeNote(n, nameOf, deck, undefined, view.me?.id)}
                    roles={rolesIn(n)}
                    deck={deck}
                  />
                </li>
              ))}
            </ul>
          )}
          {!acting.prompt && (
            <p className="text-sm text-indigo-200">Close your eyes when the narrator says so.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span aria-hidden className="text-6xl">
            🌕
          </span>
          <p className="font-serif text-2xl text-stone-100">Night has fallen…</p>
          <p className="text-sm">{status.text}</p>
          {view.myRole && <MyCardChip view={view} deck={deck} />}
        </div>
      )}
      <div className="flex justify-center">{sound}</div>
    </div>
  );
}

// ---- Day and vote ----

type DayTab = 'table' | 'learned' | 'roles';

function TableList({
  view,
  deck,
  pick,
  picked,
}: {
  view: NightfallView;
  deck: Deck;
  pick?: (id: string) => void;
  picked?: string | null;
}) {
  const me = view.me?.id;
  const day = view.day;
  return (
    <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" aria-label="The table">
      {view.table!.map((p) => {
        const face = day?.faceUp.find((f) => f.player === p.id);
        const can = pick && p.id !== me && !p.left;
        const body = (
          <>
            <span className="flex items-center gap-1 truncate font-semibold">
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
              {p.left && <span>left</span>}
            </span>
          </>
        );
        return (
          <li key={p.id}>
            {can ? (
              <button
                type="button"
                aria-pressed={picked === p.id}
                aria-label={`Vote for ${p.name}`}
                onClick={() => pick(p.id)}
                className={cn(
                  'flex min-h-12 w-full flex-col items-start rounded-lg px-3 py-1.5 text-left ring-1 transition',
                  picked === p.id
                    ? 'bg-rose-600 text-white ring-rose-600'
                    : 'bg-white ring-stone-300 hover:bg-rose-50 dark:bg-stone-900 dark:ring-stone-700 dark:hover:bg-rose-950',
                )}
              >
                {body}
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
        'rounded-lg bg-indigo-50 px-3 py-1.5 text-center text-sm font-medium text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-200',
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
  lines,
  sound,
}: {
  view: NightfallView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  deck: Deck;
  lines: string[];
  sound: ReactNode;
}) {
  const [tab, setTab] = useState<DayTab>('table');
  const voting = view.phase === 'vote';
  const me = view.me?.id ?? '';
  const playing = view.myRole !== null;
  const deadline = voting ? (view.vote?.deadline ?? null) : (view.day?.deadline ?? null);
  const myArtifact = view.notes.find((n) => n.kind === 'artifact');
  const tabs: { id: DayTab; label: string }[] = [
    { id: 'table', label: voting ? 'Vote' : 'Table' },
    { id: 'learned', label: 'Learned' },
    { id: 'roles', label: 'Roles' },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{voting ? '🗳️ The vote' : '☀️ Day'}</span>
        <Countdown deadline={deadline} clockOffset={room.clockOffset} />
      </div>
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Narration lines={lines} deck={deck} />
      <Nudge view={view} room={room} />
      <div role="tablist" className="flex gap-1 rounded-xl bg-stone-200 p-1 dark:bg-stone-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'h-9 flex-1 rounded-lg text-sm font-semibold',
              tab === t.id && 'bg-white shadow dark:bg-stone-950',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'table' && (
        <Panel className="space-y-3">
          {playing && <MyCardChip view={view} deck={deck} />}
          {myArtifact?.kind === 'artifact' && (
            <p className="text-sm">
              Your card carries <ArtifactChip id={myArtifact.artifact} deck={deck} />
            </p>
          )}
          <TableList
            view={view}
            deck={deck}
            pick={voting && playing ? (id) => void act({ type: 'vote', target: id }) : undefined}
            picked={view.vote?.myVote}
          />
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
        </Panel>
      )}
      {tab === 'learned' && (
        <Panel>
          <Learned view={view} deck={deck} me={me} />
        </Panel>
      )}
      {tab === 'roles' && (
        <Panel>
          <RolesInPlay view={view} deck={deck} />
        </Panel>
      )}
      <div className="flex justify-center">{sound}</div>
    </div>
  );
}

// ---- The reveal ----

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
  const kinds = reveal.center.map((c) => c.kind);
  const [tab, setTab] = useState<'cards' | 'night'>('cards');
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
        {result.teams.map((t) => (
          <p key={t.team} className="text-sm">
            <span
              className={cn(
                'font-bold',
                t.won
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400',
              )}
            >
              {t.won ? '🏆' : '✗'} {TEAM_LABEL[t.team]} {t.won ? 'win' : 'lose'}
            </span>{' '}
            <span className="text-stone-600 dark:text-stone-400">
              ({t.players.map(nameOf).join(', ')})
            </span>
          </p>
        ))}
        {result.deaths.length === 0 ? (
          <p className="text-sm">Nobody died.</p>
        ) : (
          result.deaths.map((d) => (
            <p key={d.player} className="text-sm" data-testid="death">
              {d.cause === 'vote' ? (
                <Token src={deck.token('most-votes-1')} emblem="☠️" label="Most votes" />
              ) : (
                '🏹'
              )}{' '}
              {nameOf(d.player)}{' '}
              {d.cause === 'vote'
                ? `was voted out (${result.tally[d.player]} votes)`
                : `was shot by ${nameOf(d.by)}, the Hunter`}
            </p>
          ))
        )}
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
          <ul className="space-y-2" aria-label="Everyone’s cards">
            {view.table!.map((p) => {
              const card = reveal.cards[p.id]!;
              const id = result.identities[p.id]!;
              const dead = result.deaths.some((d) => d.player === p.id);
              const won = result.winners.includes(p.id);
              return (
                <li
                  key={p.id}
                  data-testid="reveal-player"
                  data-player={p.name}
                  data-final={id.role}
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
                      <span className="shrink-0 text-xs text-stone-500">
                        {result.votes[p.id] ? `voted ${nameOf(result.votes[p.id])}` : 'no vote'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <RoleChip role={reveal.deal.players[p.id]!} deck={deck} muted />
                      <span aria-hidden>→</span>
                      <RoleChip role={id.role} deck={deck} />
                      {card.artifact && <ArtifactChip id={card.artifact} deck={deck} />}
                      {card.shield && (
                        <Token src={deck.token('shield')} emblem="🛡️" label="Shielded" />
                      )}
                      {id.converted && <Badge>turned</Badge>}
                    </div>
                    {card.role !== id.role && card.role !== reveal.deal.players[p.id] && (
                      <p className="text-xs text-stone-500">Card: {deck.name(card.role)}</p>
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
                <p className="font-semibold">
                  {i + 1}. {id === 'werewolves' && 'The werewolves: '}
                  <RoleChip role={def.role} deck={deck} />
                  {def.doppel && ' (the Doppelgänger’s copy)'}
                </p>
                <ul className="ml-4 list-disc">
                  {entries.map((e, k) => (
                    <li key={k}>
                      <WithChips
                        text={describeEntry(e, nameOf, deck, kinds)}
                        roles={[...rolesIn(e.note), ...(e.moved ?? []).map((m) => m.role)]}
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
      {room.isHost && (
        <div className="flex flex-wrap gap-2">
          <Button size="lg" onClick={() => void act({ type: 'play-again' })}>
            Play again
          </Button>
          <Button variant="secondary" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change the cards
          </Button>
        </div>
      )}
    </div>
  );
}
