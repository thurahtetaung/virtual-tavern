import type { GameRoomInfo } from '@vt/game-sdk';
import { Button } from '@vt/ui';
import { Poster, PosterClock, PosterOverlay, PosterSlate } from '@vt/ui/show';
import { useEffect } from 'react';
import { eventText } from '../logic/names.ts';
import type { InquestView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { orderOf } from './Scene.tsx';
import { accuserOf, nameOf, resultLine, statusFor } from './status.ts';
import { suspectsOf } from './Suspects.tsx';

/**
 * A watcher's shared screen at an in-person table, on the table-screen poster: who is on (and
 * their clock), each tile's bulleted item and its place in the order, the event, and the
 * suspects' names. What reads across a room only: the six items of each tile, the bullet
 * timeline and the cards stay on the phones. It only uses a watcher's view, which carries
 * nothing private.
 */
export function TableScreen({
  view,
  room,
  content,
  onExit,
}: {
  view: InquestView;
  room: GameRoomInfo;
  content: Content;
  onExit: () => void;
}) {
  const g = view.game!;
  const p = g.present;
  const speaker = g.stage === 'present' && p ? p.order[p.index] : null;
  const f = g.final;
  const accuser = accuserOf(g);
  const newest = g.bullets.at(-1);
  const suspects = suspectsOf(g);
  const ev = g.event;
  const night = g.stage === 'night';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onExit]);

  const headline = speaker
    ? `🎙️ ${nameOf(view, speaker)} is presenting`
    : accuser
      ? `⚖️ Final accusations: ${nameOf(view, accuser)} is accusing…`
      : g.stage === 'discuss'
        ? '💬 Discussion: talk over the new bullets'
        : night
          ? 'Night falls…'
          : statusFor(view, false, room).text;
  const deadline = night
    ? g.deadline
    : g.stage === 'discuss'
      ? g.deadline
      : accuser && f
        ? f.deadline
        : speaker && p
          ? p.deadline
          : null;

  return (
    <PosterOverlay>
      <Poster
        label="Table screen"
        meta={
          accuser && f
            ? `${f.index + 1} of ${f.order.length}`
            : `Round ${g.round} of ${g.finalRound}${g.countdown && g.stage !== 'done' ? ' · last round' : ''}`
        }
        corner={
          <Button variant="secondary" size="lg" className="text-[24px]" onClick={onExit}>
            Leave table screen
          </Button>
        }
        eyebrow={`🔬 Forensic Scientist: ${nameOf(view, g.fs)}`}
        headline={headline}
        line={
          night
            ? 'The Murderer is choosing the crime.'
            : !g.slots.length
              ? `${nameOf(view, g.fs)} is laying out the tiles.`
              : ev
                ? `⚡ ${content.eventName(ev.kind)}: ${eventText(ev.kind, view.settings)}`
                : undefined
        }
        clock={
          deadline !== null && deadline !== undefined ? (
            <PosterClock deadline={deadline} clockOffset={room.clockOffset} />
          ) : undefined
        }
        choices={
          night
            ? undefined
            : g.slots.map((s, i) => {
                const fresh =
                  g.stage === 'discuss'
                    ? g.bullets.findLast((b) => b.slot === i && b.tile === s.tile)?.round ===
                      g.round
                    : newest?.slot === i && newest.tile === s.tile;
                const order = orderOf(g, i);
                return (
                  <PosterSlate
                    key={`${i}-${s.tile}`}
                    state={fresh ? 'on' : 'open'}
                    className="w-[260px] content-start gap-2"
                    testId={`inquest-tv-tile-${i}`}
                  >
                    <span className="block text-[24px] tracking-wide text-ink-muted uppercase">
                      {content.tileTitle(s.tile)}
                    </span>
                    <span className="block text-[32px] font-bold text-balance text-ink">
                      {s.bullet === null || s.bullet === undefined
                        ? '–'
                        : content.tileItem(s.tile, s.bullet)}
                    </span>
                    {order !== null && order !== undefined && (
                      <span className="block text-[24px] text-ink-muted">bullet {order}</span>
                    )}
                  </PosterSlate>
                );
              })
        }
        footer={{
          icon: 'users',
          text: suspects
            .map(
              (s) =>
                `${s.name}${s.id === speaker ? ' 🎙️' : ''}${s.id === accuser ? ' ⚖️' : ''}${s.badges <= 0 ? ' (attempt used)' : ''}`,
            )
            .join(' · '),
        }}
        footerEnd={{ icon: 'tv', text: 'The suspects’ cards are on the phones.' }}
      />
    </PosterOverlay>
  );
}

/**
 * The table screen once the case ends: the result at poster size and who was who (names and
 * roles only; the crime's cards stay on the phones, as during play).
 */
export function TableEndScreen({
  view,
  content,
  onExit,
}: {
  view: InquestView;
  content: Content;
  onExit: () => void;
}) {
  const g = view.game!;
  const r = g.result!;
  const roles = g.roles ?? {};
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onExit]);
  return (
    <PosterOverlay>
      <Poster
        label="Table screen"
        meta="Game over"
        corner={
          <Button variant="secondary" size="lg" className="text-[24px]" onClick={onExit}>
            Leave table screen
          </Button>
        }
        eyebrow={r.winner === 'investigators' ? '🕵️ Case closed' : '🩸 The culprits got away'}
        headline={
          <span data-testid="inquest-tv-winner">
            {r.winner === 'investigators' ? 'The Investigators win' : 'The Murderer’s side wins'}
          </span>
        }
        line={resultLine(view)}
        choices={g.players.map((p) => (
          <PosterSlate
            key={p.id}
            state={r.winners.includes(p.id) ? 'won' : 'open'}
            className="w-[240px] content-start gap-1"
          >
            <span className="block text-[32px] font-bold text-balance">{p.name}</span>
            <span className="block text-[24px] text-ink-muted">
              {content.roleName(roles[p.id]!)}
            </span>
          </PosterSlate>
        ))}
        footer={{ icon: 'tv', text: 'The crime, the attempts and the bullets are on the phones.' }}
      />
    </PosterOverlay>
  );
}
