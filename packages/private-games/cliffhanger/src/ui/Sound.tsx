import type { GameRoomInfo } from '@vt/game-sdk';
import { cn } from '@vt/ui';
import {
  LobbySound,
  PREVIEW_MS,
  type SoundChannel,
  type SoundSection,
  SoundButton as SoundCorner,
  soundEngineFor,
  soundPlan,
  useTableVolumes,
  whereLine,
} from '@vt/ui/sound';
import type { Manifest } from '../logic/manifest.ts';
import {
  type CliffhangerAction,
  type CliffhangerView,
  SOUND_MODES,
  type SoundMode,
} from '../logic/types.ts';
import { GAME_ID } from './assets.ts';
import { canPlayType, fileOf, soundModeOf } from './audio.ts';
import { TABLE_DEFAULTS, useCliffhangerVolumes } from './useSound.ts';

// Cliffhanger's sound panel: one type, the clock and its buzzers, plus the stings. The host picks
// where it plays (the clock is for the whole table: on a call, every phone).

export const SOUND_NAME: Record<SoundMode, string> = {
  off: 'Off',
  host: 'Host’s device',
  all: 'Every device',
  stage: 'Table screen',
};

const SOUND_HELP: Record<SoundMode, string> = {
  off: 'No device makes a sound.',
  host: 'The host’s device plays the clock and the buzzer: put it in the middle of the table. The describer’s phone still clicks for their own cards.',
  all: 'Every device plays the clock and the buzzer at the same moment (best on a call). The describer’s clock is quieter.',
  stage: 'The table screen plays the clock and the buzzer; phones only buzz.',
};

function channelsOf(audio: Manifest['audio'], personal: boolean): SoundChannel[] {
  const src = fileOf(audio, personal ? 'got' : 'hurry', canPlayType);
  return [
    {
      kind: 'effects',
      label: personal ? 'Your sounds' : 'Clock and buzzers',
      help: personal
        ? 'Got it and switching, on your phone'
        : 'The ticking clock, the buzzer, the stings',
      canPreview: !!src,
      preview: (gain) => (src ? soundEngineFor(GAME_ID).preview(src, gain, PREVIEW_MS) : null),
    },
  ];
}

interface Props {
  view: CliffhangerView;
  room: GameRoomInfo;
  act: (action: CliffhangerAction) => unknown;
  manifest: Manifest | null;
}

function useCliffhangerSound({ view, room, act, manifest }: Props) {
  const [volumes, setVolume] = useCliffhangerVolumes();
  const [table, setTable] = useTableVolumes(
    view.settings.tableVolumes,
    (v) => {
      void act({ type: 'table-volume', volumes: v });
    },
    TABLE_DEFAULTS,
  );
  const audio = manifest?.audio;
  const mode = soundModeOf(view.settings, room.stage?.present === true);
  const plan = soundPlan(mode, room.isHost, ['effects'], mode === 'stage' ? [] : ['effects']);
  const roomHere = mode === 'all' || (mode === 'host' && room.isHost);
  const host = room.players.find((p) => p.id === room.hostId)?.name ?? 'the host';
  const sections: SoundSection[] = [
    {
      title: 'This phone',
      volumes,
      setVolume,
      channels: plan.mine.length ? channelsOf(audio, !roomHere) : [],
      testId: 'cliffhanger-sound-mine',
    },
    {
      title: 'Table screen',
      volumes: table,
      setVolume: setTable,
      channels: plan.table.length ? channelsOf(audio, false) : [],
      testId: 'cliffhanger-sound-table',
    },
  ];
  return { sections, note: whereLine(mode, host, room.isHost), mode };
}

/** The host's choice of where the sound plays. */
function SoundModes({ room, act, mode }: Props & { mode: SoundMode }) {
  const stagePresent = room.stage?.present === true;
  const modes = SOUND_MODES.filter((m) => m !== 'stage' || stagePresent || mode === 'stage');
  return (
    <fieldset className="space-y-2" data-testid="cliffhanger-sound-settings">
      <legend className="sr-only">Where the sound plays</legend>
      {room.isHost ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => void act({ type: 'update-settings', sound: m })}
              className={cn(
                'h-11 rounded-lg text-sm font-semibold ring-1 transition',
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
        A short buzz tells the describer 5 seconds are left, on phones that can buzz.
      </p>
    </fieldset>
  );
}

export function CliffhangerLobbySound(props: Props) {
  const { sections, note, mode } = useCliffhangerSound(props);
  return (
    <LobbySound sections={sections} note={note}>
      <SoundModes {...props} mode={mode} />
    </LobbySound>
  );
}

/** The in-play sound corner. */
export function CliffhangerSoundButton(props: Props) {
  const { sections, note } = useCliffhangerSound(props);
  return <SoundCorner sections={sections} note={note} testId="cliffhanger-sound" />;
}
