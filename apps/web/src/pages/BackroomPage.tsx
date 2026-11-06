import {
  Button,
  Chip,
  Chips,
  type GameCover,
  GameCard,
  Icon,
  Input,
  Slate,
  buttonClass,
  coverOf,
  loadManifest,
} from '@vt/ui';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { GameSummary } from '@vt/protocol';
import { useGameGuide } from '../components/GuideView.tsx';
import { Layout, RoomOpening } from '../components/Layout.tsx';
import { type ClientGame, loadPrivateGames, offeredPrivateGames } from '../games/registry.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { article } from '../lib/article.ts';
import { doorOf, lockedLine, useBackroom, useBackroomPage } from '../lib/backroom.ts';
import { chipsOf, shows, useCategoryFilter } from '../lib/categories.ts';
import { saveName, savedName } from '../lib/identity.ts';
import { usePageTitle } from '../lib/title.ts';
import { useToast } from '../lib/toast.tsx';
import { useCreateRoom } from '../lib/useCreateRoom.ts';
import { fetchGames } from '../lib/games.ts';

/** The private games this server actually offers, with their UIs (loaded only once unlocked). */
function usePrivateGames(unlocked: boolean) {
  const [games, setGames] = useState<{ ui: ClientGame[]; offered: GameSummary[] } | null>(null);
  useEffect(() => {
    if (!unlocked) return;
    void Promise.all([fetchGames(), loadPrivateGames()]).then(([offered, ui]) =>
      setGames({ ui: offeredPrivateGames(offered, ui), offered: offered.filter((g) => g.private) }),
    );
  }, [unlocked]);
  return games;
}

/**
 * The game's cover from its manifest (`cover`, see `ManifestCover`), asked for only once its card
 * nears the screen: some manifests are large, and a phone shows two or three cards at first.
 */
function useCover(gameId: string) {
  const box = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState<GameCover | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let live = true;
    const load = () =>
      void loadManifest(gameId).then((m) => {
        if (live) setCover(coverOf(gameId, m));
      });
    if (typeof IntersectionObserver === 'undefined') {
      load();
      return () => {
        live = false;
      };
    }
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        near.disconnect();
        load();
      },
      { rootMargin: '400px 0px' },
    );
    near.observe(el);
    return () => {
      live = false;
      near.disconnect();
    };
  }, [gameId]);
  return { box, cover };
}

/** One game in the lobby: its cover in the art strip (its emblem until, or without, one). */
function BackroomGameCard({
  game,
  creating,
  onCreate,
}: {
  game: ClientGame;
  creating: string | null;
  onCreate: (id: string) => void;
}) {
  const guide = useGameGuide(game);
  const { box, cover } = useCover(game.id);
  return (
    <div ref={box} className="flex">
      <GameCard
        className="w-full"
        emblem={game.icon}
        name={game.name}
        meta={`${guide.players} · ${guide.duration}`}
        tagline={guide.tagline}
        cover={cover}
        strip
        createAriaLabel={`Create ${article(game.name)} ${game.name} room`}
        creating={creating === game.id}
        disabled={creating !== null}
        onCreate={() => onCreate(game.id)}
        howToPlay={
          <Link to={`/rules/${game.id}`} className={buttonClass({ variant: 'quiet' })}>
            How to play
          </Link>
        }
      />
    </div>
  );
}

function Lobby({ onLock, admin = false }: { onLock: () => void; admin?: boolean }) {
  const loaded = usePrivateGames(true);
  const chips = useMemo(() => chipsOf(loaded?.offered ?? []), [loaded]);
  const filter = useCategoryFilter('vt.categories.backroom', chips);
  const games = loaded?.ui.filter((g) => {
    const summary = loaded.offered.find((s) => s.id === g.id);
    return !summary?.off && shows(filter.chosen, summary?.categories ?? []);
  });
  const [name, setName] = useState(savedName);
  const { creating, create } = useCreateRoom(name, () =>
    document.getElementById('backroom-name')?.focus(),
  );
  return (
    <div className="space-y-6">
      {creating && <RoomOpening />}
      <header className="grid justify-items-center gap-1 text-center">
        <Icon name="flame" size={32} className="text-accent-text" />
        <h1 className="font-display text-title font-semibold">The Back Room</h1>
        <p className="text-ink-2">You're on the list. Pull up a chair.</p>
      </header>
      <div className="mx-auto flex max-w-sm flex-col gap-1.5 sm:max-w-md sm:flex-row sm:items-center sm:justify-center sm:gap-3">
        <label htmlFor="backroom-name" className="text-small font-semibold whitespace-nowrap">
          Your name
        </label>
        <Input
          id="backroom-name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && saveName(name)}
          placeholder="What should we call you?"
          autoComplete="nickname"
          className="sm:max-w-xs"
        />
      </div>
      {chips.length > 0 && (
        <Chips label="Filter games by category">
          <Chip pressed={filter.chosen.length === 0} onClick={filter.clear}>
            All
          </Chip>
          {chips.map((c) => (
            <Chip
              key={c.id}
              pressed={filter.chosen.includes(c.id)}
              onClick={() => filter.toggle(c.id)}
            >
              <span aria-hidden>{c.emoji}</span>
              {c.name}
            </Chip>
          ))}
        </Chips>
      )}
      {/* The registry's order keeps the mostly white covers out of one desktop row. */}
      <section
        aria-label="Back room games"
        className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3"
      >
        {games?.map((game) => (
          <BackroomGameCard
            key={game.id}
            game={game}
            creating={creating}
            onCreate={(id) => void create(id)}
          />
        ))}
        {games?.length === 0 && filter.chosen.length > 0 && (
          <Slate
            className="col-span-full"
            title="No game has all of those categories."
            action={
              <Button variant="secondary" onClick={filter.clear}>
                Show all games
              </Button>
            }
          />
        )}
        {loaded && !loaded.offered.some((g) => !g.off) && (
          <Slate className="col-span-full" emoji="🕯️" title="Nothing back here yet…">
            The tables are still being set.
          </Slate>
        )}
        {!games && <Slate kind="loading" className="col-span-full" title="Setting the tables…" />}
      </section>
      <div className="flex flex-col items-center gap-2">
        {admin ? (
          <p className="text-small text-ink-muted" data-testid="admin-key">
            You're signed in as the admin, so the door is always open to you.
          </p>
        ) : (
          <Button variant="quiet" size="sm" onClick={onLock}>
            <Icon name="lock" />
            Lock the door on this device
          </Button>
        )}
        <BackLink />
      </div>
    </div>
  );
}

