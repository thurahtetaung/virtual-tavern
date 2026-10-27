import type { GameRoomInfo } from '@vt/game-sdk';
import {
  LobbySound,
  PREVIEW_MS,
  type SoundChannel,
  type SoundKind,
  type SoundSection,
  SoundButton as SoundCorner,
  soundPlan,
  useTableVolumes,
  whereLine,
} from '@vt/ui/sound';
import type { GoingOnceView, Sender } from '../logic/types.ts';
import type { Act } from './act.ts';
import type { ManifestState } from './assets.ts';
import { type AudioManifest, musicLevel, previewClip, soundModeIn } from './audio.ts';
import { soundEngine } from './engine.ts';
import { useGoVolumes } from './useSound.ts';

// Going Once's sound panel: the sliders for the sound that plays on this device (the room's music,
// effects and voice where the host's choice puts them, a player's own tip rings everywhere sound
// is on), and for the host with a table screen, the table's.

const HELP: Record<SoundKind, string> = {
  music: 'A track for each part',
  effects: 'Paddles, yelps, Sold',
  voice: 'The auctioneer',
};

function channelsOf(
  kinds: readonly SoundKind[],
  audio: AudioManifest | undefined,
  ringsOnly: boolean,
  contact: Sender | undefined,
): SoundChannel[] {
  return kinds.map((kind) => {
    const src = previewClip(audio, kind, { ringsOnly, contact });
    return {
      kind,
      label:
        kind === 'music'
          ? 'Music'
          : kind === 'voice'
            ? 'Voice'
            : ringsOnly
              ? 'Your rings'
              : 'Effects',
      help: kind === 'effects' && ringsOnly ? 'Tips ringing on your phone' : HELP[kind],
      canPreview: !!src,
      preview: (gain) =>
        src
          ? soundEngine().preview(
              src,
              kind === 'music' ? musicLevel(gain, false) : gain,
              PREVIEW_MS,
            )
          : null,
    };
  });
}

/** The sections and the where-it-plays line for this device. */
export function useGoSound({
  view,
  room,
  act,
  manifest,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  manifest: ManifestState;
}): { sections: SoundSection[]; note: string } {
  const [volumes, setVolume] = useGoVolumes();
  const [table, setTable] = useTableVolumes(view.settings.tableVolumes, (v) => {
    void act({ type: 'table-volume', volumes: v });
  });
  const audio = manifest && manifest !== 'unavailable' ? manifest.audio : undefined;
  const mode = soundModeIn(view.settings, room.stage?.present === true);
  const roomKinds: SoundKind[] = [
    'music',
    'effects',
    ...(view.settings.voice ? ['voice' as const] : []),
  ];
  // A phone that doesn't play the room's sound still rings for its own tips.
  const plan = soundPlan(mode, room.isHost, roomKinds, ['effects']);
  const roomHere = plan.mine.includes('music');
  const contact = view.mine?.contact;
  const host = room.players.find((p) => p.id === room.hostId)?.name ?? 'the host';
  return {
    sections: [
      {
        title: 'This phone',
        volumes,
        setVolume,
        channels: channelsOf(plan.mine, audio, !roomHere, contact),
        testId: 'go-sound-mine',
      },
      {
        title: 'Table screen',
        volumes: table,
        setVolume: setTable,
        channels: channelsOf(plan.table, audio, false, contact),
        testId: 'go-sound-table',
      },
    ],
    note: `${whereLine(mode, host, room.isHost)}${mode !== 'off' && !roomHere ? ' Your own tips still ring here.' : ''}`,
  };
}

export function GoLobbySound(props: Parameters<typeof useGoSound>[0]) {
  const { sections, note } = useGoSound(props);
  return <LobbySound sections={sections} note={note} />;
}

/** The in-play sound corner (the lobby has its own section). */
export function GoSoundButton(props: Parameters<typeof useGoSound>[0]) {
  const { sections, note } = useGoSound(props);
  return <SoundCorner sections={sections} note={note} testId="go-sound" />;
}
