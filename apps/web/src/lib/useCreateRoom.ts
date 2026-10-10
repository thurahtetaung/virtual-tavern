import type { CreateRoomResponse } from '@vt/protocol';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from './api.ts';
import { playerToken, saveName } from './identity.ts';
import { useToast } from './toast.tsx';

/** Creates a room for a game and opens it; asks for a name first via `onNeedName`. */
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
