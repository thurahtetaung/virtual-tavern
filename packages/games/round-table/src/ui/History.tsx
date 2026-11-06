import { listNames } from '@vt/game-sdk';
import { Row, Rows, cn } from '@vt/ui';
import type { RoundTableView } from '../logic/types.ts';
import { SIDE_LABEL, SIDE_TEXT } from './Emblem.tsx';
import { nameOf, namesFor, who } from './status.ts';

/** Names, with ⏱ beside each one the timer or the host acted for (only known at the end). */
const marked = (view: RoundTableView, ids: readonly string[], auto: readonly string[] | null) =>
  listNames(ids.map((id) => (auto?.includes(id) ? `${who(view, id)} ⏱` : who(view, id))));

/** Every proposal and its votes, every quest's result and every Lady check, round by round. */
export function History({ view, shown }: { view: RoundTableView; shown: boolean }) {
  const g = view.game;
  if (!g) return null;
  const end = g.end;
  const rounds = [
    ...new Set([...g.proposals.map((p) => p.round), ...g.results.map((r) => r.round)]),
  ];
  // Who the timer or the host played for is only sent once the game is over.
  const anyAuto =
    g.proposals.some((p) => p.autoVotes?.length) || g.results.some((r) => r.autoPlayed?.length);
  return (
    <section aria-label="History" className="space-y-3">
      <h3 className="font-bold">📜 History</h3>
      {rounds.length === 0 && (
        <p className="text-small text-ink-muted">
          Nothing yet. Every team, every vote and every quest result will be listed here.
        </p>
      )}
      {anyAuto && (
        <p className="text-caption text-ink-muted" data-testid="history-auto-note">
          ⏱ The timer or the host played for them: an Approve vote, or a Success card on a quest.
        </p>
      )}
      {[...rounds].reverse().map((round) => {
        const result = g.results.find((r) => r.round === round);
        const checks = (end?.ladyChecks ?? g.lady?.checks ?? []).filter((c) => c.round === round);
        return (
          <div key={round} className="space-y-1.5 rounded-xl bg-card p-3 ring-1 ring-line">
            <p className="text-caption font-bold tracking-wide text-ink-muted uppercase">
              Round {round}
            </p>
            {result && (
              <p
                className={cn(
                  'text-small font-semibold',
                  result.success ? SIDE_TEXT.good : SIDE_TEXT.evil,
                )}
              >
                Quest {result.slot + 1} {result.success ? '✓ succeeded' : '✕ sunk'} · {result.fails}{' '}
                Fail {result.fails === 1 ? 'card' : 'cards'}
                <span className="font-normal text-ink-muted">
                  {' '}
                  · {marked(view, result.team, result.autoPlayed)}
                </span>
              </p>
            )}
            {checks.map((c) => {
              const loyalty =
                'loyalty' in c && (c.loyalty === 'good' || c.loyalty === 'evil') ? c.loyalty : null;
              // Your own check's answer is a secret until you peek.
              const mine =
                shown && g.lady?.mine.find((m) => m.round === c.round && c.holder === view.me?.id);
              const side = loyalty ?? (mine ? mine.loyalty : null);
              return (
                <p key={`lady-${c.round}`} className="text-small">
                  🌊 {who(view, c.holder, 'You')} checked {who(view, c.target)}
                  {side && (
                    <>
                      : <b className={SIDE_TEXT[side]}>{SIDE_LABEL[side]}</b>
                    </>
                  )}
                </p>
              );
            })}
            <Rows>
              {g.proposals
                .filter((p) => p.round === round)
                .reverse()
                .map((p) => {
                  const ids = Object.keys(p.votes);
                  const yes = ids.filter((id) => p.votes[id]);
                  const no = ids.filter((id) => !p.votes[id]);
                  return (
                    <Row key={p.attempt} className="block min-h-0 py-1.5 text-smallall">
                      <span className="font-semibold">
                        #{p.attempt} {nameOf(view, p.leader)} 👑 → quest {p.slot + 1}:
                      </span>{' '}
                      {namesFor(view, p.team)}{' '}
                      <span
                        className={cn(
                          'font-semibold',
                          p.approved ? SIDE_TEXT.good : SIDE_TEXT.evil,
                        )}
                      >
                        {p.approved ? 'approved' : 'rejected'}
                      </span>
                      <span className="block text-caption text-ink-muted">
                        For: {yes.length ? marked(view, yes, p.autoVotes) : 'nobody'} · Against:{' '}
                        {no.length ? namesFor(view, no) : 'nobody'}
                      </span>
                    </Row>
                  );
                })}
            </Rows>
          </div>
        );
      })}
    </section>
  );
}
