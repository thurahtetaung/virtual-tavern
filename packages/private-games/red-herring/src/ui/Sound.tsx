import type { GameRoomInfo } from '@vt/game-sdk';
import { cn } from '@vt/ui';
import {
  DEFAULT_VOLUMES,
  LobbySound,
  PREVIEW_MS,
  type SoundChannel,
  type SoundSection,
  SoundButton as SoundCorner,
  gainOf,
  soundEngineFor,
  soundPlan,
  useHostVolumes,
  useVolumeShare,
  useVolumes,
  volumeShare,
  whereLine,
} from '@vt/ui/sound';
import { useEffect, useRef, useState } from 'react';
import {
  type RedHerringAction,
  type RedHerringView,
  SOUND_MODES,
  type SoundMode,
} from '../logic/types.ts';
import { type Art, GAME_ID } from './assets.ts';
import { cueStep, cuesOf } from './cues.ts';

// Red Herring's sound: two short cues, as effects: one when the word is written, one at the end.
// The host picks where they play. Phones also buzz on their owner's turn, wherever sound plays.

const engine = () => soundEngineFor(GAME_ID);
export const useRedHerringVolumes = () => useVolumes(GAME_ID, DEFAULT_VOLUMES);

export const SOUND_NAME: Record<SoundMode, string> = {
  off: 'Off',
  host: 'Host’s device',
  all: 'Every device',
};

const SOUND_HELP: Record<SoundMode, string> = {
  off: 'No device makes a sound.',
  host: 'Only the host’s device plays the cues: put it in the middle of the table.',
  all: 'Every device plays the cues (best on a call).',
};

interface Props {
  view: RedHerringView;
  room: GameRoomInfo;
  act: (action: RedHerringAction) => unknown;
  art: Art;
}

function useSections({ view, room, act, art }: Props) {
  const [volumes, setVolume] = useRedHerringVolumes();
  const shared = useVolumeShare(
    volumeShare(GAME_ID, room.isHost, act, view.settings.hostVolumes),
    setVolume,
  );
  const mode = view.settings.sound;
  const plan = soundPlan(mode, room.isHost, ['effects']);
  const clip = art.sound.newWord ?? art.sound.winner;
  const channels: SoundChannel[] = plan.mine.length
    ? [
        {
          kind: 'effects',
          label: 'Cues',
          help: 'The new word, and the winner',
          canPreview: !!clip,
          preview: (gain) => (clip ? engine().preview(clip, gain, PREVIEW_MS) : null),
        },
      ]
    : [];
  const sections: SoundSection[] = [
    {
      title: 'This phone',
      volumes,
      setVolume: shared.setVolume,
      hostSet: shared.hostSet,
      caption: shared.caption,
      hostMode: shared.hostMode,
      channels,
      testId: 'red-herring-sound-mine',
    },
  ];
  const host = room.players.find((p) => p.id === room.hostId)?.name ?? 'the host';
  return { sections, note: whereLine(mode, host, room.isHost), mode };
}

function SoundModes({ room, act, mode }: Props & { mode: SoundMode }) {
  return (
    <fieldset className="mt-3 space-y-2" data-testid="red-herring-sound-settings">
      <legend className="sr-only">Where the sound plays</legend>
      {room.isHost ? (
        <div className="grid grid-cols-3 gap-2">
          {SOUND_MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => void act({ type: 'update-settings', sound: m })}
              className={cn(
                'min-h-11 rounded-lg text-sm font-semibold ring-1 transition',
                mode === m
                  ? 'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500' // vt-palette
                  : 'ring-line hover:bg-panel dark:ring-stone-700 dark:hover:bg-stone-800', // vt-palette
              )}
            >
              {SOUND_NAME[m]}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm">{SOUND_NAME[mode]}</p>
      )}
      <p className="text-xs text-ink-muted">{SOUND_HELP[mode]}</p>
      <p className="text-xs text-ink-muted">
        Phones that can buzz also buzz briefly when it’s your turn.
      </p>
    </fieldset>
  );
}

export function RedHerringLobbySound(props: Props) {
  const { sections, note, mode } = useSections(props);
  return (
    <LobbySound sections={sections} note={note}>
      <SoundModes {...props} mode={mode} />
    </LobbySound>
  );
}

export function RedHerringSoundButton(props: Props) {
  const { sections, note } = useSections(props);
  return <SoundCorner sections={sections} note={note} testId="red-herring-sound" />;
}

/** A short buzz on this phone, where the browser allows it. */
export function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Not allowed before a tap: nothing to do.
  }
}

function useUnlocked(): boolean {
  const [unlocked, setUnlocked] = useState(() => engine().ready);
  useEffect(() => {
    const on = () => {
      engine().unlock();
      setUnlocked(engine().ready);
    };
    const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
    for (const e of events) window.addEventListener(e, on, { capture: true });
    return () => {
      for (const e of events) window.removeEventListener(e, on, { capture: true });
    };
  }, []);
  return unlocked;
}

/**
 * Plays the cues on this device where the host's choice puts them, and buzzes this phone when
 * its owner's turn comes. Nothing plays before the first tap.
 */
export function useCues(view: RedHerringView, art: Art, isHost: boolean, yourMove: boolean) {
  const unlocked = useUnlocked();
  const [volumes, setVolume] = useRedHerringVolumes();
  // Takes the host's volumes in on every device (this hook runs in the lobby and in play).
  useHostVolumes({ game: GAME_ID, host: view.settings.hostVolumes, isHost, setVolume });
  const mode = view.settings.sound;
  const here = mode === 'all' || (mode === 'host' && isHost);
  const gain = gainOf(volumes, 'effects');
  const seen = useRef<Set<string> | null>(null);
  const keys = cuesOf(view)
    .map((c) => c.key)
    .join('|');
  useEffect(() => {
    const step = cueStep(seen.current, view);
    seen.current = step.seen;
    for (const cue of step.play) {
      const file = art.sound[cue];
      if (here && unlocked && file && gain > 0)
        void engine().effect(file, Date.now(), Math.min(1, gain), Date.now() + 1500);
    }
    // The view's cues are summed up by `keys`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, here, unlocked, gain, art.sound]);

  // A short buzz when the viewer's turn comes.
  const was = useRef(yourMove);
  useEffect(() => {
    if (yourMove && !was.current) buzz(200);
    was.current = yourMove;
  }, [yourMove]);

  // Fetch the clips once a game is on.
  const playing = view.phase !== 'lobby';
  useEffect(() => {
    if (!playing || mode === 'off') return;
    engine().prefetch([art.sound.newWord, art.sound.winner].filter((f): f is string => !!f));
  }, [playing, mode, art.sound]);
}
