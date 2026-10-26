import { type GameRoomInfo, type GameUiProps, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Hint,
  LobbySettings,
  Modal,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  Standings,
  StickyBar,
  Superlatives,
  Switch,
  TimerSettings,
  cn,
  timersLine,
  useAbandonGame,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import {
  GROUP_WORDS,
  type Group,
  MENU_SHAPE,
  PRESETS,
  TYPES,
  type TypeId,
  allowedAt,
  fullMenu,
  menuProblem,
  typesIn,
} from '../logic/cards.ts';
import {
  type ConveyorAction,
  type ConveyorView,
  MAX_PLAYERS,
  MIN_PLAYERS,
} from '../logic/types.ts';
import { type Art, artFor, useManifest } from './assets.ts';
import { CardFace, ConveyorStyles } from './Cards.tsx';
import { type Act, ScoreRows, Table, seeTips, tipsSeen } from './Table.tsx';
import { type NameOf, statusFor } from './text.ts';

export type ConveyorUiProps = GameUiProps<ConveyorView, ConveyorAction>;

export function ConveyorGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: ConveyorUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = (view.game?.players ?? view.seats).map((p) => `${p.id}=${p.name}`).join('|');
  const name = useMemo<NameOf>(() => {
    const map = new Map(names.split('|').map((kv) => kv.split('=') as [string, string]));
    return (id) => (id ? (map.get(id) ?? 'Someone') : 'Someone');
  }, [names]);
  const youName: NameOf = (id) => (id === room.you ? 'You' : name(id));
  const status = statusFor(view, room.you, youName, art.names);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  const inGame = !!view.game?.players.some((p) => p.id === room.you);
  const watching = !!view.me && (view.phase === 'lobby' ? !view.me.playing : !inGame);
  useSpectatorPrompt(
    setSpectator,
    watching
      ? view.phase === 'lobby'
        ? { text: 'Take a seat to play.', action: () => void act({ type: 'sit', playing: true }) }
        : { text: 'You can join from the next game.' }
      : null,
  );
  const guide = (topic?: unknown) => showGuide(topic);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
      <ConveyorStyles />
      {view.phase === 'lobby' || !view.game ? (
        <Lobby view={view} room={room} act={act} art={art} showGuide={guide} />
      ) : (
        <>
          <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          {view.phase === 'playing' && inGame && <Tips art={art} />}
          {view.phase === 'over' && (
            <End view={view} room={room} act={act} art={art} name={youName} />
          )}
          <Table
            view={view}
            room={room}
            act={act}
            art={art}
            name={youName}
            logName={name}
            showGuide={guide}
          />
        </>
      )}
    </div>
  );
}

/** First-time tips, until dismissed (per seat in a playtest): one line on phones, the list in a sheet. */
function Tips({ art }: { art: Art }) {
  const [seen, setSeen] = useState(tipsSeen);
  const [open, setOpen] = useState(false);
  if (seen) return null;
  const dismiss = () => {
    seeTips();
    setSeen(true);
    setOpen(false);
  };
  const list = (
    <ul className="list-disc space-y-1 pl-5">
      <li>Tap a card in your hand, then Lock in. Nobody sees it until everyone has picked.</li>
      <li>The chips under your cards say how many points each would add right now.</li>
      <li>
        Tap a dish in the menu strip for its rules; tap a player to see their tray. ▶ marks who you
        pass to: watch what they need. {art.names.type('chopsticks')} and {art.names.type('spoon')}{' '}
        are buttons once they’re in your tray.
      </li>
    </ul>
  );
  return (
    <>
      <aside className="cv-rise hidden flex-col gap-1.5 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line sm:flex dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
        <p className="font-semibold">New here? Three things to know</p>
        {list}
        <Button variant="ghost" size="sm" className="self-end" onClick={dismiss}>
          Got it
        </Button>
      </aside>
      <aside className="flex items-center gap-1 rounded-xl bg-info-soft py-0.5 pr-1 pl-3 text-sm text-info-ink ring-1 ring-info-line sm:hidden dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
        <span className="min-w-0 flex-1 truncate">New here? Tap a card, then Lock in.</span>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Tips
        </Button>
        <Button variant="ghost" size="sm" aria-label="Hide the tips" onClick={dismiss}>
          ✕
        </Button>
      </aside>
      <Modal open={open} onClose={() => setOpen(false)} title="New here? Three things to know">
        <div className="flex flex-col gap-3 text-sm">
          {list}
          <Button onClick={dismiss}>Got it</Button>
        </div>
      </Modal>
    </>
  );
}

