import { cn } from '@vt/ui';
import { useState } from 'react';
import { type Flag, type FlagKind, claimFlags } from '../logic/claims.ts';
import type { HydraView, Round } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { POWER_EMOJI } from './Boards.tsx';
import { Pips } from './Cards.tsx';
import { ClaimLine } from './Claims.tsx';
import { Sheet } from './Secret.tsx';
import type { Notes, Suspicions } from './storage.ts';
import { nameOf } from './status.ts';

type Filter = 'all' | 'claims' | 'votes';

const FLAG_TEXT: Record<FlagKind, string> = {
  'government-mismatch':
    'The two claims can’t both be true: the President’s three can’t leave the Chancellor these two.',
  'chancellor-vs-enacted': 'The Chancellor’s claim doesn’t match the policy that came out.',
  'president-vs-enacted': 'The President’s claim doesn’t match the policy that came out.',
  'peek-mismatch': 'This draw doesn’t match the earlier peek claim.',
};

function VoteLine({ view, c, r }: { view: HydraView; c: Content; r: Round }) {
  const ids = Object.keys(r.votes);
  const yes = ids.filter((p) => r.votes[p] === 'yes');
  const no = ids.filter((p) => r.votes[p] === 'no');
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div>
        <p className="font-bold">
          {c.ballotName('yes')} · {yes.length}
        </p>
        <p className="text-stone-600 dark:text-stone-400">
          {yes.map((p) => nameOf(view, p)).join(', ') || '—'}
        </p>
      </div>
      <div>
        <p className="font-bold">
          {c.ballotName('no')} · {no.length}
        </p>
        <p className="text-stone-600 dark:text-stone-400">
          {no.map((p) => nameOf(view, p)).join(', ') || '—'}
        </p>
      </div>
      {r.missing.length > 0 && (
        <p className="col-span-2 text-stone-500">
          Not counted: {r.missing.map((p) => nameOf(view, p)).join(', ')}
        </p>
      )}
    </div>
  );
}

