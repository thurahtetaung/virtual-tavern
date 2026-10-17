import type { CreateRoomResponse } from '@vt/protocol';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { loadGame } from '../games/registry.ts';
import { api } from './api.ts';
import { playerToken, saveName } from './identity.ts';
import { useToast } from './toast.tsx';

/**
 * Loads the room page and the game's screen, so they are in by the time the room exists (or the
 * invite link opens). Failures are left to the room page, which loads them again.
 */
export function preloadRoom(gameId: string) {
  void import('../pages/RoomPage.tsx').catch(() => {});
  void loadGame(gameId)
    .then((game) => game?.Component.preload())
    .catch(() => {});
}

/**
 * Creates a room for a game and opens it; asks for a name first via `onNeedName`. The room page
 * and the game's code load while the room is being created.
 */
export function useCreateRoom(name: string, onNeedName: () => void) {
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState<string | null>(null);

  const create = async (gameId: string) => {
    if (!name.trim()) {
      toast('Enter your name first so friends know who you are.');
      onNeedName();
      return;
    }
    saveName(name);
    setCreating(gameId);
    preloadRoom(gameId);
    try {
      const { roomId } = await api<CreateRoomResponse>('/api/rooms', {
        method: 'POST',
        body: { gameId, token: playerToken() },
      });
      void navigate(`/r/${roomId}`);
    } catch (err) {
      toast((err as Error).message);
      setCreating(null);
    }
  };

  return { creating, create };
}
