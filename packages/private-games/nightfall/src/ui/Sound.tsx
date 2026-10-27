import type { GameRoomInfo } from '@vt/game-sdk';
import {
  LobbySound,
  PREVIEW_MS,
  type SoundChannel,
  type SoundKind,
  type SoundSection,
  SoundButton as SoundCorner,
  previewElement,
  soundPlan,
  whereLine,
} from '@vt/ui/sound';
import { FRAME_LINES } from '../logic/plan.ts';
import type { NightfallView } from '../logic/types.ts';
import { type Manifest, assetUrl } from './assets.ts';
import { trackFor } from './audio.ts';
import { MUSIC_SHARE, useNightfallVolumes } from './useSound.ts';

// Nightfall's sound panel: the music and narration sliders, on the devices the host's narration
// choice makes speak. Text narration always shows, so a quiet phone loses nothing.

/** The clip a ▶ preview plays: a few seconds of the night's music, or one of the narrator's lines. */
export function previewClip(manifest: Manifest | null, kind: SoundKind): string | null {
  if (kind === 'music')
    return trackFor(manifest?.music, 'night', 1) ?? trackFor(manifest?.music, 'lobby', 1);
  const lines = manifest?.narration ?? {};
  const first = lines[FRAME_LINES.nightStart] ?? Object.values(lines).find((l) => l.length);
  return first?.[0] ?? null;
}

function useNightfallSound({
  view,
  room,
  manifest,
}: {
  view: NightfallView;
  room: GameRoomInfo;
  manifest: Manifest | null;
}): { sections: SoundSection[]; note: string } {
  const [volumes, setVolume] = useNightfallVolumes();
  const mode = view.settings.narration;
  const kinds: SoundKind[] = [
    ...(view.settings.music && manifest?.music ? ['music' as const] : []),
    'voice',
  ];
  const plan = soundPlan(mode, room.isHost, kinds);
  const channels: SoundChannel[] = plan.mine.map((kind) => {
    const src = previewClip(manifest, kind);
    return {
      kind,
      label: kind === 'music' ? 'Music' : 'Narration',
      help: kind === 'music' ? 'Behind the narrator' : 'The narrator’s voice',
      canPreview: !!src,
      preview: (gain) =>
        src
          ? previewElement(assetUrl(src), kind === 'music' ? gain * MUSIC_SHARE : gain, PREVIEW_MS)
          : null,
    };
  });
  const host = room.players.find((p) => p.id === room.hostId)?.name ?? 'the host';
  const note =
    mode === 'off'
      ? 'Narration is off: the host’s choice. The narrator’s words still show on every screen.'
      : `${whereLine(mode, host, room.isHost)} The narrator’s words show on every screen.`;
  return { sections: [{ volumes, setVolume, channels, testId: 'nightfall-sound-mine' }], note };
}

export function NightfallLobbySound(props: Parameters<typeof useNightfallSound>[0]) {
  const { sections, note } = useNightfallSound(props);
  return <LobbySound sections={sections} note={note} />;
}

/** The in-play sound corner. */
export function NightfallSoundButton(props: Parameters<typeof useNightfallSound>[0]) {
  const { sections, note } = useNightfallSound(props);
  return <SoundCorner sections={sections} note={note} testId="sound-controls" />;
}
