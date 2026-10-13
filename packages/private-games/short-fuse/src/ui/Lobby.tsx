import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import { Button, Hint, Panel, PlayerTag, StickyBar, cn } from '@vt/ui';
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
import { an } from './text.ts';

type Act = (a: ShortFuseAction, o?: { anchor?: string }) => Promise<boolean>;
type Patch = Omit<Extract<ShortFuseAction, { type: 'update-settings' }>, 'type'>;

export function Toggle({
  on,
  editable,
  title,
  help,
  onChange,
  tag,
  testId,
}: {
  on: boolean;
  editable: boolean;
  title: string;
  help: string;
  onChange: (v: boolean) => void;
  tag?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={!editable}
      onClick={() => onChange(!on)}
      data-testid={testId}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left ring-1 transition disabled:cursor-default',
        on ? 'bg-accent-soft ring-2 ring-accent' : 'bg-card ring-line enabled:hover:bg-panel',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition',
          on ? 'justify-end bg-accent' : 'justify-start bg-line-strong',
        )}
      >
        <span className="size-4 rounded-full bg-card shadow" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">
          {title}
          {tag && (
            <span className="ml-1.5 rounded bg-danger-soft px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wide text-danger-ink uppercase ring-1 ring-danger-line">
              {tag}
            </span>
          )}
        </span>
        <span className="block text-xs text-ink-muted">{help}</span>
      </span>
    </button>
  );
}

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
  const ok = n >= MIN_PLAYERS && n <= MAX_SEATS;
  const r = view.readout;
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const set = (patch: Patch) => void act({ type: 'update-settings', ...patch });
  const setName = (k: string) => c.names.sets[k] ?? k;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
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
            <h2 className="text-2xl font-black tracking-wide text-ink sm:text-3xl">
              {c.names.title}
            </h2>
            <p className="text-sm text-ink-muted">
              Play your cards, draw one, and hope it isn’t {an(c.names.bomb)}. Last one standing
              wins.
            </p>
            <button
              type="button"
              className="mt-1 text-sm font-semibold text-accent-text underline underline-offset-2"
              onClick={showGuide}
            >
              How to play
            </button>
          </div>
        </div>
      </div>

      <Panel className="space-y-3">
        <h3 className="font-bold text-ink">The deck</h3>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Deck">
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
                  'rounded-xl p-3 text-left ring-1 transition disabled:cursor-default',
                  on
                    ? 'bg-accent-soft ring-2 ring-accent'
                    : 'bg-card ring-line enabled:hover:bg-panel',
                )}
              >
                <span className="flex items-center gap-2 font-bold text-ink">
                  <span aria-hidden>{p.glyph}</span>
                  {p.id === 'party'
                    ? setName('party')
                    : p.id === 'adult'
                      ? setName('adult')
                      : setName('classic')}
                  {p.id === 'adult' && <AdultBadge />}
                </span>
                <span className="mt-1 block text-xs text-ink-muted">{p.line}</span>
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
        <Toggle
          on={s.x1}
          editable={host}
          title={setName('x1')}
          help={c.t(
            'Adds {c:void} (one of the {bombs}: once drawn it sits face up in the pile), {c:aim}, {c:reverse}, {c:bottom}, {c:alter3} and {c:wild}.',
          )}
          onChange={(v) => set({ x1: v })}
          testId="toggle-x1"
        />
        <Toggle
          on={s.faster}
          editable={host}
          title="Faster game"
          help={c.t('Takes a third of the pile out at random before the {bombs} go in.')}
          onChange={(v) => set({ faster: v })}
        />
        <p
          className="rounded-xl bg-info-soft px-3 py-2 text-sm text-info-ink ring-1 ring-info-line"
          data-testid="readout"
        >
          {ok ? (
            <>
              {r.players} players: draw pile of <b>{r.pile}</b> · <b>{r.bombs}</b>{' '}
              {r.bombs === 1 ? c.names.bomb : c.names.bombs}
              {r.void && <> + {c.name('void')}</>} · hands of {r.hand} · about {r.turnsEach} turns
              each
            </>
          ) : (
            `${MIN_PLAYERS} to ${MAX_SEATS} players can play.`
          )}
        </p>
      </Panel>

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
          <p className="text-xs text-ink-muted">
            Watching: {watching.map((w) => w.name).join(', ')}
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

      <details className="rounded-2xl bg-panel p-4 ring-1 ring-line">
        <summary className="cursor-pointer font-bold text-ink">Timing and house rules</summary>
        <div className="mt-3 space-y-3">
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
          <Toggle
            on={s.strict}
            editable={host && s.decisionSeconds !== null}
            title="Strict clock"
            help="At zero the game moves for whoever is slow: draws, hides at random, keeps the order or gives a random card. Off: the clock only reminds."
            onChange={(v) => set({ strict: v })}
          />
          <Toggle
            on={s.fiveCombo}
            editable={host}
            title="Five different cards (legacy)"
            help="Play five cards with different names to take any card from the discard pile."
            onChange={(v) => set({ fiveCombo: v })}
          />
          <Toggle
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

      <StickyBar>
        {host ? (
          <div className="space-y-1">
            <Button
              size="lg"
              className="w-full"
              disabled={!ok}
              onClick={() => void act({ type: 'start' }, { anchor: 'start' })}
              data-testid="start"
            >
              Start the game
            </Button>
            {!ok && (
              <p className="text-center text-xs text-ink-muted">
                Needs {MIN_PLAYERS} to {MAX_SEATS} seated players.
              </p>
            )}
          </div>
        ) : (
          <Hint>{waitingForHost(room)}</Hint>
        )}
      </StickyBar>
    </div>
  );
}

/**
 * Test servers only (the server says so in `rigAllowed`): fixes the next game's hands and the top
 * of the pile, as JSON `{ "hands": [["favor", …], …], "top": ["bomb", …], "first": 0 }`.
 */
function RigPanel({ act, rigged }: { act: Act; rigged: boolean }) {
  return (
    <details className="rounded-2xl bg-panel p-3 text-sm ring-1 ring-line" data-testid="rig">
      <summary className="cursor-pointer font-semibold text-ink">
        Test setup {rigged && '(armed)'}
      </summary>
      <form
        className="mt-2 space-y-2"
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
