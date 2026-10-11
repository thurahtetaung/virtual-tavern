import type { GameUiProps } from '@vt/game-sdk';
import { useSpectatorPrompt } from '@vt/ui';
import { useEffect } from 'react';
import { ARTIFACTS } from '../logic/roles.ts';
import type { NightfallAction, NightfallView } from '../logic/types.ts';
import { deckFor, useManifest } from './assets.ts';
import { RoleDetailsProvider } from './Cards.tsx';
import { Lobby } from './Lobby.tsx';
import { Day, Night, Ready, Reveal, SoundControls } from './Play.tsx';
import { statusFor } from './status.ts';
import { useDeviceSound, useSound } from './useSound.ts';
import { useWakeAlert, useWakeLock } from './wake.ts';

export type NightfallUiProps = GameUiProps<NightfallView, NightfallAction>;

export function NightfallGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
}: NightfallUiProps) {
  const manifest = useManifest();
  const deck = deckFor(manifest, (id) => ARTIFACTS[id].summary);
  const status = statusFor(view, room);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const [device, setDevice] = useDeviceSound();
  const { lines } = useSound({
    view,
    manifest: deck.manifest,
    isHost: room.isHost,
    clockOffset: room.clockOffset,
    device,
  });

  // Every wake buzzes (never a sound, which would give the player away), even for roles that only learn
  // something; the screen stays on from the deal to the reveal, so nobody sleeps through a turn.
  const night = view.phase === 'night' ? view.night : null;
  useWakeAlert(night?.acting ? `${view.round}:${night.index}` : null);
  useWakeLock(view.myRole !== null && ['ready', 'night', 'day', 'vote'].includes(view.phase));

  // Mark the tab when you must act or vote (the lobby doesn't count).
  const tabAlert = view.phase !== 'lobby' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  // Watchers can take a seat between games; mid-game they join from the next one.
  const watching = !!view.me && !view.me.playing;
  const between = view.phase === 'lobby' || view.phase === 'reveal';
  useSpectatorPrompt(
    setSpectator,
    watching
      ? between
        ? {
            text: 'Take a seat to play in the next game.',
            actionLabel: 'Take a seat',
            action: () => void act({ type: 'sit', playing: true }),
          }
        : { text: 'You join in from the next game.' }
      : null,
  );

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
    <RoleDetailsProvider
      deck={deck}
      roles={view.settings.roles}
      artifacts={view.settings.artifacts}
    >
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
