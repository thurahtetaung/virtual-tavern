import type { GameUiProps } from '@vt/game-sdk';
import { useEffect } from 'react';
import { ARTIFACTS } from '../logic/roles.ts';
import type { NightfallAction, NightfallView } from '../logic/types.ts';
import { deckFor, useManifest } from './assets.ts';
import { RoleDetailsProvider } from './Cards.tsx';
import { Lobby } from './Lobby.tsx';
import { Day, Night, Ready, Reveal, SoundControls } from './Play.tsx';
import { statusFor } from './status.ts';
import { useDeviceSound, useSound } from './useSound.ts';

export type NightfallUiProps = GameUiProps<NightfallView, NightfallAction>;

export function NightfallGame({ view, room, act, showGuide, setYourMove }: NightfallUiProps) {
  const manifest = useManifest();
  const deck = deckFor(manifest, (id) => ARTIFACTS[id].summary);
  const status = statusFor(view, room.isHost);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const [device, setDevice] = useDeviceSound();
  const { lines } = useSound({
    view,
    manifest: deck.manifest,
    isHost: room.isHost,
    clockOffset: room.clockOffset,
    device,
  });

  // Mark the tab when you must act or vote (the lobby doesn't count).
  const tabAlert = view.phase !== 'lobby' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  const sound = (
    <SoundControls
      view={view}
      room={room}
      device={device}
      setDevice={setDevice}
      hasMusic={!!deck.manifest?.music}
    />
  );
  const props = { view, room, act, status, deck };
  return (
    <RoleDetailsProvider deck={deck}>
      {view.phase === 'lobby' ? (
        <Lobby {...props} online={online} showGuide={showGuide} />
      ) : view.phase === 'ready' ? (
        <Ready {...props} />
      ) : view.phase === 'night' ? (
        <Night {...props} lines={lines} sound={sound} />
      ) : view.phase === 'day' || view.phase === 'vote' ? (
        <Day {...props} lines={lines} sound={sound} />
      ) : (
        <Reveal {...props} />
      )}
    </RoleDetailsProvider>
  );
}
