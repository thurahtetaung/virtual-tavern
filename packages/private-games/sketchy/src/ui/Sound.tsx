import type { GameRoomInfo } from '@vt/game-sdk';
import {
  LobbySound,
  PREVIEW_MS,
  type SoundChannel,
  type SoundKind,
  type SoundSection,
  SoundButton as SoundCorner,
  soundEngineFor,
  soundPlan,
  useTableVolumes,
  whereLine,
} from '@vt/ui/sound';
import type { SketchyAction, SketchyView } from '../logic/types.ts';
import { GAME_ID, type ManifestState, manifestOf } from './assets.ts';
import { type AudioManifest, MUSIC_SHARE, previewClip, soundModeIn } from './audio.ts';
import { TABLE_DEFAULTS, useSketchyVolumes } from './useSound.ts';

// Sketchy's sound panel: the sliders for the sound that plays on this device (the room's music,
// effects and narrator where the host's choice puts them, a phone's own little sounds everywhere
// sound is on), and for the host with a table screen, the table's.

const HELP: Record<SoundKind, string> = {
  music: 'A tune for each part',
  effects: 'Pencils, yelps, the reveal',
  voice: 'The narrator and jokes',
};

function channelsOf(
  kinds: readonly SoundKind[],
  audio: AudioManifest | undefined,
  personal: boolean,
): SoundChannel[] {
  return kinds.map((kind) => {
    const src = previewClip(audio, kind, personal);
    return {
      kind,
      label:
        kind === 'music'
          ? 'Music'
          : kind === 'voice'
            ? 'Narrator'
            : personal
              ? 'Your sounds'
              : 'Effects',
      help: kind === 'effects' && personal ? 'Your own little sounds' : HELP[kind],
      canPreview: !!src,
      preview: (gain) =>
        src
          ? soundEngineFor(GAME_ID).preview(
              src,
              kind === 'music' ? gain * MUSIC_SHARE : gain,
              PREVIEW_MS,
            )
          : null,
    };
  });
}

interface Props {
  view: SketchyView;
  room: GameRoomInfo;
  act: (action: SketchyAction) => unknown;
  manifest: ManifestState;
}

/** The sections and the where-it-plays line for this device. */
export function useSketchySound({ view, room, act, manifest }: Props): {
  sections: SoundSection[];
  note: string;
} {
  const [volumes, setVolume] = useSketchyVolumes();
  const [table, setTable] = useTableVolumes(
    view.settings.tableVolumes,
    (v) => {
      void act({ type: 'table-volume', volumes: v });
    },
    TABLE_DEFAULTS,
  );
  const audio = manifestOf(manifest)?.audio;
  const mode = soundModeIn(view.settings, room.stage?.present === true);
  // Every phone makes its own little sounds, whoever plays the room's.
  const plan = soundPlan(mode, room.isHost, ['music', 'effects', 'voice'], ['effects']);
  const roomHere = plan.mine.includes('music');
  const host = room.players.find((p) => p.id === room.hostId)?.name ?? 'the host';
  return {
    sections: [
      {
        title: 'This phone',
        volumes,
        setVolume,
        channels: channelsOf(plan.mine, audio, !roomHere),
        testId: 'sketchy-sound-mine',
      },
      {
        title: 'Table screen',
        volumes: table,
        setVolume: setTable,
        channels: channelsOf(plan.table, audio, false),
        testId: 'sketchy-sound-table',
      },
    ],
    note: `${whereLine(mode, host, room.isHost)}${mode !== 'off' && !roomHere ? ' Your phone still makes its own little sounds.' : ''}`,
  };
}

export function SketchyLobbySound(props: Props) {
  const { sections, note } = useSketchySound(props);
  return <LobbySound sections={sections} note={note} />;
}

/** The in-play sound corner (the lobby has its own section). */
export function SketchySoundButton(props: Props) {
  const { sections, note } = useSketchySound(props);
  return <SoundCorner sections={sections} note={note} testId="sketchy-sound" />;
}