const BackLink = () => (
  <Link to="/" className={buttonClass({ variant: 'quiet', size: 'sm' })}>
    <Icon name="arrow-left" />
    Back to the tavern
  </Link>
);

/** Only allow returning to pages on this site. */
const safeNext = (next: string | null) => (next && /^\/[\w/-]*$/.test(next) ? next : null);

export function BackroomPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  // Sent back from a room: the word changed (a new password, or everyone signed out), or the
  // admin session it was open to ended.
  const locked = lockedLine(params);
  const { status, refresh } = useBackroom();
  const [word, setWord] = useState('');
  // Why the last knock failed, shown under the field until the next keystroke.
  const [refusal, setRefusal] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Seconds until the bouncer listens again, after too many wrong words.
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  usePageTitle('The Back Room');
  useBackroomPage();

  const knock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/backroom/unlock', { method: 'POST', body: { password: word } });
      // Came from a room link? Go straight back. Otherwise stay and show the back room.
      if (next) void navigate(next);
      else void refresh();
    } catch (err) {
      // Shown under the field only: a toast would say it twice.
      setRefusal((err as Error).message);
      if (err instanceof ApiFailure && err.retryAfter) setWait(err.retryAfter);
      // Keep the word, selected, so a typo can be fixed and a wrong word typed over.
      input.current?.focus();
      input.current?.select();
    }
    setBusy(false);
  };

  const lock = async () => {
    try {
      await api('/api/backroom/lock', { method: 'POST' });
      toast('The door clicks shut behind you.', 'info');
      void refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const door = doorOf(status);
  if (door === 'member' || door === 'admin') {
    return (
      <Layout>
        <Lobby onLock={() => void lock()} admin={door === 'admin'} />
      </Layout>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-sm justify-items-center gap-4 text-center">
        <Icon name="flame" size={40} className="text-accent-text" />
        <h1 className="font-display text-title font-semibold">The Back Room</h1>
        {!status ? (
          <Slate kind="loading" title="Listening at the door…" />
        ) : !status.open ? (
          <p className="text-ink-2">
            The door is locked and nobody answers. Try again another night.
          </p>
        ) : status.unlocked ? null : (
          <form onSubmit={(e) => void knock(e)} className="grid w-full gap-3">
            {locked && (
              <p role="status" className="font-semibold text-accent-text">
                {locked}
              </p>
            )}
            <p className="text-ink-2">Members only. What's the word?</p>
            <label className="sr-only" htmlFor="backroom-word">
              The word
            </label>
            <Input
              id="backroom-word"
              ref={input}
              type="password"
              autoFocus
              autoComplete="current-password"
              value={word}
              onChange={(e) => {
                setWord(e.target.value);
                setRefusal(null);
              }}
              invalid={refusal !== null}
              aria-describedby={refusal ? 'backroom-refusal' : undefined}
              className="text-center tracking-widest"
              placeholder="psst…"
            />
            {refusal && (
              <p
                id="backroom-refusal"
                role="alert"
                className="flex items-start justify-center gap-1.5 text-small font-semibold text-danger-ink"
              >
                <Icon name="triangle-alert" className="mt-0.5 shrink-0" />
                {refusal}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={!word || busy || wait > 0}>
              {wait > 0 ? `Knock again in ${wait} s` : 'Knock'}
            </Button>
            {next && (
              <p className="text-small text-ink-2" data-testid="invite-note">
                Your friend's table is through this door. They know the word: ask them for it, then
                knock and you'll go straight to their game.
              </p>
            )}
          </form>
        )}
        <BackLink />
      </div>
    </main>
  );
}
