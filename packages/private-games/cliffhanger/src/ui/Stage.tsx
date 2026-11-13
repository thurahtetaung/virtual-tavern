import { ProtectedImage, cn } from '@vt/ui';
import { Poster, PosterClock, PosterSide, PosterSlate } from '@vt/ui/show';
import { FULL_VOLUMES } from '@vt/ui/sound';
import { useEffect, useRef, useState } from 'react';
import type { Card } from '../logic/content.ts';
import { STYLES, genreInfo, goalLine, nounOf, progress } from '../logic/genres.ts';
import { type CliffhangerView, TEAMS, type TeamId } from '../logic/types.ts';
import { ArtContext, useArt, useLoadedArt } from './assets.ts';
import type { CliffhangerUiProps } from './CliffhangerGame.tsx';
import { MomentOverlay } from './MomentOverlay.tsx';
import { atMatchPoint } from './moments.ts';
import { CliffhangerStyles, RuleNote, TEAM_EMOJI, Tape, nameOf, teamName } from './parts.tsx';
import { CategoryCard } from './Play.tsx';
import { genreName } from '../logic/manifest.ts';
import { statusFor } from './status.ts';
import { useSound } from './useSound.ts';

// The table screen: the room's big picture for a TV. It never shows a card that is being
// described (the view it gets is the table's, which has none), only what the whole table may see:
// the face-off's category and who is on the clock, each answer landing, the describing turn's
// clock and its squares filling, tapes sliding into their genres, steals, match point and the win.
// Built from the manifest's art and CSS motion; plain tapes and emoji without it. Laid out on the
// shared table-screen poster; the tapes lie flat, side by side.

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

