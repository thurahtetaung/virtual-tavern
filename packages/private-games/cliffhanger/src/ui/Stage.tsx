import { ProtectedImage, cn } from '@vt/ui';
import { FULL_VOLUMES } from '@vt/ui/sound';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Card } from '../logic/content.ts';
import { goalLine, nounOf } from '../logic/genres.ts';
import { OPENING_MS, type CliffhangerView, TEAMS, type TeamId } from '../logic/types.ts';
import { ArtContext, useArt, useLoadedArt } from './assets.ts';
import type { CliffhangerUiProps } from './CliffhangerGame.tsx';
import { MomentOverlay } from './MomentOverlay.tsx';
import { atMatchPoint } from './moments.ts';
import {
  ClockBar,
  CliffhangerStyles,
  GenreRace,
  StyleName,
  TEAM_EMOJI,
  Tape,
  nameOf,
  teamName,
} from './parts.tsx';
import { Bays, CategoryCard } from './Play.tsx';
import { statusFor } from './status.ts';
import { useSound } from './useSound.ts';

// The table screen: the room's big picture for a TV. It never shows a card that is being
// described (the view it gets is the table's, which has none), only what the whole table may see:
// the face-off's category and who is on the clock, each answer landing, the describing turn's
// clock and its squares filling, tapes sliding into their genres, steals, match point and the win.
// Built from the manifest's art and CSS motion; plain tapes and emoji without it.

/** How long a tape sliding in, or a steal, stays up. */
const NEWS_MS = 3500;

interface News {
  key: string;
  team: TeamId;
  card: Card;
  steal: boolean;
}

/** The latest tape to join a collection (or be taken by a steal), while it is fresh. */
function useNews(view: CliffhangerView): News | null {
  const counts = useRef<Record<TeamId, number> | null>(null);
  const steals = useRef<number | null>(null);
  const [news, setNews] = useState<News | null>(null);
  const r = view.round;
  useEffect(() => {
    const now = { a: view.collections.a.length, b: view.collections.b.length };
    const s = r?.steals.length ?? 0;
    const before = counts.current;
    const stealsBefore = steals.current;
    counts.current = now;
    steals.current = s;
    if (!before || view.phase === 'lobby') return;
    if (stealsBefore !== null && s > stealsBefore && r) {
      const st = r.steals[s - 1]!;
      setNews({ key: `steal:${r.number}:${s}`, team: st.team, card: st.took, steal: true });
      return;
    }
    for (const t of TEAMS) {
      if (now[t] > before[t]) {
        const card = view.collections[t][now[t] - 1]!;
        setNews({ key: `tape:${card.id}`, team: t, card, steal: false });
      }
    }
  }, [view.collections, r, view.phase]);
  useEffect(() => {
    if (!news) return;
    const id = setTimeout(() => setNews(null), NEWS_MS);
    return () => {
      clearTimeout(id);
    };
  }, [news]);
  return news;
}

function Seat({
  view,
  id,
  on,
  team,
}: {
  view: CliffhangerView;
  id: string;
  on: boolean;
  team: TeamId;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-3xl px-6 py-4 transition',
        on
          ? 'scale-105 bg-card shadow-2xl ring-4 ring-accent dark:bg-stone-800 dark:ring-amber-400'
          : 'opacity-70', // vt-palette
      )}
      data-testid={`stage-seat-${team}`}
    >
      <span className="text-5xl" aria-hidden>
        {TEAM_EMOJI[team]}
      </span>
      <span className="text-4xl font-black">{nameOf(view, id)}</span>
      <span className="text-xl text-ink-muted">{teamName(team)}</span>
      {on && <span className="cl-pop text-2xl font-bold">on the clock</span>}
    </div>
  );
}

