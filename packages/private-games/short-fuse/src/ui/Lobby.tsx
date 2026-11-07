import { volumeShare } from '@vt/ui/sound';
import { GAME as SOUND_GAME, ShortFuseLobbySound } from './Sound.tsx';
import { type GameRoomInfo, lobbyStatus, playersNeeded } from '@vt/game-sdk';
import {
  Button,
  GuideLink,
  Hint,
  HostOnlyNote,
  Panel,
  PlayerTag,
  StickyBar,
  Switch,
  FoldSummary,
  cn,
  LobbySettings,
} from '@vt/ui';
import {
  DECISION_SECONDS_OPTIONS,
  MAX_SEATS,
  MIN_PLAYERS,
  NOPE_SECONDS,
  type Preset,
  type ShortFuseAction,
  type ShortFuseView,
} from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CardBack, CardFace } from './Card.tsx';
import { deckSummary } from './summary.ts';
import { an } from './text.ts';

type Act = (a: ShortFuseAction, o?: { anchor?: string }) => Promise<boolean>;
type Patch = Omit<Extract<ShortFuseAction, { type: 'update-settings' }>, 'type'>;

/** The 18+ mark on the Adult deck, wherever it shows. */
export function AdultBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'rounded-md bg-danger px-1.5 py-0.5 text-xs font-black tracking-wide text-white',
        className,
      )}
      data-testid="adult-badge"
    >
      18+
    </span>
  );
}

const PRESETS: { id: Exclude<Preset, 'custom'>; title: string; line: string; glyph: string }[] = [
  {
    id: 'classic',
    title: 'Classic',
    line: 'The original deck. 2–5 players as printed; bigger tables add cards from a second deck.',
    glyph: '💣',
  },
  {
    id: 'adult',
    title: 'Adult',
    line: 'The same game with the adults-only deck: different art and jokes, identical rules.',
    glyph: '🔞',
  },
  {
    id: 'party',
    title: 'Party',
    line: 'The big-table deck for 2–10, with the right cards for your table size.',
    glyph: '🎉',
  },
  {
    id: 'zombie',
    title: 'Ghosts',
    line: 'Classic with Expansion 4: explode and you haunt the table until someone brings you back.',
    glyph: '🧟',
  },
  {
    id: 'chaos',
    title: 'Chaos',
    line: 'Everything at once: Classic with all four expansions, about 12 cards a player.',
    glyph: '🌋',
  },
];

