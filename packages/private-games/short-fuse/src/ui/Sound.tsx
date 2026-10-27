import {
  FULL_VOLUMES,
  LobbySound,
  type SoundSection,
  SoundButton as SoundCorner,
  gainOf,
  useVolumes,
} from '@vt/ui/sound';
import { storageKey } from '@vt/game-sdk';
import { useEffect } from 'react';
import { playSfx, setSfxLevel } from './fx.ts';

// The sound panel: one Effects slider (the effects are made on the phone, nothing is fetched), off
// out of the box as before. The ▶ plays one of the game's own effects at the slider's level.

const KEY = 'vt.short-fuse.sound';
/** Off out of the box, as the switch was. */
const DEFAULTS = { ...FULL_VOLUMES, effects: 0 };
const NOTE = 'Effects play only on your own phone.';

/** This player's effects volume (the switch from before, on, becomes full volume). */
export function useShortFuseSound(): { sound: boolean; sections: SoundSection[]; note: string } {
  const [volumes, setVolume] = useVolumes('short-fuse', DEFAULTS, () => {
    try {
      return localStorage.getItem(storageKey(KEY)) === 'true' ? { effects: 1 } : null;
    } catch {
      return null;
    }
  });
  const gain = gainOf(volumes, 'effects');
  useEffect(() => {
    setSfxLevel(gain);
  }, [gain]);
  return {
    sound: gain > 0,
    note: NOTE,
    sections: [
      {
        volumes,
        setVolume,
        testId: 'short-fuse-sound-mine',
        channels: [
          {
            kind: 'effects',
            label: 'Effects',
            help: 'Your turn, Nope, the boom',
            preview: (level) => {
              playSfx('boom', level);
              return { stop: () => {}, volume: () => {} };
            },
          },
        ],
      },
    ],
  };
}

export function ShortFuseLobbySound() {
  const { sections, note } = useShortFuseSound();
  return <LobbySound sections={sections} note={note} />;
}

export function ShortFuseSoundButton({ className }: { className?: string }) {
  const { sections, note } = useShortFuseSound();
  return (
    <SoundCorner sections={sections} note={note} className={className} testId="short-fuse-sound" />
  );
}