function FaceOffScreen({ view, clockOffset }: { view: CliffhangerView; clockOffset: number }) {
  const r = view.round!;
  const fo = r.faceoff!;
  const art = useArt();
  const total =
    fo.answers === 0 && view.settings.openingClock
      ? OPENING_MS
      : view.settings.answerSeconds * 1000;
  const press = art.app('pressReset');
  return (
    <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-8">
      <Seat
        view={view}
        id={r.pair.a}
        on={fo.on === r.pair.a || (fo.on === null && !fo.paused)}
        team="a"
      />
      <div className="flex flex-col items-center gap-4">
        {r.category && <CategoryCard text={r.category.text} big className="h-[52vh]" />}
        {fo.answers > 0 && fo.last && (
          <div
            key={`${fo.answers}:${fo.last}`}
            className="cl-pop flex items-center gap-3 text-3xl font-black"
            data-testid="stage-press"
          >
            {press && <ProtectedImage src={press} alt="" className="h-16 w-auto" />}
            <span>{nameOf(view, fo.last)} said one!</span>
            <span className="rounded-full bg-accent-soft px-3 py-1 tabular-nums dark:bg-amber-500/20">
              × {fo.answers}
            </span>
          </div>
        )}
        {fo.paused && <p className="text-3xl font-bold">⏸ Is that one right? The table decides.</p>}
      </div>
      <Seat
        view={view}
        id={r.pair.b}
        on={fo.on === r.pair.b || (fo.on === null && !fo.paused)}
        team="b"
      />
      <div className="col-span-3">
        <ClockBar
          deadline={fo.paused ? null : fo.deadline}
          total={total}
          clockOffset={clockOffset}
          paused={fo.paused ? fo.paused.left : undefined}
          big
          label={
            <span className="text-2xl">{fo.answers === 0 ? 'Opening clock' : 'Answer clock'}</span>
          }
        />
      </div>
    </div>
  );
}

function TurnScreen({ view, clockOffset }: { view: CliffhangerView; clockOffset: number }) {
  const r = view.round!;
  const t = r.turn!;
  const styles = r.styles;
  return (
    <div className="flex h-full flex-col justify-center gap-8">
      <div className="text-center">
        <p className="text-3xl text-ink-muted">
          {TEAM_EMOJI[t.team]} {teamName(t.team)}
        </p>
        <p className="text-6xl font-black">{nameOf(view, t.describer)} is describing</p>
        {t.stealOpen && (
          <p className="cl-pop mt-2 text-4xl font-black">
            All three! Now stealing the other side’s…
          </p>
        )}
      </div>
      <div className="mx-auto w-full max-w-5xl">
        <Bays
          view={view}
          team={t.stealOpen ? (t.team === 'a' ? 'b' : 'a') : t.team}
          size="h-[34vh]"
        />
        {styles.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-2xl">
            {styles.map((s, i) => (
              <StyleName key={i} style={s} />
            ))}
          </div>
        )}
      </div>
      <div className="mx-auto w-full max-w-5xl">
        <ClockBar
          deadline={t.endsAt}
          total={view.settings.turnSeconds * 1000}
          clockOffset={clockOffset}
          big
          label={<span className="text-2xl">Describing</span>}
        />
      </div>
    </div>
  );
}

function Message({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-6xl font-black">{children}</p>
      {sub && <p className="text-3xl text-ink-muted">{sub}</p>}
    </div>
  );
}

function RoundScreen({ view, clockOffset }: { view: CliffhangerView; clockOffset: number }) {
  const r = view.round!;
  const art = useArt();
  const nouns = nounOf(view.settings.deck, true);
  switch (r.stage) {
    case 'pick-category':
      return (
        <Message sub="The team that’s behind picks the face-off category.">
          {nameOf(view, r.pick?.by)} is picking…
        </Message>
      );
    case 'countdown':
      if (r.after === 'faceoff') {
        const title = art.app('roundTitle') ?? art.app('faceoffTitle');
        return (
          <div className="flex h-full flex-col items-center justify-center gap-6">
            {title && <ProtectedImage src={title} alt="" className="max-h-[30vh] w-auto" />}
            <p className="text-5xl font-black">Round {r.number}: face-off</p>
            <p className="text-4xl">
              {TEAM_EMOJI.a} {nameOf(view, r.pair.a)} vs {nameOf(view, r.pair.b)} {TEAM_EMOJI.b}
            </p>
            {r.category && <CategoryCard text={r.category.text} big className="h-[36vh]" />}
          </div>
        );
      }
      return (
        <Message sub="Get ready to shout!">
          {statusFor(view, { you: '', hostId: '', isHost: false, players: [] }).text}
        </Message>
      );
    case 'faceoff':
      return <FaceOffScreen view={view} clockOffset={clockOffset} />;
    case 'keep':
      return (
        <Message sub={`Choosing their ${nouns}…`}>
          {r.faceoffResult
            ? `${nameOf(view, r.faceoffResult.winner)} wins the face-off!`
            : 'Face-off over'}
        </Message>
      );
    case 'turn':
      return <TurnScreen view={view} clockOffset={clockOffset} />;
    case 'recap': {
      const last = r.results.at(-1);
      return (
        <Message sub={last ? recapLine(last.got) : undefined}>
          {last ? `${TEAM_EMOJI[last.team]} ${teamName(last.team)}’s turn is over` : 'Turn over'}
        </Message>
      );
    }
    case 'steal':
      return (
        <Message sub="Three of a genre for one of the other side’s.">
          {r.steal ? `${TEAM_EMOJI[r.steal.team]} ${teamName(r.steal.team)} may trade` : 'Trading…'}
        </Message>
      );
  }
}

