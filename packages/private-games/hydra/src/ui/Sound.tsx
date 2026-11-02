import {
  DEFAULT_VOLUMES,
  LobbySound,
  type SoundSection,
  type VolumeKey,
  type VolumeShare,
  SoundButton as SoundCorner,
  gainOf,
  useVolumeShare,
  useVolumes,
} from '@vt/ui/sound';
import { storageKey } from '@vt/game-sdk';
import { useEffect } from 'react';
import { playSfx, setSfxLevel } from './fx.ts';

// The sound panel: one Effects slider (the effects are made on the phone, nothing is fetched), at
// 50 % out of the box. The ▶ plays one of the game's own effects at the slider's level.

const KEY = 'vt.hydra.sound';
/** Every slider at 50 % out of the box. */
const DEFAULTS = { ...DEFAULT_VOLUMES };
/** The volumes key, and the game the host's volumes are shared for. */
export const GAME = 'hydra';
const NOTE = 'Effects play only on your own phone.';

/** This player's effects volume (the switch from before, on, becomes full volume). */
export function useHydraSound(share: VolumeShare): {
  sound: boolean;
  sections: SoundSection[];
  note: string;
  setVolume: (which: VolumeKey, level: number) => void;
} {
  const [volumes, setVolume] = useVolumes(GAME, DEFAULTS, () => {
    try {
      return localStorage.getItem(storageKey(KEY)) === 'true' ? { effects: 1 } : null;
    } catch {
      return null;
    }
  });
  const shared = useVolumeShare(share, setVolume);
  // The only type, so its slider is the whole volume (no master shows).
  const gain = gainOf(volumes, 'effects', ['effects']);
  useEffect(() => {
    setSfxLevel(gain);
  }, [gain]);
  return {
    sound: gain > 0,
    note: NOTE,
    setVolume,
    sections: [
      {
        volumes,
        setVolume: shared.setVolume,
        hostSet: shared.hostSet,
        caption: shared.caption,
        hostMode: shared.hostMode,
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

export function HydraLobbySound({ share }: { share: VolumeShare }) {
  const { sections, note } = useHydraSound(share);
  return <LobbySound sections={sections} note={note} />;
}

export function HydraSoundButton({ className, share }: { className?: string; share: VolumeShare }) {
  const { sections, note } = useHydraSound(share);
  return <SoundCorner sections={sections} note={note} className={className} testId="hydra-sound" />;
}