/** A team's column: its name and how far it is, the goal's genres, its tapes and its people. */
function TeamSide({ view, team, on }: { view: CliffhangerView; team: TeamId; on: string | null }) {
  const { names } = useArt();
  const deck = view.settings.deck;
  const goal = view.target;
  const tapes = view.collections[team];
  const genres = tapes.map((c) => c.genre);
  const p = progress(genres, goal);
  const count = (g: string) => genres.filter((x) => x === g).length;
  const people = view.seats.filter((s) => s.team === team);
  return (
    <PosterSide
      name={`${TEAM_EMOJI[team]} ${teamName(team)}`}
      score={`${p.have}/${p.need}`}
      tone={team}
      testId={`race-${team}`}
    >
      <ul className="flex flex-wrap gap-2">
        {goal.genres.map((g) => {
          const info = genreInfo(g, deck);
          const n = Math.min(goal.each, count(g));
          const name = genreName(names, g, deck);
          const done = n >= goal.each;
          return (
            <li
              key={g}
              aria-label={`${name}: ${n} of ${goal.each}`}
              className={cn(
                'flex items-center gap-1 rounded-xl border-2 px-2 py-0.5 text-[28px]',
                done ? 'border-transparent text-white' : 'border-line bg-sunk text-ink-muted',
              )}
              style={done ? { backgroundColor: info.colour } : undefined}
            >
              <span aria-hidden className={cn(!done && 'opacity-60')}>
                {info.emoji}
              </span>
              {goal.each > 1 && <span className="tabular-nums">{n}</span>}
            </li>
          );
        })}
      </ul>
      {/* The tapes lie flat, side by side, as on the phones. */}
      <ul className="grid grid-cols-3 gap-3" aria-label={`${teamName(team)}’s tapes`}>
        {tapes.slice(-9).map((c) => (
          <li key={c.id}>
            <Tape card={c} deck={deck} className="w-full" />
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[32px] font-medium">
        {people.map((s) => (
          <li
            key={s.id}
            className={cn('rounded-xl px-2', s.id === on && 'bg-accent-soft ring-4 ring-accent')}
            data-testid={s.id === on ? `stage-seat-${team}` : undefined}
          >
            {s.name}
            {s.id === on && <span className="cl-pop ml-2 text-[28px] font-bold">on the clock</span>}
          </li>
        ))}
      </ul>
    </PosterSide>
  );
}

type Middle = Pick<
  Parameters<typeof Poster>[0],
  'eyebrow' | 'headline' | 'line' | 'clock' | 'choices' | 'children' | 'footer'
> & { on?: string | null };

/** The squares of the turn being described, as slates: what each asks for, and who got it. */
function Squares({ view, team }: { view: CliffhangerView; team: TeamId }) {
  const { names } = useArt();
  const slots = view.round?.board[team] ?? [];
  return (
    <>
      {slots.map((s, i) => (
        <PosterSlate
          key={i}
          state={s.got ? (s.got === team ? 'won' : 'lost') : 'open'}
          className="w-[188px]"
          testId={`stage-square-${i}`}
        >
          <span>
            <span aria-hidden className="block text-[48px]">
              {s.got ? '✓' : STYLES[s.plays].emoji}
            </span>
            {names.styles[s.plays]}
            {s.got && s.got !== team && <span className="block">stolen</span>}
          </span>
        </PosterSlate>
      ))}
    </>
  );
}

function roundMiddle(
  view: CliffhangerView,
  clockOffset: number,
  art: ReturnType<typeof useArt>,
): Middle {
  const r = view.round!;
  const nouns = nounOf(view.settings.deck, true);
  const phones = { icon: 'tv' as const, text: 'Phones hold the titles. Shout your guesses!' };
  switch (r.stage) {
    case 'pick-category':
      return {
        eyebrow: 'Next face-off',
        headline: `${nameOf(view, r.pick?.by)} is picking…`,
        line: 'The team that’s behind picks the face-off category.',
        footer: { icon: 'tv', text: `${nameOf(view, r.pick?.by)} picks on their phone.` },
      };
    case 'countdown': {
      if (r.after === 'faceoff') {
        const title = art.app('roundTitle') ?? art.app('faceoffTitle');
        return {
          eyebrow: `Round ${r.number}: face-off`,
          headline: `${TEAM_EMOJI.a} ${nameOf(view, r.pair.a)} vs ${nameOf(view, r.pair.b)} ${TEAM_EMOJI.b}`,
          children: (
            <div className="flex items-center gap-8">
              {title && <ProtectedImage src={title} alt="" className="max-h-[300px] w-auto" />}
              {r.category && <CategoryCard text={r.category.text} big className="h-[340px]" />}
            </div>
          ),
          footer: { icon: 'tv', text: 'Name a film that fits, then press Said it!' },
        };
      }
      return {
        headline: statusFor(view, { you: '', hostId: '', isHost: false, players: [] }).text,
        line: 'Get ready to shout!',
        footer: phones,
      };
    }
    case 'faceoff': {
      const fo = r.faceoff!;
      const press = art.app('pressReset');
      return {
        eyebrow: `Round ${r.number}: face-off`,
        headline: fo.on ? `${nameOf(view, fo.on)} is on the clock` : 'Both on the clock',
        clock: (
          <PosterClock
            key={fo.deadline ?? 0}
            deadline={fo.deadline}
            clockOffset={clockOffset}
            urgentBelow={5}
            label={fo.answers === 0 ? 'Opening clock' : 'Answer clock'}
          />
        ),
        children: (
          <div className="flex flex-col items-center gap-4">
            {r.category && <CategoryCard text={r.category.text} big className="h-[260px]" />}
            {view.settings.noSequels && (
              <RuleNote className="px-4 py-1 text-[28px]" testId="rule-no-sequels">
                No sequels
              </RuleNote>
            )}
            {fo.answers > 0 && fo.last && (
              <div
                key={`${fo.answers}:${fo.last}`}
                className="cl-pop flex items-center gap-3 text-[36px] font-bold"
                data-testid="stage-press"
              >
                {press && <ProtectedImage src={press} alt="" className="h-16 w-auto" />}
                <span>{nameOf(view, fo.last)} said one!</span>
                <span className="rounded-full bg-accent-soft px-3 py-1 tabular-nums">
                  × {fo.answers}
                </span>
              </div>
            )}
          </div>
        ),
        footer: { icon: 'tv', text: 'Say a film that fits, then press Said it! on your phone.' },
        on: fo.on,
      };
    }
    case 'keep':
      return {
        eyebrow: `Round ${r.number}`,
        headline: r.faceoffResult
          ? `${nameOf(view, r.faceoffResult.winner)} wins the face-off!`
          : 'Face-off over',
        line: `Choosing their ${nouns}…`,
        footer: { icon: 'tv', text: `The winner keeps three ${nouns} on their phone.` },
      };
    case 'turn': {
      const t = r.turn!;
      const team = t.stealOpen ? (t.team === 'a' ? 'b' : 'a') : t.team;
      return {
        eyebrow: `${TEAM_EMOJI[t.team]} ${teamName(t.team)}’s turn`,
        headline: `${nameOf(view, t.describer)} is describing`,
        line: t.stealOpen ? (
          <span className="cl-pop font-bold">All three! Now stealing the other side’s…</span>
        ) : undefined,
        clock: (
          <PosterClock
            key={t.endsAt}
            deadline={t.endsAt}
            clockOffset={clockOffset}
            label="Describing"
          />
        ),
        choices: <Squares view={view} team={team} />,
        footer: {
          icon: 'tv',
          text: `Phones hold the titles. Shout your guesses at ${nameOf(view, t.describer)}.`,
        },
        on: t.describer,
      };
    }
    case 'recap': {
      const last = r.results.at(-1);
      return {
        eyebrow: `Round ${r.number}`,
        headline: last
          ? `${TEAM_EMOJI[last.team]} ${teamName(last.team)}’s turn is over`
          : 'Turn over',
        line: last ? recapLine(last.got) : undefined,
        footer: phones,
      };
    }
    case 'steal':
      return {
        eyebrow: `Round ${r.number}`,
        headline: r.steal
          ? `${TEAM_EMOJI[r.steal.team]} ${teamName(r.steal.team)} may trade`
          : 'Trading…',
        line: 'Three of a genre for one of the other side’s.',
        footer: { icon: 'tv', text: 'The trade is picked on the phones.' },
      };
  }
}

function finaleMiddle(view: CliffhangerView): Middle {
  const w = view.winner;
  return {
    eyebrow: 'Game over',
    headline: (
      <span className="cl-rise inline-block">
        <span aria-hidden>🏆{w ? TEAM_EMOJI[w] : ''} </span>
        {w ? `${teamName(w)} win!` : 'No winner this time'}
      </span>
    ),
    children: w ? (
      <ul
        className="cl-rise flex max-w-[1500px] flex-wrap justify-center gap-3"
        data-testid="stage-finale"
      >
        {view.collections[w].map((c) => (
          <li key={c.id}>
            <Tape card={c} deck={view.settings.deck} className="h-[150px]" full />
          </li>
        ))}
      </ul>
    ) : (
      <span data-testid="stage-finale" />
    ),
    footer: { icon: 'tv', text: 'The host can start another game from their phone.' },
  };
}

function NewsBanner({ news, view }: { news: News; view: CliffhangerView }) {
  return (
    <div
      key={news.key}
      className="cl-slide pointer-events-none absolute right-20 bottom-36 z-30 flex items-center gap-5 rounded-3xl border border-line bg-card p-5 shadow-2xl"
      data-testid="stage-news"
    >
      <Tape card={news.card} deck={view.settings.deck} className="h-36" got={news.team} />
      <div>
        <p className="text-[32px] font-bold">
          {TEAM_EMOJI[news.team]} {teamName(news.team)}
        </p>
        <p className="text-[28px] text-ink-2">
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
  const middle: Middle =
    view.phase === 'lobby'
      ? {
          eyebrow: 'Waiting for the host',
          headline: 'Join a team on your phone',
          line: `${goalLine(goal)} first to win.`,
          footer: { icon: 'tv', text: 'Pick Popcorn or Nachos on your phone.' },
        }
      : view.phase === 'over'
        ? finaleMiddle(view)
        : view.round
          ? roundMiddle(view, room.clockOffset, art)
          : {};
  const { on = null, footer, ...moment } = middle;
  return (
    <Poster
      testId="cl-stage"
      meta={view.round && view.phase === 'playing' ? `Round ${view.round.number}` : undefined}
      {...moment}
      left={<TeamSide view={view} team="a" on={on} />}
      right={<TeamSide view={view} team="b" on={on} />}
      footer={footer}
      footerEnd={
        point.length > 0 ? (
          <span
            className="cl-glow inline-flex items-center rounded-full border border-warn-line bg-warn-soft px-5 py-2 font-bold text-warn-ink"
            data-testid="stage-match-point"
          >
            Match point: {point.map((t) => teamName(t)).join(' and ')}
          </span>
        ) : undefined
      }
      background={
        background ? (
          <ProtectedImage
            src={background}
            alt=""
            className="h-full w-full object-cover opacity-10"
          />
        ) : undefined
      }
      overlay={
        <>
          {news && <NewsBanner news={news} view={view} />}
          <MomentOverlay view={view} clockOffset={room.clockOffset} big />
        </>
      }
    />
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