export function Lobby({
  view,
  room,
  c,
  act,
  showGuide,
}: {
  view: ShortFuseView;
  room: GameRoomInfo;
  c: Content;
  act: Act;
  showGuide: () => void;
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
  const r = view.readout;
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const set = (patch: Patch) => void act({ type: 'update-settings', ...patch });
  const setName = (k: string) => c.names.sets[k] ?? k;
  const presetTitle = (p: (typeof PRESETS)[number]) =>
    p.id === 'party' || p.id === 'adult' || p.id === 'classic'
      ? setName(p.id)
      : p.id === 'zombie'
        ? `${setName('classic')} + ${c.names.sets.x4 ?? p.title}`
        : p.title;
  const preset = PRESETS.find((p) => p.id === view.preset);
  const lobbyLine = !view.me
    ? { text: 'Watching the table.', me: false }
    : !view.me.playing
      ? { text: 'You’re watching. Take a seat to play.', me: false }
      : lobbyStatus(room, blocker);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {lobbyLine && (
        <Hint dense tone={lobbyLine.me ? 'action' : 'neutral'}>
          {lobbyLine.text}
        </Hint>
      )}
      <Panel className="space-y-2">
        <h3 className="font-bold text-ink">
          Players ({n}/{MAX_SEATS})
        </h3>
        <ul className="flex flex-wrap gap-1.5">
          {playing.map((p) => (
            <li key={p.id} className="rounded-full bg-card px-3 py-1 text-sm ring-1 ring-line">
              <PlayerTag
                name={p.name}
                host={p.id === room.hostId}
                you={p.id === view.me?.id}
                offline={!online(p.id)}
              />
            </li>
          ))}
        </ul>
        {watching.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            <span>Watching:</span>
            {watching.map((w) => (
              <PlayerTag key={w.id} name={w.name} />
            ))}
          </p>
        )}
        {view.me && (
          <Button
            id="sf-seat"
            variant="secondary"
            size="sm"
            onClick={() =>
              void act({ type: 'sit', playing: !view.me!.playing }, { anchor: 'seat' })
            }
          >
            {view.me.playing ? 'Watch instead' : 'Take a seat'}
          </Button>
        )}
      </Panel>
      <GuideLink title={room.gameName ?? c.names.title} onClick={showGuide} />
      <div className="relative overflow-hidden rounded-3xl bg-panel p-5 shadow-sm ring-1 ring-line">
        <div className="flex items-center gap-4">
          <div className="flex shrink-0 -space-x-8">
            <CardBack c={c} size="sm" className="rotate-[-8deg]" />
            <CardFace
              card={{ t: 'bomb', face: 0 }}
              art={s.art}
              c={c}
              size="sm"
              className="rotate-[6deg]"
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-ink-muted">
              Play your cards, draw one, and hope it isn’t {an(c.names.bomb)}. Last one standing
              wins.
            </p>
          </div>
        </div>
      </div>

      <LobbySettings
        editable={host}
        title="The deck"
        summary={deckSummary(s, preset ? presetTitle(preset) : null, setName)}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Deck">
          {PRESETS.map((p) => {
            const on = view.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!host}
                onClick={() => set({ preset: p.id })}
                data-testid={`preset-${p.id}`}
                className={cn(
                  'rounded-xl p-2.5 text-left ring-1 transition disabled:cursor-default sm:p-3',
                  on
                    ? 'bg-accent-soft ring-2 ring-accent'
                    : 'bg-card ring-line enabled:hover:bg-panel',
                )}
              >
                <span className="flex items-center gap-2 font-bold text-ink">
                  <span aria-hidden>{p.glyph}</span>
                  {presetTitle(p)}
                  {p.id === 'adult' && <AdultBadge />}
                </span>
                <span className="mt-1 block text-xs leading-snug text-ink-muted">{p.line}</span>
              </button>
            );
          })}
        </div>
        {view.preset === 'custom' && (
          <p className="text-xs text-ink-muted">
            Custom deck: {setName(s.core)} with the{' '}
            {setName(s.art === 'adult' ? 'adult' : 'classic')} art.
          </p>
        )}
        <Switch
          on={s.x1}
          editable={host}
          title={setName('x1')}
          help={c.t(
            'Adds {c:void} (one of the {bombs}: once drawn it sits face up in the pile), {c:aim}, {c:reverse}, {c:bottom}, {c:alter3} and {c:wild}.',
          )}
          onChange={(v) => set({ x1: v })}
          testId="toggle-x1"
        />
        <Switch
          on={s.x2}
          editable={host}
          title={setName('x2')}
          help={c.t(
            'One more {bomb}, plus {c:shelter} (keep a drawn {bomb} in your hand), {c:blind}, {c:mark}, {c:stack}, {c:recycle}, {c:swap}, {c:superskip}, {c:peek5} and {c:alter5}.',
          )}
          onChange={(v) => set({ x2: v })}
          testId="toggle-x2"
        />
        <Switch
          on={s.x3}
          editable={host}
          title={setName('x3')}
          help={c.t(
            'Adds the two {c:twin} cards, {c:vault} with its face-down Stash, {c:mine}, {c:bury}, {c:self3}, {c:potluck}, {c:share3}, {c:alter3now} and {c:superskip}.',
          )}
          onChange={(v) => set({ x3: v })}
          testId="toggle-x3"
        />
        <Switch
          on={s.x4}
          editable={host}
          title={setName('x4')}
          help={c.t(
            'Ghosts: explode and you stay at the table with your hand. A {c:revive} replaces each {c:defuse} and brings a ghost back. Adds {c:dig}, {c:ghostattack}, {c:feed}, {c:copy}, {c:seer}, {c:robber}, {c:shufflenow} and {c:superskip}.',
          )}
          onChange={(v) => set({ x4: v })}
          testId="toggle-x4"
        />
        <Switch
          on={s.faster}
          editable={host}
          title="Faster game"
          help={c.t('Takes a third of the pile out at random before the {bombs} go in.')}
          onChange={(v) => set({ faster: v })}
        />
        {ok && (
          <p
            className="rounded-xl bg-info-soft px-3 py-2 text-sm text-info-ink ring-1 ring-info-line"
            data-testid="readout"
          >
            {r.players} players: draw pile of <b>{r.pile}</b> · <b>{r.bombs}</b>{' '}
            {r.bombs === 1 ? c.names.bomb : c.names.bombs}
            {r.void && <> + {c.name('void')}</>} · hands of {r.hand}
            {r.revives > 0 && (
              <>
                {' '}
                (with {r.revives === r.players ? 'a' : r.revives} {c.name('revive')}
                {r.revives === r.players ? ' each' : ''})
              </>
            )}{' '}
            · about {r.turnsEach} turns each
          </p>
        )}
      </LobbySettings>
      <ShortFuseLobbySound share={volumeShare(SOUND_GAME, room.isHost, act, s.hostVolumes)} />

      <details className="group rounded-xl bg-panel ring-1 ring-line">
        <FoldSummary>⏱️ Timing and house rules</FoldSummary>
        <div className="space-y-3 px-4 pb-4">
          {!host && <HostOnlyNote />}
          <label className="block">
            <span className="text-sm font-semibold text-ink">{c.name('nope')} countdown</span>
            <span className="block text-xs text-ink-muted">
              After every play, everyone sees the same countdown; only players holding a{' '}
              {c.name('nope')} get the button.
            </span>
            {host ? (
              <span className="mt-1 flex items-center gap-3">
                <input
                  type="range"
                  min={NOPE_SECONDS.min}
                  max={NOPE_SECONDS.max}
                  value={s.nopeSeconds}
                  onChange={(e) => set({ nopeSeconds: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-[var(--color-accent)]"
                  aria-label={`${c.name('nope')} countdown in seconds`}
                />
                <b className="w-10 text-ink">{s.nopeSeconds} s</b>
              </span>
            ) : (
              <span className="mt-1 block text-ink">{s.nopeSeconds} seconds</span>
            )}
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Turn clock</span>
            <span className="block text-xs text-ink-muted">A countdown on every decision.</span>
            {host ? (
              <select
                className="mt-1 min-h-11 w-full rounded-lg bg-card px-3 py-2 text-ink ring-1 ring-line-strong"
                value={s.decisionSeconds ?? ''}
                onChange={(e) =>
                  set({ decisionSeconds: e.target.value === '' ? null : Number(e.target.value) })
                }
              >
                <option value="">No clock</option>
                {DECISION_SECONDS_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v} seconds
                  </option>
                ))}
              </select>
            ) : (
              <span className="mt-1 block text-ink">
                {s.decisionSeconds ? `${s.decisionSeconds} seconds` : 'No clock'}
              </span>
            )}
          </label>
          <Switch
            on={s.strict}
            editable={host && s.decisionSeconds !== null}
            title="Strict clock"
            help="At zero the game moves for whoever is slow: draws, hides at random, keeps the order or gives a random card. Off: the clock only reminds."
            onChange={(v) => set({ strict: v })}
          />
          <Switch
            on={s.fiveCombo}
            editable={host}
            title="Five different cards (legacy)"
            help="Play five cards with different names to take any card from the discard pile."
            onChange={(v) => set({ fiveCombo: v })}
          />
          <Switch
            on={s.nonStacking}
            editable={host}
            title="Attacks don’t stack (legacy)"
            help={c.t(
              'An attacked player’s {c:attack} passes on just 2 turns, not their own as well.',
            )}
            onChange={(v) => set({ nonStacking: v })}
          />
        </div>
      </details>

      {view.rigAllowed && host && <RigPanel act={act} rigged={view.rigged} />}

      {host && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!ok}
            onClick={() => void act({ type: 'start' }, { anchor: 'start' })}
            data-testid="start"
          >
            Start game
          </Button>
          {blocker && <p className="mt-1.5 text-caption text-ink-muted">{blocker}</p>}
        </StickyBar>
      )}
    </div>
  );
}

/**
 * Test servers only (the server says so in `rigAllowed`): fixes the next game's hands and the top
 * of the pile, as JSON `{ "hands": [["favor", …], …], "top": ["bomb", …], "first": 0 }`.
 */
function RigPanel({ act, rigged }: { act: Act; rigged: boolean }) {
  return (
    <details className="group rounded-xl bg-panel text-sm ring-1 ring-line" data-testid="rig">
      <FoldSummary>🧪 Test setup {rigged && '(armed)'}</FoldSummary>
      <form
        className="space-y-2 px-4 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          const text = new FormData(e.currentTarget).get('rig');
          if (typeof text !== 'string') return;
          try {
            const rig = JSON.parse(text) as Omit<Extract<ShortFuseAction, { type: 'rig' }>, 'type'>;
            void act({ type: 'rig', ...rig }, { anchor: 'rig' });
          } catch {
            // Not JSON: nothing to send.
          }
        }}
      >
        <textarea
          name="rig"
          aria-label="Rig"
          className="h-24 w-full rounded-lg bg-card p-2 font-mono text-xs text-ink ring-1 ring-line"
        />
        <Button type="submit" variant="secondary" size="sm">
          Use this setup
        </Button>
      </form>
    </details>
  );
}
