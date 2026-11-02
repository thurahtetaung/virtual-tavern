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

const KEY = 'vt.short-fuse.sound';
/** Every slider at 50 % out of the box. */
const DEFAULTS = { ...DEFAULT_VOLUMES };
/** The volumes key, and the game the host's volumes are shared for. */
export const GAME = 'short-fuse';
const NOTE = 'Effects play only on your own phone.';

/** This player's effects volume (the switch from before, on, becomes full volume). */
export function useShortFuseSound(share: VolumeShare): {
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
  const gain = gainOf(volumes, 'effects');
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

export function ShortFuseLobbySound({ share }: { share: VolumeShare }) {
  const { sections, note } = useShortFuseSound(share);
  return <LobbySound sections={sections} note={note} />;
}

export function ShortFuseSoundButton({
  className,
  share,
}: {
  className?: string;
  share: VolumeShare;
}) {
  const { sections, note } = useShortFuseSound(share);
  return (
    <SoundCorner sections={sections} note={note} className={className} testId="short-fuse-sound" />
  );
}