/** The round-by-round timeline, with claims inline and flags where claims can't all be true. */
export function Timeline({ view, c }: { view: HydraView; c: Content }) {
  const g = view.game!;
  const [filter, setFilter] = useState<Filter>('all');
  const flags = g.flags ? claimFlags(g.rounds) : [];
  const flagsAt = (n: number): Flag[] => flags.filter((f) => f.round === n);
  const rounds = [...g.rounds]
    .reverse()
    .filter((r) =>
      filter === 'claims'
        ? r.claims.length > 0 || (r === g.rounds.at(-1) && g.needs.length > 0)
        : filter === 'votes'
          ? r.elected !== null
          : true,
    );
  return (
    <section aria-label="Timeline" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">📜 Timeline</h3>
        <div className="flex gap-1" role="group" aria-label="Show">
          {(['all', 'claims', 'votes'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'min-h-8 rounded-full px-2.5 text-xs font-semibold ring-1',
                filter === f
                  ? 'bg-amber-500 text-white ring-amber-600 dark:text-stone-950'
                  : 'ring-stone-300 dark:ring-stone-700',
              )}
            >
              {f === 'all' ? 'All' : f === 'claims' ? 'Claims' : 'Votes'}
            </button>
          ))}
        </div>
      </div>
      {!rounds.length && (
        <p className="text-sm text-stone-500">Nothing yet: the first government is being formed.</p>
      )}
      <ol className="space-y-2">
        {rounds.map((r) => {
          const pending = r === g.rounds.at(-1) && view.stage === 'claim' ? g.needs : [];
          const yes = Object.values(r.votes).filter((b) => b === 'yes').length;
          const no = Object.values(r.votes).length - yes;
          return (
            <li
              key={r.n}
              className="rounded-xl bg-white p-2.5 text-sm shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800"
              data-testid="round"
            >
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-xs font-bold text-stone-500">#{r.n}</span>
                <b>{nameOf(view, r.president)}</b>
                {r.special && (
                  <span className="rounded bg-violet-600 px-1 text-[0.6rem] font-bold text-white">
                    SPECIAL
                  </span>
                )}
                <span aria-hidden>➜</span>
                <b>{nameOf(view, r.chancellor)}</b>
                {r.elected !== null && (
                  <span
                    className={cn(
                      'rounded px-1.5 text-[0.65rem] font-black tracking-wide',
                      r.elected ? 'bg-emerald-600 text-white' : 'bg-stone-700 text-white',
                    )}
                  >
                    {r.elected ? 'ELECTED' : 'REJECTED'} {yes}–{no}
                  </span>
                )}
                {r.cleared && (
                  <span className="rounded bg-emerald-100 px-1 text-[0.65rem] font-bold text-emerald-900">
                    Not {c.roleName('leader')} ✓
                  </span>
                )}
              </p>
              {filter !== 'claims' &&
                r.elected !== null &&
                (filter === 'votes' || r.elected === false) && (
                  <div className="mt-1.5">
                    <VoteLine view={view} c={c} r={r} />
                  </div>
                )}
              {filter !== 'votes' && (
                <ul className="mt-1 space-y-0.5">
                  {r.session && (
                    <li>
                      {r.session.vetoed ? (
                        <span>✂️ Vetoed: both policies discarded</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          Enacted <Pips cards={[r.session.enacted!]} c={c} />
                          <span className="text-xs text-stone-500">
                            (the Chancellor’s two were shuffled)
                          </span>
                        </span>
                      )}
                    </li>
                  )}
                  {r.chaos && (
                    <li className="inline-flex items-center gap-1">
                      🌪️ Chaos: the people enacted <Pips cards={[r.chaos]} c={c} />
                    </li>
                  )}
                  {r.claims.map((cl) => (
                    <li key={`${cl.by}:${cl.kind}`}>
                      <ClaimLine view={view} c={c} claim={cl} />
                    </li>
                  ))}
                  {pending.map((n) => (
                    <li key={`${n.by}:${n.kind}`} className="text-stone-500 italic">
                      {nameOf(view, n.by)} ({n.kind === 'chancellor' ? 'Chancellor' : 'President'})
                      is choosing a claim…
                    </li>
                  ))}
                  {flagsAt(r.n).map((f) => (
                    <li
                      key={f.kind}
                      className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-950 ring-1 ring-amber-300 dark:bg-amber-500/10 dark:text-amber-100"
                    >
                      ⚠ Doesn’t add up: {FLAG_TEXT[f.kind]}
                    </li>
                  ))}
                  {r.power && (
                    <li>
                      {POWER_EMOJI[r.power.kind]} {nameOf(view, r.president)}:{' '}
                      {r.power.kind === 'investigate'
                        ? `investigated ${nameOf(view, r.power.target)}`
                        : r.power.kind === 'special'
                          ? `called a special election for ${nameOf(view, r.power.target)}`
                          : r.power.kind === 'execute'
                            ? `executed ${nameOf(view, r.power.target)}`
                            : 'peeked at the top three'}
                      {r.power.auto && (
                        <span className="text-xs text-stone-500"> (picked for them)</span>
                      )}
                    </li>
                  )}
                  {r.autos.map((a, i) => (
                    <li key={i} className="text-xs text-stone-500">
                      ⏱ {a.what} played for {nameOf(view, a.who)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A player's record: every vote they cast and what that government did, plus your notes. */
export function PlayerRecord({
  view,
  c,
  id,
  onClose,
  marks,
  onMark,
  notes,
  setNote,
}: {
  view: HydraView;
  c: Content;
  id: string | null;
  onClose: () => void;
  marks: Suspicions;
  onMark: (id: string) => void;
  notes: Notes;
  setNote: (id: string, text: string) => void;
}) {
  const g = view.game;
  if (!g || !id) return null;
  const rows = g.rounds.filter((r) => r.votes[id]);
  const mark = marks[id];
  return (
    <Sheet open onClose={onClose} title={nameOf(view, id)}>
      <div className="space-y-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span>Your private mark:</span>
          <button
            type="button"
            className="min-h-10 rounded-full px-3 font-semibold ring-1 ring-stone-300 dark:ring-stone-600"
            onClick={() => onMark(id)}
          >
            {mark === 'trust' ? '⭐ Trusted' : mark === 'doubt' ? '✕ Suspected' : '☆ No mark'}
          </button>
        </div>
        <label className="block">
          <span className="font-semibold">Your notes (only on this device)</span>
          <textarea
            className="mt-1 min-h-20 w-full rounded-lg bg-white p-2 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
            value={notes[id] ?? ''}
            maxLength={280}
            placeholder="Claimed RRB in round 3 but…"
            onChange={(e) => setNote(id, e.target.value)}
          />
        </label>
        <div>
          <p className="mb-1 font-semibold">Voting record</p>
          {!rows.length ? (
            <p className="text-stone-500">No votes yet.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-stone-500">
                <tr>
                  <th className="py-1">#</th>
                  <th>Government</th>
                  <th>Vote</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.n} className="border-t border-stone-200 dark:border-stone-800">
                    <td className="py-1">{r.n}</td>
                    <td>
                      {nameOf(view, r.president)} + {nameOf(view, r.chancellor)}
                    </td>
                    <td className="font-bold">{c.ballotName(r.votes[id]!)}</td>
                    <td>
                      {r.elected === false ? (
                        'rejected'
                      ) : r.session?.vetoed ? (
                        'vetoed'
                      ) : r.session?.enacted ? (
                        <Pips cards={[r.session.enacted]} c={c} />
                      ) : (
                        '…'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Sheet>
  );
}
