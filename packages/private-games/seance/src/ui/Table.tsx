import { Panel, cn } from '@vt/ui';
import { PILLARS } from '../logic/cards.ts';
import { levelThresholds } from '../logic/setup.ts';
import { HOURS, type GameView, type SeanceView } from '../logic/types.ts';
import { type Content, PILLAR_ICONS } from './assets.ts';
import { Avatar, Card } from './Card.tsx';
import { atTable, psychicByColor, roman } from './status.ts';

/** The seven hours, with the current one lit. */
export function Clock({ g }: { g: GameView }) {
  return (
    <ol aria-label={`Hour ${roman(g.hour)} of VII`} className="flex gap-1">
      {Array.from({ length: HOURS }, (_, i) => i + 1).map((h) => (
        <li
          key={h}
          aria-current={h === g.hour ? 'step' : undefined}
          className={cn(
            'flex h-7 min-w-7 flex-1 items-center justify-center rounded-md px-1 font-serif text-xs font-bold',
            h < g.hour
              ? 'bg-stone-300 text-ink-muted dark:bg-stone-700 dark:text-stone-400'
              : h === g.hour
                ? 'bg-special dark:bg-violet-700 text-white ring-2 ring-special-line dark:ring-violet-500'
                : 'bg-stone-100 text-ink-muted dark:bg-stone-800',
            h === HOURS && h !== g.hour && 'ring-1 ring-danger/60 dark:ring-rose-400/60',
          )}
        >
          {roman(h)}
        </li>
      ))}
    </ol>
  );
}

