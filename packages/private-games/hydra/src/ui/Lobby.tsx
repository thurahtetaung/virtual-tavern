import { volumeShare } from '@vt/ui/sound';
import { GAME as SOUND_GAME, HydraLobbySound } from './Sound.tsx';
import { type GameRoomInfo, lobbyStatus, playersNeeded } from '@vt/game-sdk';
import {
  Button,
  GuideLink,
  Hint,
  Panel,
  PlayerTag,
  StickyBar,
  Switch,
  TimerSettings,
  TAP_BAND,
  cn,
  LobbySettings,
  timersLine,
} from '@vt/ui';
import { RED_COUNT, setupFor, trackFor } from '../logic/tables.ts';
import {
  CLAIM_SECONDS_OPTIONS,
  type HydraAction,
  type HydraView,
  MAX_SEATS,
  MIN_PLAYERS,
} from '../logic/types.ts';
import type { Content } from './assets.ts';
import { POWER_EMOJI } from './Boards.tsx';
import { RoleBack } from './Cards.tsx';
import { DISPLAY } from './text.tsx';

type Act = (a: HydraAction) => Promise<boolean>;

export function Lobby({
  view,
  room,
  c,
  act,
  showGuide,
  plain,
  setPlain,
}: {
  view: HydraView;
  room: GameRoomInfo;
  c: Content;
  act: Act;
  showGuide: () => void;
  /** The edition's display font switched off ("Themed lettering" off), for this viewer only. */
  plain: boolean;
  setPlain: (on: boolean) => void;
}) {
  const s = view.settings;
  const host = room.isHost;
  const playing = view.seats.filter((x) => x.playing);
  const watching = view.seats.filter((x) => !x.playing);
  const n = playing.length;
  const blocker =
    n < MIN_PLAYERS
      ? playersNeeded(MIN_PLAYERS, n)
      : n > MAX_SEATS
        ? `At most ${MAX_SEATS} can play.`
        : null;
  const ok = !blocker;
  const lobbyLine = !view.me
    ? { text: 'Watching the table.', me: false }
    : !view.me.playing
      ? { text: 'You’re watching. Take a seat to play.', me: false }
      : lobbyStatus(room, blocker);
  const reds = RED_COUNT[n];
  const setup = ok ? setupFor(n, s.rebalance) : null;
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const set = (patch: Omit<Extract<HydraAction, { type: 'update-settings' }>, 'type'>) =>
    void act({ type: 'update-settings', ...patch });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-stone-900 via-red-950 to-stone-900 p-5 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-16 shrink-0 rotate-[-6deg] sm:w-20">
            <RoleBack c={c} />
          </div>
          <div className="min-w-0">
            <h2 className={cn('text-2xl font-black tracking-wide sm:text-3xl', DISPLAY)}>
              {room.gameName ?? c.names.title}
            </h2>
            <p className="text-sm text-white/80">
              {c.t(
                '{blues} against {reds}. Elect governments, pass laws in secret, and find {leader} before it’s too late.',
              )}
            </p>
            {c.font && (
              <button
                type="button"
                role="switch"
                aria-checked={!plain}
                onClick={() => setPlain(!plain)}
                className={cn('mt-1 text-xs font-semibold text-white/80 underline', TAP_BAND)}
              >
                Themed lettering: {plain ? 'off' : 'on'}
              </button>
            )}
          </div>
        </div>
      </div>

      {lobbyLine && <Hint tone={lobbyLine.me ? 'action' : 'neutral'}>{lobbyLine.text}</Hint>}

      <Panel className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold">
            Players ({n}/{MAX_SEATS})
          </h3>
          {view.me &&
            (view.me.playing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void act({ type: 'sit', playing: false })}
              >
                Watch instead
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void act({ type: 'sit', playing: true })}
                disabled={n >= MAX_SEATS}
              >
                Take a seat
              </Button>
            ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="seat-order">
          {playing.map((x) => (
            <li key={x.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden>🎩</span>
              <PlayerTag
                name={x.name}
                host={x.id === room.hostId}
                you={x.id === view.me?.id}
                offline={!online(x.id)}
              />
            </li>
          ))}
        </ul>
        {watching.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            Watching:
            {watching.map((x) => (
              <PlayerTag
                key={x.id}
                name={x.name}
                you={x.id === view.me?.id}
                offline={!online(x.id)}
              />
            ))}
          </p>
        )}
        {ok && reds !== undefined && setup && (
          <div className="rounded-xl bg-sunk p-3 text-sm" data-testid="composition">
            <p>
              <b className="text-sky-700 dark:text-sky-300">
                {n - reds} {c.names.blues}
              </b>{' '}
              against{' '}
              <b className="text-red-700 dark:text-red-300">
                {reds - 1} {reds - 1 === 1 ? c.names.red : c.names.reds} + {c.names.leader}
              </b>
              .{' '}
              {n <= 6
                ? c.t('{Leader} and the {red} know each other.')
                : c.t('The {reds} know each other and {leader}; {leader} knows nobody.')}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {c.t(
                `Deck: ${setup.blue} {bluePolicy} and ${setup.red} {redPolicy} {policies}${
                  setup.redEnacted
                    ? `, with ${setup.redEnacted} {redPolicy} {policy} on the board at the start`
                    : ''
                }`,
              )}
              . Powers:{' '}
              {trackFor(n)
                .slice(0, 5)
                .map((p, i) => (p ? `${i + 1} ${POWER_EMOJI[p]}` : null))
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        )}
      </Panel>
      <GuideLink title={room.gameName ?? c.names.title} onClick={showGuide} />

      <LobbySettings
        editable={host}
        title="Settings"
        summary={[
          s.rebalance && 'rebalanced',
          s.quick && 'quick mode',
          s.flags && 'claim flags',
          timersLine(
            {
              clueSeconds: s.pickSeconds,
              guessSeconds: s.voteSeconds,
              timerMode: s.timerMode === 'strict' ? 'strict' : 'soft',
            },
            { clue: 'turns', guess: 'votes' },
          ),
        ]}
        className="space-y-3"
      >
        <Switch
          on={s.rebalance}
          tagTone="special"
          editable={host}
          title="Rebalance for 6, 7 and 9 players"
          tag="community"
          help={c.t(
            'Not in the official rules. At 6 a {redPolicy} {policy} starts on the board; at 7 and 9 the deck has one {redPolicy} {policy} fewer.',
          )}
          onChange={(v) => set({ rebalance: v })}
        />
        <Switch
          on={s.quick}
          editable={host}
          title="Quick mode"
          help={c.t(
            'Skip the dramatic pause before the table learns whether the {chancellor} is {leader}.',
          )}
          onChange={(v) => set({ quick: v })}
        />
        <Switch
          on={s.flags}
          editable={host}
          title="Flag claims that don’t add up"
          help="The claim log marks claims that can’t all be true, judged only from what everyone saw. It never uses secret information."
          onChange={(v) => set({ flags: v })}
        />
        <label className="block">
          <span className="text-sm font-semibold">Claim timer</span>
          <span className="block text-xs text-ink-muted">
            A reminder: once it runs out, the host may skip a missing claim. Nothing happens by
            itself.
          </span>
          {host ? (
            <select
              className="mt-1 min-h-11 w-full rounded-lg bg-card px-3 py-2 ring-1 ring-line-strong"
              value={s.claimSeconds}
              onChange={(e) => set({ claimSeconds: Number(e.target.value) })}
            >
              {CLAIM_SECONDS_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v} seconds
                </option>
              ))}
            </select>
          ) : (
            <span className="mt-1 block">{s.claimSeconds} seconds</span>
          )}
        </label>
        <TimerSettings
          values={{
            clueSeconds: s.pickSeconds,
            guessSeconds: s.voteSeconds,
            timerMode: s.timerMode === 'strict' ? 'strict' : 'soft',
          }}
          editable={host}
          clueLabel="Turn timer"
          clueHelp={c.t('Nominating, discarding, the {veto} answer and powers.')}
          guessLabel="Vote timer"
          guessHelp="Everyone’s vote."
          strictHelp="a missing vote isn’t counted and other turns are played at random (claims never are)"
          onChange={(p) =>
            set({
              ...(p.clueSeconds !== undefined && { pickSeconds: p.clueSeconds }),
              ...(p.guessSeconds !== undefined && { voteSeconds: p.guessSeconds }),
              ...(p.timerMode !== undefined && { timerMode: p.timerMode }),
            })
          }
        />
      </LobbySettings>
      <HydraLobbySound share={volumeShare(SOUND_GAME, room.isHost, act, s.hostVolumes)} />

      {host && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!ok}
            onClick={() => void act({ type: 'start' })}
          >
            {ok ? `Start with ${n} players` : `Need ${MIN_PLAYERS}–${MAX_SEATS} players`}
          </Button>
        </StickyBar>
      )}
    </div>
  );
}