const legalAt = (types: readonly TypeId[], n: number) => types.every((t) => allowedAt(t, n));

function Lobby({
  view,
  room,
  act,
  art,
  showGuide,
}: {
  view: ConveyorView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  showGuide: (t?: string) => void;
}) {
  const seated = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const n = seated.length;
  const st = view.settings;
  const set = (patch: Omit<Extract<ConveyorAction, { type: 'update-settings' }>, 'type'>) =>
    void act({ type: 'update-settings', ...patch }, { anchor: 'cv-lobby' });
  const preset = PRESETS.find((p) => p.id === st.menu);
  const menuName = preset
    ? art.names.menu(preset.id, preset.name)
    : st.menu === 'random'
      ? 'Random menu'
      : 'Your own menu';
  const problem =
    st.menu === 'custom'
      ? menuProblem(st.custom, n >= MIN_PLAYERS ? n : null)
      : preset && n >= MIN_PLAYERS
        ? menuProblem(preset.types, n)
        : null;
  const blocker =
    n < MIN_PLAYERS
      ? `${MIN_PLAYERS} players are needed (${n} seated).`
      : n > MAX_PLAYERS
        ? `At most ${MAX_PLAYERS} can play.`
        : problem;
  const timers = { clueSeconds: st.seconds, guessSeconds: null, timerMode: st.timerMode };
  const box = art.box();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <Hint tone={room.isHost && !blocker ? 'action' : 'neutral'}>
        {!me
          ? 'Watching the table.'
          : !me.playing
            ? 'You’re watching. Take a seat to play.'
            : blocker
              ? blocker
              : room.isHost
                ? 'Everyone’s here? Pick a menu and start.'
                : waitingForHost(room)}
      </Hint>
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            Players ({n}/{MAX_PLAYERS})
          </h2>
          <Button variant="ghost" size="sm" onClick={() => showGuide()}>
            📖 Rules
          </Button>
        </div>
        <div className="flex gap-3">
          {box && (
            <ProtectedImage
              src={box}
              alt=""
              className="h-24 w-auto shrink-0 rounded-lg object-cover"
            />
          )}
          <ul className="flex flex-1 flex-col gap-1.5" aria-label="Seats">
            {seated.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <PlayerTag
                  name={s.name}
                  host={s.id === room.hostId}
                  you={s.id === room.you}
                  offline={offline(s.id)}
                  className="flex-1"
                />
                {s.id === room.you && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void act({ type: 'sit', playing: false })}
                  >
                    Stand up
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
        {watching.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted dark:text-stone-400">
            <span>Watching:</span>
            {watching.map((s) => (
              <PlayerTag key={s.id} name={s.name} />
            ))}
          </p>
        )}
        {me && !me.playing && n < MAX_PLAYERS && (
          <Button variant="soft" onClick={() => void act({ type: 'sit', playing: true })}>
            Take a seat
          </Button>
        )}
        <p className="text-sm text-ink-muted dark:text-stone-400">
          Everyone picks a dish at once and passes the rest of their hand along. Three quick rounds,
          best with 4 or 5.
        </p>
      </Panel>
      <LobbySettings
        editable={room.isHost}
        summary={[
          menuName,
          ...(st.passBoth ? ['pass both ways'] : []),
          ...(st.golf ? ['golf'] : []),
          ...(n === 2 && st.drawPile ? ['draw piles'] : []),
          timersLine(timers, { clue: 'picks', guess: null }),
        ]}
        className="space-y-4"
      >
        <MenuPicker
          view={view}
          editable={room.isHost}
          art={art}
          n={n}
          set={set}
          showGuide={showGuide}
        />
        <Switch
          on={st.passBoth}
          editable={room.isHost}
          title="Pass both ways"
          help="Rounds 1 and 3 pass to the left, round 2 to the right. Off: always to the left."
          onChange={(v) => set({ passBoth: v })}
          testId="cv-pass-both"
        />
        <Switch
          on={st.golf}
          editable={room.isHost}
          title="Golf"
          help="The lowest score wins (a tie: fewest desserts). Scoring is the same."
          onChange={(v) => set({ golf: v })}
          testId="cv-golf"
        />
        <Switch
          on={st.drawPile}
          editable={room.isHost}
          title="Draw piles (2 players)"
          help="With 2 players: 5 cards in hand and 5 in your own pile, one drawn on each of the next 5 turns, so neither of you knows the other’s whole hand."
          onChange={(v) => set({ drawPile: v })}
          testId="cv-draw-pile"
        />
        <TimerSettings
          values={timers}
          editable={room.isHost}
          clueLabel="Pick timer"
          clueHelp="Time for each pick and each choice (a spoon’s giver always has 15 seconds)."
          strictHelp="a random card or choice is made for them"
          onChange={(patch) =>
            set({
              ...(patch.clueSeconds !== undefined && { seconds: patch.clueSeconds }),
              ...(patch.timerMode !== undefined && { timerMode: patch.timerMode }),
            })
          }
        />
        <RefusalSlot anchor="cv-lobby" />
      </LobbySettings>
      {room.isHost && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'cv-start' })}
          >
            Start the game
          </Button>
          <RefusalSlot anchor="cv-start" />
        </StickyBar>
      )}
    </div>
  );
}

