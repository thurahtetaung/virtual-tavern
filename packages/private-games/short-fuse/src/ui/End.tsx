import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  EndHero,
  EndLayout,
  EndTabs,
  NameDot,
  Panel,
  StickyBar,
  Superlatives,
  cn,
  useWideScreen,
} from '@vt/ui';
import type { ReactNode } from 'react';
import type { ShortFuseAction, ShortFuseView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CardFace } from './Card.tsx';
import { sortHand } from './Hand.tsx';
import { who } from './text.ts';

type Act = (a: ShortFuseAction) => Promise<boolean>;

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** The end: who won, who went when, and everything that was hidden (hands, pile, hiding spots). */
export function End({
  view,
  room,
  c,
  act,
  seats,
}: {
  view: ShortFuseView;
  room: GameRoomInfo;
  c: Content;
  act: Act;
  /** The seats, which phones show as one of the end's tabs. */
  seats?: ReactNode;
}) {
  const wide = useWideScreen();
  const g = view.game!;
  const end = g.end!;
  const order = g.players
    .filter((p) => p.dead || p.left)
    .sort((a, b) => (a.deadTurn ?? 999) - (b.deadTurn ?? 999));
  const isBomb = (t: string) => t === 'bomb' || t === 'void';
  const nextBomb = end.pile.findIndex((x) => isBomb(x.t));
  // Who went when: under the result on every width.
  const winnerHand = (end.winner && end.hands[end.winner]) || [];
  const outOrder = order.length > 0 && (
    <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
      {order.map((p, i) => (
        <span key={p.id} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          <span className="inline-flex items-center gap-1">
            <span>
              {p.left ? '🚪' : p.ghost ? '👻' : '💥'} {p.name}
              {p.deadTurn ? ` (turn ${p.deadTurn})` : ''}
            </span>
            <NameDot name={p.name} className="order-first" />
          </span>
        </span>
      ))}
    </p>
  );
  const pileBlock = (
    <Panel className="space-y-2">
      <h3 className="font-bold text-ink">The pile that was left</h3>
      <p className="text-sm text-ink-muted">
        {end.pile.length} cards, top first.
        {nextBomb >= 0 &&
          ` The next ${c.names.bomb} was ${nextBomb === 0 ? 'right on top' : `${ordinal(nextBomb + 1)} from the top`}.`}
      </p>
      <ol className="flex flex-wrap gap-1" data-testid="end-pile">
        {end.pile.slice(0, 30).map((card) => (
          <li key={card.id}>
            <CardFace
              card={card}
              art={g.art}
              c={c}
              size="sm"
              className={cn(isBomb(card.t) && 'ring-[3px] ring-danger')}
            />
          </li>
        ))}
        {end.pile.length > 30 && (
          <li className="self-center text-xs text-ink-muted">+{end.pile.length - 30} more</li>
        )}
      </ol>
    </Panel>
  );
  const truthBlock = end.truth.length > 0 && (
    <Panel className="space-y-1">
      <h3 className="font-bold text-ink">Where things were hidden</h3>
      <ul className="space-y-0.5 text-sm text-ink">
        {end.truth.map((t, i) => (
          <li key={i}>
            Turn {t.turn}: {who(view, t.by, false)}{' '}
            {t.kind === 'bury' ? 'buried a card' : `put ${c.name(t.kind)}`}{' '}
            {t.position === 0
              ? 'on top'
              : t.position === t.of - 1
                ? 'at the bottom'
                : `${ordinal(t.position + 1)} from the top`}
            {t.drawnBy ? `, and ${who(view, t.drawnBy, false)} drew it.` : '.'}
          </li>
        ))}
      </ul>
    </Panel>
  );
  const stashBlock = end.stash.length > 0 && (
    <Panel className="space-y-2">
      <h3 className="font-bold text-ink">
        {c.name('vault')}: the Stash ({end.stash.length})
      </h3>
      <ul className="flex flex-wrap gap-1" data-testid="end-stash">
        {sortHand(end.stash).map((card) => (
          <li key={card.id}>
            <CardFace card={card} art={g.art} c={c} size="sm" />
          </li>
        ))}
      </ul>
    </Panel>
  );
  const handsBlock = (
    <Panel className="space-y-2">
      <h3 className="font-bold text-ink">Every hand</h3>
      {g.players.map((p) => {
        const hand = end.hands[p.id] ?? [];
        return (
          <div key={p.id}>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <span>
                {p.name} {p.ghost ? '👻' : p.dead ? '💥' : p.left ? '🚪' : ''}
              </span>
              <NameDot name={p.name} className="order-first" />
            </p>
            {hand.length ? (
              <ul className="mt-1 flex flex-wrap gap-1">
                {sortHand(hand).map((card) => (
                  <li key={card.id}>
                    <CardFace card={card} art={g.art} c={c} size="sm" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-muted">No cards.</p>
            )}
          </div>
        );
      })}
    </Panel>
  );
  const firstCard = sortHand(winnerHand)[0];
  return (
    <div className="space-y-3" data-testid="end">
      <EndLayout
        hero={
          <EndHero
            title={
              end.winner ? `${who(view, end.winner, false)} wins!` : 'Nobody is left standing.'
            }
            titleTestId="winner"
            // Phones: the winner's best card, large, in place of the emblem (wide screens show
            // the hand).
            emblem={
              !wide && firstCard ? (
                <CardFace card={firstCard} art={g.art} c={c} size="lg" className="mx-auto" />
              ) : end.winner ? (
                '🏆'
              ) : (
                '💥'
              )
            }
            tone={end.winner ? 'win' : 'loss'}
            superlatives={wide ? room.superlatives : undefined}
            art={
              // The winner's last cards, large: what they were holding when the dust settled.
              wide && winnerHand.length > 0
                ? sortHand(winnerHand)
                    .slice(0, 6)
                    .map((card) => (
                      <CardFace
                        key={card.id}
                        card={card}
                        art={g.art}
                        c={c}
                        size="md"
                        className="lg:w-[min(31%,9rem,11vh)]"
                      />
                    ))
                : undefined
            }
            actions={
              room.isHost && (
                <StickyBar>
                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    <Button
                      size="lg"
                      onClick={() => void act({ type: 'play-again' })}
                      data-testid="play-again"
                    >
                      Play again
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => void act({ type: 'back-to-lobby' })}
                    >
                      Change setup
                    </Button>
                  </div>
                </StickyBar>
              )
            }
          >
            {outOrder}
          </EndHero>
        }
      >
        {wide ? (
          // Wide screens: everything that was hidden, beside the finale.
          <div className="space-y-3">
            {handsBlock}
            {pileBlock}
            {truthBlock}
            {stashBlock}
          </div>
        ) : (
          // Phones: the awards, the pile, the hiding spots, the Stash, the hands and the seats one
          // at a time, so the end and Play again fit the screen.
          <EndTabs
            tabs={[
              !!room.superlatives?.length && {
                id: 'awards',
                label: '🏅 Awards',
                content: <Superlatives lines={room.superlatives} />,
              },
              { id: 'hands', label: '✋ Hands', content: handsBlock },
              { id: 'pile', label: '🂠 Pile', content: pileBlock },
              !!truthBlock && { id: 'hidden', label: '🔍 Hidden', content: truthBlock },
              !!stashBlock && { id: 'stash', label: `🏦 ${c.name('vault')}`, content: stashBlock },
              !!seats && { id: 'seats', label: '👥 Table', content: seats },
            ]}
          />
        )}
      </EndLayout>
    </div>
  );
}