/** Each psychic's three cards: found ones face up, the rest as empty slots. */
export function Progress({
  g,
  content,
  showTargets = false,
  onOpen,
}: {
  g: GameView;
  content: Content;
  /** The ghost sees every target (the screen). */
  showTargets?: boolean;
  onOpen?: (kind: (typeof PILLARS)[number], n: number) => void;
}) {
  return (
    <ul className="space-y-2" aria-label="Progress">
      {atTable(g).map((p) => (
        <li key={p.color} className="flex items-center gap-2">
          <Avatar color={p.color} content={content} name={p.name} size="sm" />
          <span className="w-16 truncate text-sm font-semibold sm:w-24">{p.name}</span>
          <div className="grid flex-1 grid-cols-3 gap-1">
            {PILLARS.map((pillar, i) => {
              const found = p.found[i];
              const target = p.targets?.[i];
              const card = found ?? (showTargets ? target : undefined);
              return card !== undefined ? (
                <Card
                  key={pillar}
                  kind={pillar}
                  n={card}
                  content={content}
                  dimmed={found === undefined}
                  note={found !== undefined ? `${p.name} found it` : `${p.name}’s target`}
                  onTap={onOpen ? () => onOpen(pillar, card) : undefined}
                >
                  {found !== undefined && (
                    <span className="absolute right-0.5 bottom-0.5 rounded bg-success dark:bg-emerald-700 px-1 text-[10px] font-bold text-white">
                      ✓
                    </span>
                  )}
                </Card>
              ) : (
                <div
                  key={pillar}
                  aria-label={`${content.pillarName(pillar)} not found yet`}
                  className={cn(
                    'flex aspect-[1024/700] items-center justify-center rounded-lg border border-dashed text-lg',
                    i === p.step
                      ? 'border-special dark:border-violet-400 bg-special/10 dark:bg-violet-500/10'
                      : 'border-stone-300 opacity-60 dark:border-stone-700',
                  )}
                >
                  {PILLAR_ICONS[pillar]}
                </div>
              );
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The clairvoyance track: each psychic's level and the marks that unlock more of the final. */
export function Track({ g, content }: { g: GameView; content: Content }) {
  if (!g.clairvoyance) return null;
  const [mid, high] = levelThresholds(g.psychics.length + 1);
  const max = Math.max(high + 3, ...g.psychics.map((p) => p.level + 1));
  return (
    <div aria-label="Clairvoyance track" className="space-y-1">
      <div className="relative h-3 rounded-full bg-gradient-to-r from-stone-300 via-sky-300 to-violet-500 dark:from-stone-700 dark:via-sky-800 dark:to-violet-700">
        {[mid, high].map((t) => (
          <span
            key={t}
            className="absolute top-[-3px] h-[18px] w-0.5 bg-stone-800 dark:bg-stone-100"
            style={{ left: `${(t / max) * 100}%` }}
            title={`Level ${t}`}
          />
        ))}
        {atTable(g).map((p, i) => (
          <span
            key={p.color}
            title={`${p.name}: ${p.level}`}
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-stone-900"
            style={{
              left: `${(Math.min(p.level, max) / max) * 100}%`,
              backgroundColor: content.swatch(p.color),
              marginTop: `${(i % 2) * 4 - 2}px`,
            }}
          />
        ))}
      </div>
      <p className="flex justify-between text-[11px] text-ink-muted">
        <span>1 card</span>
        <span>
          {mid}+: 2 cards · {high}+: 3 cards
        </span>
      </p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {atTable(g).map((p) => (
          <li key={p.color} className="flex items-center gap-1">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: content.swatch(p.color) }}
            />
            {p.name}: <b>{p.level}</b>
            {g.tokensEach > 0 && (
              <span className="text-ink-muted">
                {' '}
                · {p.tokens} token{p.tokens === 1 ? '' : 's'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** This hour's (or the last hour's) verdicts, in plain words. */
export function Verdicts({ view, content }: { view: SeanceView; content: Content }) {
  const g = view.game!;
  const hour = g.verdicts.at(-1)?.hour;
  if (hour === undefined) return null;
  const list = g.verdicts.filter((v) => v.hour === hour);
  return (
    <div aria-label="Verdicts" className="space-y-1">
      <h4 className="text-sm font-semibold">Hour {roman(hour)}: the ghost answered</h4>
      <ul className="space-y-1 text-sm">
        {list.map((v) => {
          const p = psychicByColor(g, v.color);
          const pillar = PILLARS[v.step]!;
          return (
            <li key={v.color} className="flex items-center gap-2">
              <Avatar color={v.color} content={content} name={p?.name} size="sm" />
              <span className="flex-1">
                {p?.name ?? v.color}{' '}
                {v.guess === null
                  ? `made no ${content.pillarName(pillar).toLowerCase()} guess`
                  : v.correct
                    ? `found their ${content.pillarName(pillar).toLowerCase()}`
                    : `missed (${content.pillarName(pillar).toLowerCase()})`}
                {v.marks.length > 0 && (
                  <span className="text-xs text-ink-muted">
                    {' '}
                    ·{' '}
                    {v.marks
                      .map(
                        (m) =>
                          `${m.kind === 'yes' ? '✓' : '✗'} ${psychicByColor(g, m.by)?.name ?? m.by}`,
                      )
                      .join(', ')}
                  </span>
                )}
              </span>
              <span aria-hidden className="text-lg">
                {v.correct ? '✅' : '❌'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The Table tab: the clock, ravens, the track, everyone's progress and the last verdicts. */
export function TableTab({
  view,
  content,
  onOpen,
}: {
  view: SeanceView;
  content: Content;
  onOpen?: (kind: (typeof PILLARS)[number], n: number) => void;
}) {
  const g = view.game!;
  const ghost = g.myRole === 'ghost';
  return (
    <Panel className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">Hour {roman(g.hour)} of VII</h3>
        <p className="text-xs text-stone-600 dark:text-stone-400">
          🐦‍⬛ Ravens:{' '}
          {g.difficulty === 'easy'
            ? `1 per hour${g.ravenHour === g.hour ? ' (used)' : ''}`
            : `${g.ravensLeft} left`}{' '}
          · {g.deckCount} in the pile
        </p>
      </div>
      <Clock g={g} />
      <Track g={g} content={content} />
      <Progress g={g} content={content} showTargets={ghost} onOpen={onOpen} />
      <Verdicts view={view} content={content} />
    </Panel>
  );
}
