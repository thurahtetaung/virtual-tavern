import { Button, Card, Field, Icon, Input, buttonClass } from '@vt/ui';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Layout, RoomOpening } from '../components/Layout.tsx';
import { CategoryChips, NoMatch, ShelfCard, useShelf } from '../components/Shelf.tsx';
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
  // The game cards come with the page; their categories from the server, when it answers.
  const { chips, filter, shown: games } = useShelf(clientGames, 'vt.categories.home');

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
      {creating && <RoomOpening />}
      <section className="pt-4 pb-6 text-center sm:pt-10 sm:pb-8">
        <h1 className="text-display font-semibold">Pull up a chair.</h1>
        <p className="mx-auto mt-3 max-w-lg text-body text-ink-2 sm:text-sub">
          Start a room, send the link to your friends, and play together in the browser. No
          accounts, no downloads.
        </p>
        {recent && (
          <p className="mt-4">
            <Link to={`/r/${recent.id}`} className={buttonClass({ variant: 'quiet' })}>
              <Icon name="door-open" /> Rejoin your {recent.game} room
            </Link>
          </p>
        )}
      </section>

      <Card className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
        <Field label="What should we call you?">
          <Input
            id="home-name"
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && saveName(name)}
            placeholder="Your name"
            autoComplete="nickname"
          />
        </Field>
        <p className="text-center text-small text-ink-muted md:pb-3">or, with an invite</p>
        <form onSubmit={join} className="grid gap-1.5">
          <label htmlFor="invite" className="text-small font-semibold text-ink">
            Paste a room link or code
          </label>
          <div className="flex gap-2">
            <Input
              id="invite"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder={EXAMPLE_ROOM_CODE}
              autoComplete="off"
              className="flex-1"
            />
            <Button type="submit" disabled={!invite.trim()} className="min-h-12">
              Join
            </Button>
          </div>
        </form>
      </Card>

      <h2 className="mt-10 mb-3 text-title font-semibold">Pick a game</h2>
      <CategoryChips
        chips={chips}
        chosen={filter.chosen}
        onToggle={filter.toggle}
        onClear={filter.clear}
        className="mb-4"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {games.length === 0 && <NoMatch onClear={filter.clear} />}
        {games.map((game) => (
          <ShelfCard
            key={game.id}
            game={game}
            creating={creating}
            onCreate={(id) => void create(id)}
          />
        ))}
        {filter.chosen.length === 0 && (
          <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-line-strong p-4 text-small text-ink-muted">
            More games coming soon
          </div>
        )}
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