function Finale({ view }: { view: CliffhangerView }) {
  const w = view.winner;
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-8"
      data-testid="stage-finale"
    >
      <p className="cl-pop text-[14vh] leading-none" aria-hidden>
        🏆{w ? TEAM_EMOJI[w] : ''}
      </p>
      <p className="cl-rise text-7xl font-black">
        {w ? `${teamName(w)} win!` : 'No winner this time'}
      </p>
      {w && (
        <ul className="cl-rise flex max-w-[90vw] flex-wrap justify-center gap-2">
          {view.collections[w].map((c) => (
            <li key={c.id}>
              <Tape card={c} deck={view.settings.deck} className="h-[22vh]" full />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewsBanner({ news, view }: { news: News; view: CliffhangerView }) {
  return (
    <div
      key={news.key}
      className="cl-slide pointer-events-none fixed right-8 bottom-8 z-30 flex items-center gap-4 rounded-3xl bg-card p-4 shadow-2xl ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
      data-testid="stage-news"
    >
      <Tape card={news.card} deck={view.settings.deck} className="h-40" got={news.team} />
      <div>
        <p className="text-2xl font-black">
          {TEAM_EMOJI[news.team]} {teamName(news.team)}
        </p>
        <p className="text-xl">
          {news.steal ? 'Traded three for this one!' : 'Into the collection'}
        </p>
      </div>
    </div>
  );
}

function StageScreen({ view, room }: CliffhangerUiProps) {
  const art = useArt();
  const news = useNews(view);
  useSound({
    view,
    manifest: art.manifest,
    isHost: false,
    isStage: true,
    stagePresent: true,
    clockOffset: room.clockOffset,
    volumes: FULL_VOLUMES,
  });
  const background = art.app('background');
  const point = view.phase === 'playing' ? atMatchPoint(view) : [];
  const goal = view.target;
  return (
    <div
      className="dark relative h-dvh w-full overflow-hidden bg-stone-950 p-8 text-stone-50"
      data-testid="cl-stage"
    >
      {background && (
        <ProtectedImage
          src={background}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
      )}
      <div className="relative grid h-full grid-rows-[auto_1fr] gap-6">
        <header className="grid grid-cols-[1fr_auto_1fr] items-start gap-6">
          <GenreRace view={view} team="a" className="w-full max-w-md justify-self-start text-2xl" />
          <div className="text-center">
            <p className="text-3xl font-black">{room.gameName ?? art.names.title}</p>
            {view.round && view.phase === 'playing' && (
              <p className="text-xl text-stone-300">Round {view.round.number}</p>
            )}
            {point.length > 0 && (
              <p
                // vt-palette: the table screen is always dark
                className="cl-glow mt-1 rounded-full bg-amber-500/20 px-3 py-1 text-xl font-bold"
                data-testid="stage-match-point"
              >
                Match point: {point.map((t) => teamName(t)).join(' and ')}
              </p>
            )}
          </div>
          <GenreRace view={view} team="b" className="w-full max-w-md justify-self-end text-2xl" />
        </header>
        <main className="min-h-0">
          {view.phase === 'lobby' ? (
            <Message sub={`${goalLine(goal)} first to win.`}>Join a team on your phone</Message>
          ) : view.phase === 'over' ? (
            <Finale view={view} />
          ) : view.round ? (
            <RoundScreen view={view} clockOffset={room.clockOffset} />
          ) : null}
        </main>
      </div>
      {news && <NewsBanner news={news} view={view} />}
      <MomentOverlay view={view} clockOffset={room.clockOffset} big />
    </div>
  );
}

export function CliffhangerStage(props: CliffhangerUiProps) {
  const art = useLoadedArt();
  return (
    <ArtContext.Provider value={art}>
      <CliffhangerStyles />
      <StageScreen {...props} />
    </ArtContext.Provider>
  );
}

export default CliffhangerStage;

function recapLine(got: readonly { steal: boolean }[]): string {
  const own = got.filter((g) => !g.steal).length;
  const stolen = got.length - own;
  return stolen ? `${own} of 3 got, ${stolen} stolen` : `${own} of 3 got`;
}
