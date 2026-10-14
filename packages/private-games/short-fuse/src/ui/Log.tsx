import { cn } from '@vt/ui';
import { useState } from 'react';
import type { LogEntry, Memory, ShortFuseView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CardFace } from './Card.tsx';
import { an, logLine, who } from './text.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Filter = 'all' | 'plays' | 'nopes' | 'booms';

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['plays', 'Plays'],
  ['nopes', 'Nopes'],
  ['booms', 'Explosions'],
];

const matches = (f: Filter, e: LogEntry) =>
  f === 'all' ||
  (f === 'plays' &&
    (e.kind === 'play' ||
      e.kind === 'favor' ||
      e.kind === 'steal' ||
      e.kind === 'ask' ||
      e.kind === 'mark' ||
      e.kind === 'blind' ||
      e.kind === 'mine' ||
      e.kind === 'vault' ||
      e.kind === 'pooled' ||
      e.kind === 'stack' ||
      e.kind === 'swap' ||
      e.kind === 'fed' ||
      e.kind === 'dig' ||
      e.kind === 'seer')) ||
  (f === 'nopes' && (e.kind === 'nope' || e.kind === 'cancelled' || e.kind === 'resolved')) ||
  (f === 'booms' &&
    (e.kind === 'explode' ||
      e.kind === 'drew-bomb' ||
      e.kind === 'defuse' ||
      e.kind === 'placed' ||
      e.kind === 'bark' ||
      e.kind === 'received-bomb' ||
      e.kind === 'unprotected' ||
      e.kind === 'revive'));

/** The public log, newest first, with filters. */
export function Log({ view, c }: { view: ShortFuseView; c: Content }) {
  const [filter, setFilter] = useState<Filter>('all');
  const g = view.game!;
  const entries = g.log.filter((e) => matches(filter, e)).reverse();
  return (
    <section aria-label="Game log" className="space-y-2">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Show">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            onClick={() => setFilter(id)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-semibold ring-1',
              filter === id
                ? 'bg-accent-soft text-accent-text ring-accent-line'
                : 'bg-card text-ink-muted ring-line',
            )}
          >
            {id === 'nopes' ? c.name('nope') : label}
          </button>
        ))}
      </div>
      <ol className="space-y-1 text-sm" data-testid="log">
        {entries.map((e) => (
          <li
            key={e.id}
            className={cn(
              'rounded-lg px-2 py-1',
              e.kind === 'explode' ? 'bg-danger-soft text-danger-ink' : 'text-ink',
            )}
          >
            <span className="mr-1.5 text-[0.65rem] text-ink-muted">T{e.turn}</span>
            {logLine(view, c, e)}
          </li>
        ))}
        {entries.length === 0 && <li className="text-ink-muted">Nothing yet.</li>}
      </ol>
    </section>
  );
}

function MemoryItem({ m, view, c }: { m: Memory; view: ShortFuseView; c: Content }) {
  const g = view.game!;
  const turnsAgo = g.turn.n - m.turn;
  const when = turnsAgo <= 0 ? 'this turn' : turnsAgo === 1 ? 'last turn' : `${turnsAgo} turns ago`;
  if (m.kind === 'peek' || m.kind === 'altered') {
    const stale = m.version !== g.pile.version;
    return (
      <li className="rounded-xl bg-card p-2 ring-1 ring-line">
        <p className="text-xs font-semibold text-ink-muted">
          {m.kind === 'peek' ? 'You saw the top of the pile' : 'You rearranged the top'} ({when})
          {stale && <span className="ml-1 text-warn-ink">· the pile has changed since</span>}
        </p>
        <ol className={cn('mt-1 flex gap-1', stale && 'opacity-60')}>
          {m.cards.map((card, i) => (
            <li key={i}>
              <CardFace card={card} art={g.art} c={c} size="sm" />
            </li>
          ))}
        </ol>
      </li>
    );
  }
  if (m.kind === 'placed') {
    const where =
      m.position === 0
        ? 'on top'
        : m.position === m.of - 1
          ? 'at the bottom'
          : `${m.position + 1} of ${m.of}`;
    return (
      <li className="rounded-xl bg-card p-2 text-sm text-ink ring-1 ring-line">
        You put {c.name(m.t)} {where} ({when}).
      </li>
    );
  }
  if (m.kind === 'watched') {
    const where =
      m.position === 0
        ? 'on top'
        : m.position === m.of - 1
          ? 'at the bottom'
          : `${m.position + 1} of ${m.of}`;
    const stale = m.version !== g.pile.version;
    return (
      <li className="rounded-xl bg-card p-2 text-sm text-ink ring-1 ring-line">
        {c.glyph('seer')} You watched {who(view, m.other)} put {c.name(m.t)} {where} ({when}).
        {stale && <span className="ml-1 text-xs text-warn-ink">· the pile has changed since</span>}
      </li>
    );
  }
  if (m.kind === 'shared') {
    const stale = m.version !== g.pile.version;
    return (
      <li className="rounded-xl bg-card p-2 ring-1 ring-line">
        <p className="text-xs font-semibold text-ink-muted">
          {cap(who(view, m.other))} showed you the top of the pile ({when})
          {stale && <span className="ml-1 text-warn-ink">· the pile has changed since</span>}
        </p>
        <ol className={cn('mt-1 flex gap-1', stale && 'opacity-60')}>
          {m.cards.map((card, i) => (
            <li key={i}>
              <CardFace card={card} art={g.art} c={c} size="sm" />
            </li>
          ))}
        </ol>
      </li>
    );
  }
  const line =
    m.kind === 'held'
      ? c.t(`Your {c:shelter} is keeping ${an(c.name(m.card.t))} safe in your hand (${when}).`)
      : m.kind === 'pooled'
        ? `You put ${c.name(m.card.t)} ${m.how === 'potluck' ? 'on top of the pile' : 'into the pile'} (${when}).`
        : m.kind === 'lost'
          ? `You turned over ${c.name(m.card.t)} blindfolded: it was lost (${when}).`
          : (() => {
              const how = {
                favor: c.name('favor'),
                pair: 'a pair',
                triple: 'three of a kind',
                mine: c.name('mine'),
                stash: `the ${c.name('vault')}’s Stash`,
                feed: c.name('feed'),
              }[m.how];
              return m.kind === 'got'
                ? `You got ${c.name(m.card.t)} from ${who(view, m.other)} (${how}, ${when}).`
                : `You gave ${c.name(m.card.t)} to ${who(view, m.other)} (${how}, ${when}).`;
            })();
  return (
    <li className="flex items-center gap-2 rounded-xl bg-card p-2 text-sm text-ink ring-1 ring-line">
      <CardFace card={m.card} art={g.art} c={c} size="xs" />
      <span>{line}</span>
    </li>
  );
}

/** What only you know: peeks, where you hid things, cards that changed hands. */
export function MeTab({ view, c }: { view: ShortFuseView; c: Content }) {
  const g = view.game!;
  const list = [...g.memory].reverse();
  return (
    <section aria-label="What you know" className="space-y-2" data-testid="memory">
      <h3 className="font-bold text-ink">What only you know</h3>
      {list.length ? (
        <ul className="space-y-1.5">
          {list.map((m) => (
            <MemoryItem key={m.id} m={m} view={view} c={c} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">
          Nothing yet. Peeks, cards you swap and where you hide things show up here.
        </p>
      )}
    </section>
  );
}
