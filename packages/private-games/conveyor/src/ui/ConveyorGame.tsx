import {
  type GameRoomInfo,
  type GameUiProps,
  lobbyStatus,
  playersNeeded,
  waitingForHost,
  winTitle,
} from '@vt/game-sdk';
import {
  Button,
  EndHero,
  EndLayout,
  EndTabs,
  GuideLink,
  Hint,
  LobbySettings,
  Modal,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  Standings,
  Superlatives,
  Switch,
  TimerSettings,
  cn,
  timersLine,
  useAbandonGame,
  useSpectatorPrompt,
  useWideScreen,
  FoldSummary,
  LobbyLayout,
  LobbyPitch,
  LobbyStart,
} from '@vt/ui';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
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

  const wide = useWideScreen();
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
  const table = (
    <Table
      view={view}
      room={room}
      act={act}
      art={art}
      name={youName}
      logName={name}
      showGuide={guide}
      aside={wide && view.phase === 'playing' && inGame ? <Tips art={art} /> : null}
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
      <ConveyorStyles />
      {view.phase === 'lobby' || !view.game ? (
        <Lobby view={view} room={room} act={act} art={art} showGuide={guide} />
      ) : (
        <>
          <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          {view.phase === 'playing' && inGame && !wide && <Tips art={art} />}
          {view.phase === 'over' && (
            <End
              view={view}
              room={room}
              act={act}
              art={art}
              name={youName}
              // The finished table is one of the end's parts on every width (the end fills the window).
              table={table}
            />
          )}
          {view.phase !== 'over' && table}
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
      <aside className="cv-rise hidden flex-col gap-1.5 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line sm:flex">
        <p className="font-semibold">New here? Three things to know</p>
        {list}
        <Button variant="ghost" size="sm" className="self-end" onClick={dismiss}>
          Got it
        </Button>
      </aside>
      <aside className="flex items-center gap-1 rounded-xl bg-info-soft py-0.5 pr-1 pl-3 text-sm text-info-ink ring-1 ring-info-line sm:hidden">
        <span className="min-w-0 flex-1 truncate">New here? Three things to know.</span>
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
      ? playersNeeded(MIN_PLAYERS, n)
      : n > MAX_PLAYERS
        ? `At most ${MAX_PLAYERS} can play.`
        : problem;
  const timers = { clueSeconds: st.seconds, guessSeconds: null, timerMode: st.timerMode };
  const box = art.box();
  // The shared lobby line; a host who can't start yet reads why under Start game.
  const lobbyLine = !me
    ? { text: 'Watching the table.', me: false }
    : !me.playing
      ? { text: 'You’re watching. Take a seat to play.', me: false }
      : lobbyStatus(room, blocker);
  return (
    <LobbyLayout
      pitch={
        <LobbyPitch
          title={room.gameName ?? 'Conveyor'}
          emblem="🍣"
          art={
            box && <ProtectedImage src={box} alt="" className="w-full rounded-lg object-cover" />
          }
        >
          Everyone picks a dish at once and passes the rest of their hand along. Three quick rounds,
          best with 4 or 5.
        </LobbyPitch>
      }
      rail={
        <>
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
        </>
      }
      start={
        room.isHost && (
          <LobbyStart
            blocker={blocker}
            onStart={() => void act({ type: 'start' }, { anchor: 'cv-start' })}
            refusal="cv-start"
          />
        )
      }
    >
      {lobbyLine && <Hint tone={lobbyLine.me ? 'action' : 'neutral'}>{lobbyLine.text}</Hint>}
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            Players ({n}/{MAX_PLAYERS})
          </h2>
        </div>
        <div className="flex gap-3">
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
                    Watch instead
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
        {watching.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
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
      </Panel>
      <GuideLink title={room.gameName ?? 'Conveyor'} onClick={showGuide} />
    </LobbyLayout>
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
            'rounded-full bg-panel px-1.5 text-xs ring-1 ring-line',
            !!count && !allowedAt(t, count) && 'text-ink-muted line-through',
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
                  'flex w-full flex-col gap-1 rounded-xl bg-card p-2 text-left ring-1 ring-line',
                  st.menu === p.id && 'ring-2 ring-accent',
                  !ok && 'bg-sunk',
                )}
              >
                <span className="text-sm font-semibold">
                  {art.names.menu(p.id, p.name)}
                  {!ok && (
                    <span className="ml-1 text-xs font-normal text-ink-2">
                      <span aria-hidden>🚫</span> not for {count} players
                    </span>
                  )}
                </span>
                <span className="text-xs text-ink-muted">{p.blurb}</span>
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
                'flex w-full flex-col gap-1 rounded-xl bg-card p-2 text-left ring-1 ring-line',
                st.menu === id && 'ring-2 ring-accent',
              )}
            >
              <span className="text-sm font-semibold">
                {id === 'random' ? '🎲 Random menu' : '✏️ Your own menu'}
              </span>
              <span className="text-xs text-ink-muted">
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
    <div className="flex flex-col gap-2 rounded-xl bg-panel p-2 ring-1 ring-line">
      <p className="text-xs text-ink-muted">Nigiri is always in. Tap a dish’s ⓘ for its rules.</p>
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
                        'flex items-center gap-1 rounded-lg bg-card p-1 pr-2 text-xs font-semibold ring-1 ring-line disabled:opacity-40',
                        on && 'ring-2 ring-accent',
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
  table,
}: {
  view: ConveyorView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  /** The finished table, as one of the end's parts. */
  table: ReactNode;
}) {
  const g = view.game!;
  const wide = useWideScreen();
  const title =
    winTitle(g.winners, (id) => g.players.find((p) => p.id === id)?.name ?? '', room.you) ||
    'Game over';
  // One winner's cards (a tie shows the first): up to ten fit two rows on a phone.
  const winner = g.players.find((p) => g.winners.includes(p.id));
  // Its tray, or (when the last round's tray was cleared at scoring) the desserts it kept.
  const winnerTray = (winner?.tray.length ? winner.tray : (winner?.desserts ?? [])).slice(0, 10);
  return (
    <div className="flex flex-col gap-3">
      <EndLayout
        hero={
          <EndHero
            title={title}
            eyebrow={title === 'Game over' ? null : undefined}
            emblem={winnerTray.length ? null : '🍣'}
            // The winner's last tray, card by card: the meal that won it.
            art={
              winnerTray.length > 0 && (
                <ul
                  aria-label="The winning tray"
                  className="flex flex-wrap justify-center gap-1.5 lg:gap-2"
                >
                  {winnerTray.map((c, i) => (
                    <li key={`${c.id}-${i}`}>
                      <CardFace
                        k={c.copy ?? c.k}
                        art={art}
                        size="tray"
                        flipped={!!c.flipped}
                        className="shadow-vt-1 lg:w-20"
                      />
                    </li>
                  ))}
                </ul>
              )
            }
            superlatives={wide ? room.superlatives : undefined}
            actions={
              <>
                {room.isHost ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      size="lg"
                      onClick={() => void act({ type: 'play-again' }, { anchor: 'cv-end' })}
                    >
                      Play again
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'cv-end' })}
                    >
                      Change setup
                    </Button>
                  </div>
                ) : (
                  <Hint>{waitingForHost(room, 'start the next game')}</Hint>
                )}
                <RefusalSlot anchor="cv-end" />
              </>
            }
          />
        }
      >
        <Panel className="cv-rise flex flex-col gap-3 max-lg:p-3">
          <EndTabs
            tabs={[
              {
                id: 'scores',
                label: '🏆 Scores',
                content: (
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
                ),
              },
              !!g.dessertRows && {
                id: 'desserts',
                label: '🍮 Desserts',
                content: (
                  <details className="group text-sm" open>
                    <FoldSummary className="-my-1 px-0 font-semibold">
                      Desserts at the end
                    </FoldSummary>
                    <div className="mt-2">
                      <ScoreRows rows={g.dessertRows} art={art} name={name} you={room.you} />
                    </div>
                  </details>
                ),
              },
              {
                id: 'rounds',
                label: '📋 Rounds',
                content: (
                  <details className="group text-sm">
                    <FoldSummary className="-my-1 px-0 font-semibold">Round by round</FoldSummary>
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
                              <td key={r.round}>
                                {r.rows.find((x) => x.id === p.id)?.points ?? 0}
                              </td>
                            ))}
                            <td>{g.dessertRows?.find((x) => x.id === p.id)?.points ?? 0}</td>
                            <td className="font-bold">{p.score}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ),
              },
              !wide &&
                !!room.superlatives?.length && {
                  id: 'awards',
                  label: '✨ Awards',
                  content: <Superlatives lines={room.superlatives} />,
                },
              !!table && { id: 'table', label: '🍣 Table', content: table },
            ]}
          />
        </Panel>
      </EndLayout>
    </div>
  );
}