/** The menu: a suggested one, a random one, or the host's own. */
function MenuPicker({
  view,
  editable,
  art,
  n,
  set,
  showGuide,
}: {
  view: ConveyorView;
  editable: boolean;
  art: Art;
  n: number;
  set: (patch: { menu?: string; custom?: TypeId[] }) => void;
  showGuide: (t?: string) => void;
}) {
  const st = view.settings;
  const count = n >= MIN_PLAYERS ? n : null;
  const chips = (types: readonly TypeId[]) => (
    <span className="flex flex-wrap gap-1">
      {fullMenu(types).map((t) => (
        <span
          key={t}
          className={cn(
            'rounded-full bg-panel px-1.5 text-xs ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700',
            !!count && !allowedAt(t, count) && 'line-through opacity-60',
          )}
        >
          {TYPES[t].emoji} {art.names.type(t)}
        </span>
      ))}
    </span>
  );
  return (
    <fieldset className="flex flex-col gap-2" disabled={!editable}>
      <legend className="mb-1 font-semibold">Menu</legend>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {PRESETS.map((p) => {
          const ok = !count || legalAt(p.types, count);
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={st.menu === p.id}
                data-menu={p.id}
                onClick={() => editable && set({ menu: p.id })}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-xl bg-card p-2 text-left ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700',
                  st.menu === p.id && 'ring-2 ring-accent dark:ring-amber-400',
                  !ok && 'opacity-60',
                )}
              >
                <span className="text-sm font-semibold">
                  {art.names.menu(p.id, p.name)}
                  {!ok && (
                    <span className="ml-1 text-xs font-normal">(not for {count} players)</span>
                  )}
                </span>
                <span className="text-xs text-ink-muted dark:text-stone-400">{p.blurb}</span>
                {st.menu === p.id && chips(p.types)}
              </button>
            </li>
          );
        })}
        {(['random', 'custom'] as const).map((id) => (
          <li key={id}>
            <button
              type="button"
              aria-pressed={st.menu === id}
              data-menu={id}
              onClick={() => editable && set({ menu: id })}
              className={cn(
                'flex w-full flex-col gap-1 rounded-xl bg-card p-2 text-left ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700',
                st.menu === id && 'ring-2 ring-accent dark:ring-amber-400',
              )}
            >
              <span className="text-sm font-semibold">
                {id === 'random' ? '🎲 Random menu' : '✏️ Your own menu'}
              </span>
              <span className="text-xs text-ink-muted dark:text-stone-400">
                {id === 'random'
                  ? 'A surprise mix that suits the table, drawn at the start.'
                  : 'Choose every dish yourself.'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {st.menu === 'custom' && (
        <CustomMenu
          custom={st.custom}
          count={count}
          editable={editable}
          art={art}
          set={set}
          showGuide={showGuide}
        />
      )}
    </fieldset>
  );
}

function CustomMenu({
  custom,
  count,
  editable,
  art,
  set,
  showGuide,
}: {
  custom: TypeId[];
  count: number | null;
  editable: boolean;
  art: Art;
  set: (patch: { custom?: TypeId[] }) => void;
  showGuide: (t?: string) => void;
}) {
  const toggle = (t: TypeId, group: Exclude<Group, 'nigiri'>) => {
    const has = custom.includes(t);
    let next = has ? custom.filter((x) => x !== t) : [...custom, t];
    // A full group swaps out its oldest pick.
    const inGroup = next.filter((x) => TYPES[x].group === group);
    if (!has && inGroup.length > MENU_SHAPE[group]) next = next.filter((x) => x !== inGroup[0]);
    set({ custom: next });
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-panel p-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700">
      <p className="text-xs text-ink-muted dark:text-stone-400">
        Nigiri is always in. Tap a dish’s ⓘ for its rules.
      </p>
      {(Object.keys(MENU_SHAPE) as Exclude<Group, 'nigiri'>[]).map((group) => {
        const want = MENU_SHAPE[group];
        const have = custom.filter((t) => TYPES[t].group === group).length;
        return (
          <div key={group} className="flex flex-col gap-1">
            <p className="text-sm font-semibold">
              {GROUP_WORDS[group][1].replace(/^./, (c) => c.toUpperCase())}: {have}/{want}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {typesIn(group).map((t) => {
                const on = custom.includes(t);
                const ok = !count || allowedAt(t, count);
                return (
                  <li key={t} className="flex items-center">
                    <button
                      type="button"
                      aria-pressed={on}
                      disabled={!editable || (!ok && !on)}
                      onClick={() => toggle(t, group)}
                      className={cn(
                        'flex items-center gap-1 rounded-lg bg-card p-1 pr-2 text-xs font-semibold ring-1 ring-line disabled:opacity-40 dark:bg-stone-800 dark:ring-stone-600',
                        on && 'ring-2 ring-accent dark:ring-amber-400',
                      )}
                      title={ok ? TYPES[t].short : `Not with ${count} players`}
                    >
                      <CardFace k={TYPES[t].variants[0]!.id} art={art} size="mini" />
                      {art.names.type(t)}
                      {!ok && ` (${TYPES[t].players[0]}–${TYPES[t].players[1]})`}
                    </button>
                    <button
                      type="button"
                      className="px-1 text-xs"
                      aria-label={`Rules: ${art.names.type(t)}`}
                      onClick={() => showGuide(t)}
                    >
                      ⓘ
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function End({
  view,
  room,
  act,
  art,
  name,
}: {
  view: ConveyorView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  return (
    <Panel className="cv-rise flex flex-col gap-3">
      <Standings
        entries={g.players.map((p) => ({
          id: p.id,
          name: p.name,
          score: p.score,
          note: `${p.desserts.length} ${art.names.type(g.menu.find((t) => TYPES[t].group === 'desserts')!)}`,
        }))}
        you={room.you}
        lowerIsBetter={g.golf}
      />
      {g.dessertRows && (
        <details className="text-sm" open>
          <summary className="cursor-pointer font-semibold">Desserts at the end</summary>
          <div className="mt-2">
            <ScoreRows rows={g.dessertRows} art={art} name={name} you={room.you} />
          </div>
        </details>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Round by round</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead>
            <tr>
              <th className="font-semibold">Player</th>
              {g.results.map((r) => (
                <th key={r.round}>R{r.round}</th>
              ))}
              <th>🍮</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {g.players.map((p) => (
              <tr key={p.id}>
                <td>{name(p.id)}</td>
                {g.results.map((r) => (
                  <td key={r.round}>{r.rows.find((x) => x.id === p.id)?.points ?? 0}</td>
                ))}
                <td>{g.dessertRows?.find((x) => x.id === p.id)?.points ?? 0}</td>
                <td className="font-bold">{p.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <Superlatives lines={room.superlatives} />
      {room.isHost ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="lg"
            className="flex-1"
            onClick={() => void act({ type: 'play-again' }, { anchor: 'cv-end' })}
          >
            Play again
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'cv-end' })}
          >
            Change the menu
          </Button>
        </div>
      ) : (
        <Hint>{waitingForHost(room, 'start the next game')}</Hint>
      )}
      <RefusalSlot anchor="cv-end" />
    </Panel>
  );
}
