import { ProtectedImage, cn } from '@vt/ui';
import { boardFor, trackFor } from '../logic/tables.ts';
import {
  BLUE_TO_WIN,
  LEADER_ZONE,
  type Policy,
  type Power,
  RED_TO_WIN,
  TRACKER_MAX,
  VETO_ZONE,
} from '../logic/types.ts';
import type { GameView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { PolicyFace, TEAM_ICON } from './Cards.tsx';

export const POWER_EMOJI: Record<Power, string> = {
  investigate: '🔍',
  special: '🎩',
  peek: '👁️',
  execute: '🗡️',
};

/** One board, art first (with enacted policies laid in their slots), or a drawn board without art. */
export function Board({
  team,
  g,
  c,
  fresh,
  compact = false,
}: {
  team: Policy;
  g: GameView;
  c: Content;
  /** The slot index of a policy that has just landed (it flips in and glows). */
  fresh?: number | null;
  compact?: boolean;
}) {
  const n = g.players.length;
  const kind = team === 'blue' ? 'blue' : boardFor(n);
  const src = c.board(kind);
  // Where the slots and lamps sit on this edition's art (Hydra's own measurements by default).
  const geo = c.geometry[team];
  const lamps = team === 'blue' ? geo.lamps : undefined;
  const count = g.enacted[team];
  const track = trackFor(n);
  const danger = team === 'red' && g.enacted.red >= LEADER_ZONE;
  const label = c.t(
    `${c.teamName(team)} board: ${count} of ${team === 'blue' ? BLUE_TO_WIN : RED_TO_WIN} {policies}`,
  );
  if (!src) return <DrawnBoard team={team} g={g} c={c} fresh={fresh} compact={compact} />;
  return (
    <figure
      aria-label={label}
      className={cn('relative w-full overflow-hidden rounded-xl shadow-md', danger && 'hy-glow')}
      style={{ aspectRatio: `${geo.ratio}` }}
    >
      <ProtectedImage src={src} alt={label} className="absolute inset-0 h-full w-full" />
      {Array.from({ length: geo.slots }, (_, i) => {
        const filled = i < count;
        const power = team === 'red' ? track[i] : null;
        return (
          <span
            key={i}
            className="absolute flex items-center justify-center"
            style={{
              left: `${(geo.x0 + i * geo.pitch) * 100}%`,
              width: `${geo.pitch * 100}%`,
              top: `${geo.top * 100}%`,
              height: `${(geo.bottom - geo.top) * 100}%`,
            }}
          >
            {filled && (
              <span
                className={cn('block h-[88%]', fresh === i && 'hy-pop')}
                style={{ aspectRatio: '2 / 3' }}
              >
                <PolicyFace policy={team} c={c} className="h-full w-auto" />
              </span>
            )}
            {!filled && power && i === count && g.enacted.red === count && (
              <span className="sr-only">Next: {c.powerName(power)}</span>
            )}
          </span>
        );
      })}
      {lamps &&
        lamps.xs.map((x, i) =>
          i === g.tracker ? (
            <span
              key={i}
              aria-hidden
              className={cn(
                'absolute rounded-full bg-accent-line dark:bg-amber-300 ring-2 ring-white',
                g.tracker === TRACKER_MAX - 1 && 'hy-lamp bg-danger dark:bg-rose-500',
              )}
              style={{
                left: `${(x - lamps.size / 2) * 100}%`,
                top: `calc(${lamps.y * 100}% - ${(lamps.size / 2) * geo.ratio * 100}%)`,
                width: `${lamps.size * 100}%`,
                aspectRatio: '1',
              }}
            />
          ) : null,
        )}
      {team === 'red' && g.vetoUnlocked && <VetoRibbon c={c} />}
    </figure>
  );
}

function VetoRibbon({ c }: { c: Content }) {
  return (
    <span className="hy-ribbon pointer-events-none absolute top-[6%] right-[3%] rounded bg-accent-line dark:bg-amber-400 px-2 py-0.5 text-[0.6rem] font-black tracking-widest text-stone-950 uppercase shadow sm:text-xs">
      {c.copy('ribbon.veto')}
    </span>
  );
}

/** The boards without art: a row of slots with the powers written in. */
function DrawnBoard({
  team,
  g,
  c,
  fresh,
  compact,
}: {
  team: Policy;
  g: GameView;
  c: Content;
  fresh?: number | null;
  compact: boolean;
}) {
  const n = g.players.length;
  const slots = team === 'blue' ? BLUE_TO_WIN : RED_TO_WIN;
  const count = g.enacted[team];
  const track = trackFor(n);
  return (
    <figure
      aria-label={c.t(`${c.teamName(team)} board: ${count} of ${slots} {policies}`)}
      className={cn(
        'relative rounded-xl p-1.5 shadow-md ring-2',
        team === 'blue'
          ? 'bg-gradient-to-b from-sky-700 to-sky-900 ring-sky-950'
          : 'bg-gradient-to-b from-red-700 to-red-950 ring-red-950',
        team === 'red' && g.enacted.red >= LEADER_ZONE && 'hy-glow',
      )}
    >
      <figcaption className="mb-1 flex items-center justify-between px-1 text-[0.65rem] font-black tracking-widest text-white/90 uppercase">
        <span>{c.teamName(team)}</span>
        {team === 'blue' && <TrackerLamps tracker={g.tracker} />}
      </figcaption>
      <ol
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: slots }, (_, i) => {
          const power = team === 'red' ? track[i] : null;
          const last = i === slots - 1;
          return (
            <li
              key={i}
              className={cn(
                'relative flex items-center justify-center rounded-md bg-black/25 p-0.5 text-center',
                compact ? 'h-12 sm:h-14' : 'h-20 xl:h-24',
                team === 'red' &&
                  i >= LEADER_ZONE &&
                  'ring-1 ring-accent-line/40 dark:ring-amber-300/40',
              )}
            >
              {i < count ? (
                <span
                  className={cn('block h-full', fresh === i && 'hy-pop')}
                  style={{ aspectRatio: '2 / 3' }}
                >
                  <PolicyFace policy={team} c={c} className="h-full w-auto" />
                </span>
              ) : (
                <span className="text-[0.55rem] leading-tight text-white/80">
                  {last ? (
                    <span aria-label="win" className="text-lg">
                      {team === 'blue' ? '🕊️' : '☠️'}
                    </span>
                  ) : power ? (
                    <span title={c.powerName(power)}>
                      <span className="block text-base" aria-hidden>
                        {POWER_EMOJI[power]}
                      </span>
                      <span className={cn(compact && 'hidden sm:inline')}>
                        {c.powerName(power)}
                      </span>
                    </span>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {team === 'red' && g.vetoUnlocked && <VetoRibbon c={c} />}
    </figure>
  );
}

/** ●○○: failed governments in a row (the third enacts the top policy). */
export function TrackerLamps({ tracker, className }: { tracker: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`Election tracker: ${tracker} of ${TRACKER_MAX} failed`}
      className={cn('inline-flex items-center gap-1', className)}
    >
      {Array.from({ length: TRACKER_MAX }, (_, i) => (
        <span
          key={i}
          className={cn(
            'size-2.5 rounded-full ring-1',
            i < tracker
              ? tracker === TRACKER_MAX - 1
                ? 'hy-lamp bg-danger dark:bg-rose-500 ring-danger-line dark:ring-rose-300'
                : 'bg-accent-line dark:bg-amber-400 ring-accent-line dark:ring-amber-200'
              : 'bg-white/20 ring-white/50',
          )}
        />
      ))}
    </span>
  );
}

/** The header's mini tracks: 5 blue and 6 red pips, the next power, and the tracker. */
export function MiniTracks({ g, c }: { g: GameView; c: Content }) {
  const track = trackFor(g.players.length);
  const next = g.enacted.red < RED_TO_WIN ? track[g.enacted.red] : null;
  return (
    <div className="flex min-w-0 items-center gap-1.5" aria-label={c.t('{Policies} on the boards')}>
      <span
        className="flex items-center gap-0.5"
        role="img"
        aria-label={`${c.teamName('blue')}: ${g.enacted.blue} of ${BLUE_TO_WIN}`}
      >
        <Glyph>{TEAM_ICON.blue}</Glyph>
        {Array.from({ length: BLUE_TO_WIN }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-4 w-2 rounded-[2px] ring-1',
              i < g.enacted.blue ? 'bg-sky-500 ring-sky-300' : 'bg-sky-950/40 ring-sky-400/40',
            )}
          />
        ))}
      </span>
      <span
        className="flex items-center gap-0.5"
        role="img"
        aria-label={`${c.teamName('red')}: ${g.enacted.red} of ${RED_TO_WIN}${next ? `, next: ${c.powerName(next)}` : ''}`}
      >
        <Glyph>{TEAM_ICON.red}</Glyph>
        {Array.from({ length: RED_TO_WIN }, (_, i) => (
          <span
            key={i}
            className={cn(
              'flex h-4 w-2 items-center justify-center rounded-[2px] text-[0.5rem] ring-1',
              i < g.enacted.red
                ? 'bg-red-500 ring-red-300'
                : i >= LEADER_ZONE
                  ? 'bg-red-950/50 ring-accent/60 dark:ring-amber-400/60'
                  : 'bg-red-950/40 ring-red-400/40',
            )}
          />
        ))}
        {next && (
          <span
            className="ml-0.5 text-xs"
            aria-hidden
            title={c.t(`Next {redPolicy} {policy}: ${c.powerName(next)}`)}
          >
            {POWER_EMOJI[next]}
          </span>
        )}
      </span>
      <span className="flex items-center gap-0.5">
        <Glyph>🗳️</Glyph>
        <TrackerLamps tracker={g.tracker} />
      </span>
    </div>
  );
}

/** A tiny mark before each group on the header strip, so it reads at a glance. */
function Glyph({ children }: { children: string }) {
  return (
    <span aria-hidden className="mr-px text-[0.65rem] leading-none">
      {children}
    </span>
  );
}

/** What the header strip means, with this game's counts: opened by tapping the strip. */
export function ScoreLegend({ g, c, onClose }: { g: GameView; c: Content; onClose: () => void }) {
  const track = trackFor(g.players.length);
  const next = g.enacted.red < RED_TO_WIN ? track[g.enacted.red] : null;
  const row = (glyph: string, text: string) => (
    <li className="flex gap-2">
      <span aria-hidden className="w-5 shrink-0 text-center">
        {glyph}
      </span>
      <span>{text}</span>
    </li>
  );
  return (
    <section
      aria-label={c.copy('legend.title')}
      className="hy-rise rounded-2xl bg-white p-3 text-sm shadow-md ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700"
      data-testid="score-legend"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="font-bold">{c.copy('legend.title')}</h3>
        <button
          type="button"
          className="min-h-8 rounded-full px-2 text-xs font-semibold ring-1 ring-stone-300 dark:ring-stone-600"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <ul className="space-y-1">
        {row(TEAM_ICON.blue, c.copy('legend.blue', { n: g.enacted.blue, of: BLUE_TO_WIN }))}
        {row(
          TEAM_ICON.red,
          c.copy('legend.red', { n: g.enacted.red, of: RED_TO_WIN, zone: LEADER_ZONE }),
        )}
        {row(
          next ? POWER_EMOJI[next] : '·',
          next ? c.copy('legend.next', { power: c.powerName(next) }) : c.copy('legend.nextNone'),
        )}
        {row('🗳️', c.copy('legend.tracker', { n: g.tracker, of: TRACKER_MAX }))}
      </ul>
    </section>
  );
}

/** "Deck 8 · Discard 6 · Unplayed: 3 blue / 8 red": all public, as at a real table. */
export function DeckChip({ g, c, className }: { g: GameView; c: Content; className?: string }) {
  const blue = g.totalBlue - g.enacted.blue;
  const red = g.total - g.totalBlue - g.enacted.red;
  return (
    <p
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-full bg-stone-200/80 px-3 py-1 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-300',
        className,
      )}
      data-testid="deck-chip"
    >
      <span>🂠 Deck {g.deckCount}</span>
      <span aria-hidden>·</span>
      <span>Discard {g.discardCount}</span>
      <span aria-hidden>·</span>
      <span>
        Unplayed:{' '}
        <span className="text-sky-700 dark:text-sky-300">
          {blue} {c.policyName('blue')}
        </span>{' '}
        /{' '}
        <span className="text-red-700 dark:text-red-400">
          {red} {c.policyName('red')}
        </span>
      </span>
    </p>
  );
}

export { VETO_ZONE };
