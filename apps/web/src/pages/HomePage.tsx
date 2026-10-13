import { Button, Panel } from '@vt/ui';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Layout } from '../components/Layout.tsx';
import { GameCard } from '../components/GameCard.tsx';
import { clientGames } from '../games/registry.ts';
import { useBackroom } from '../lib/backroom.ts';
import { lastRoom, saveName, savedName } from '../lib/identity.ts';
import { EXAMPLE_ROOM_CODE, parseRoomCode } from '../lib/room-code.ts';
import { usePageTitle } from '../lib/title.ts';
import { useCreateRoom } from '../lib/useCreateRoom.ts';
import { useToast } from '../lib/toast.tsx';

export function HomePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(savedName);
  const [invite, setInvite] = useState('');
  const [last] = useState(lastRoom);
  const { status: backroom } = useBackroom();
  // A back-room room is only offered while this browser can get in: a locked door would only
  // bounce the player to the password prompt. Rooms saved before the flag existed are private
  // when their game isn't a public one.
  const isPrivate = !!last && (last.private || !clientGames.some((g) => g.name === last.game));
  const recent = last && (!isPrivate || backroom?.unlocked) ? last : null;
  usePageTitle();

  const { creating, create } = useCreateRoom(name, () =>
    document.getElementById('home-name')?.focus(),
  );

  const join = (e: FormEvent) => {
    e.preventDefault();
    const id = parseRoomCode(invite);
    if (!id) {
      toast(
        `That doesn't look like a room link or code. Paste the whole link, or type the four-part code, like "${EXAMPLE_ROOM_CODE.replaceAll('-', ' ')}".`,
      );
      return;
    }
    if (name.trim()) saveName(name);
    void navigate(`/r/${id}`);
  };

  return (
    <Layout>
      <section className="py-6 text-center sm:py-10">
        <h1 className="text-4xl font-bold sm:text-5xl">Pull up a chair.</h1>
        <p className="mx-auto mt-3 max-w-xl text-lg text-stone-600 dark:text-stone-400">
          Start a room, send the link to your friends, and play together in the browser. No
          accounts, no downloads.
        </p>
        {recent && (
          <p className="mt-4">
            <Link
              to={`/r/${recent.id}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold text-amber-700 hover:bg-accent-soft dark:text-amber-400 dark:hover:bg-stone-800"
            >
              <span aria-hidden>↩</span> Rejoin your {recent.game} room
            </Link>
          </p>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <Panel>
          <label htmlFor="home-name" className="text-sm font-semibold">
            1. What should we call you?
          </label>
          <input
            id="home-name"
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && saveName(name)}
            placeholder="Your name"
            autoComplete="nickname"
            className="mt-2 h-12 w-full rounded-lg bg-white px-4 text-lg ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
          />
        </Panel>
        <Panel>
          <form onSubmit={join}>
            <label htmlFor="invite" className="text-sm font-semibold">
              Got an invite link or room code?
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="invite"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="Paste it here"
                className="h-12 min-w-0 flex-1 rounded-lg bg-white px-4 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
              />
              <Button type="submit" size="lg" variant="secondary" disabled={!invite.trim()}>
                Join
              </Button>
            </div>
          </form>
        </Panel>
      </div>

      <h2 className="mt-10 mb-4 text-2xl font-bold">2. Pick a game</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {clientGames.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            creating={creating}
            onCreate={(id) => void create(id)}
          />
        ))}
        <Panel className="flex items-center justify-center border-2 border-dashed border-stone-300 bg-transparent text-stone-500 shadow-none ring-0 dark:border-stone-700">
          More games coming soon
        </Panel>
      </div>

      {/* The only public hint of the back room: a quiet, text-free door at the end of the page. */}
      <div className="mt-10 flex justify-end">
        <Link
          to="/backroom"
          aria-label="The back room"
          className="rounded-full p-2 text-2xl opacity-40 grayscale transition hover:scale-110 hover:opacity-100 hover:grayscale-0 focus-visible:opacity-100 focus-visible:grayscale-0"
        >
          <span aria-hidden>🚪</span>
        </Link>
      </div>
    </Layout>
  );
}
