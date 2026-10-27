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

const KEY = 'vt.hydra.sound';
/** Off out of the box, as the switch was. */
const DEFAULTS = { ...FULL_VOLUMES, effects: 0 };
const NOTE = 'Effects play only on your own phone.';

/** This player's effects volume (the switch from before, on, becomes full volume). */
export function useHydraSound(): { sound: boolean; sections: SoundSection[]; note: string } {
  const [volumes, setVolume] = useVolumes('hydra', DEFAULTS, () => {
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
        testId: 'hydra-sound-mine',
        channels: [
          {
            kind: 'effects',
            label: 'Effects',
            help: 'Cards, stamps, your turn',
            preview: (level) => {
              playSfx('flip', level);
              return { stop: () => {}, volume: () => {} };
            },
          },
        ],
      },
    ],
  };
}

export function HydraLobbySound() {
  const { sections, note } = useHydraSound();
  return <LobbySound sections={sections} note={note} />;
}

export function HydraSoundButton({ className }: { className?: string }) {
  const { sections, note } = useHydraSound();
  return <SoundCorner sections={sections} note={note} className={className} testId="hydra-sound" />;
}
