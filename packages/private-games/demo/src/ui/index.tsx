import type { GameUiProps } from '@vt/game-sdk';
import { Button, Hint, Panel, ProtectedImage } from '@vt/ui';
import { useEffect, useState } from 'react';
import type { PeekAction, PeekView } from '../logic/index.ts';

interface Manifest {
  cards: string[];
}

/** Loads a private game's manifest; null while loading, an error message if unavailable. */
function useManifest(gameId: string) {
  const [state, setState] = useState<{ manifest: Manifest | null; error: string | null }>({
    manifest: null,
    error: null,
  });
  useEffect(() => {
    let live = true;
    void fetch(`/api/backroom/manifest/${gameId}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          (Manifest & { error?: { message: string } }) | null;
        if (!live) return;
        if (res.ok && body) setState({ manifest: body, error: null });
        else
          setState({ manifest: null, error: body?.error?.message ?? 'Could not load the cards.' });
      })
      .catch(() => live && setState({ manifest: null, error: 'Could not load the cards.' }));
    return () => {
      live = false;
    };
  }, [gameId]);
  return state;
}

export function PeekGame({ view, room, act }: GameUiProps<PeekView, PeekAction>) {
  const { manifest, error } = useManifest('backroom-demo');
  if (view.phase === 'lobby') {
    return (
      <Panel className="space-y-3 text-center">
        <p className="text-lg">
          🃏 {view.players.length} in the back room: {view.players.join(', ')}
        </p>
        {room.isHost ? (
          <Button size="lg" onClick={() => void act({ type: 'start' })}>
            Start
          </Button>
        ) : (
          <Hint>Waiting for the host to start…</Hint>
        )}
      </Panel>
    );
  }
  const cards = manifest?.cards ?? [];
  const file = cards.length ? cards[view.card % cards.length] : null;
  return (
    <Panel className="space-y-3 text-center">
      {error && <Hint>{error}</Hint>}
      {file && (
        <ProtectedImage
          src={`/api/backroom/assets/backroom-demo/${file}`}
          alt={`Card ${view.card + 1}`}
          className="mx-auto max-h-[60dvh] rounded-xl shadow-lg"
        />
      )}
      <p className="text-sm text-stone-500">Card {view.card + 1}</p>
      <Button size="lg" onClick={() => void act({ type: 'next' })}>
        Next card
      </Button>
    </Panel>
  );
}
