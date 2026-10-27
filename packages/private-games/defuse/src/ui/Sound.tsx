import type { GameRoomInfo } from '@vt/game-sdk';
import {
  LobbySound,
  PREVIEW_MS,
  type SoundChannel,
  type SoundKind,
  type SoundSection,
  SoundButton as SoundCorner,
  previewElement,
  useTableVolumes,
} from '@vt/ui/sound';
import type { Action } from '../logic/types.ts';
import type { DefuseView } from '../logic/view.ts';
import type { Art } from './assets.ts';
import { MUSIC_LEVEL, useDefuseVolumes } from './sound.ts';

// Defuse's sound panel: the bomb's music and effects play on the defuser's phone (and a table
// screen showing it), so those are the phones with sliders; the host sets the table screen's.

/** The clip a ▶ preview plays: a few seconds of the bomb's music, or the timer's beep. */
export function previewClip(art: Art, kind: SoundKind): string | null {
  if (kind === 'music') return art.music('game-a')[0] ?? art.music('game-b')[0] ?? null;
  return art.effect('doublebeep') ?? art.effect('snip');
}

function channelsOf(kinds: readonly SoundKind[], art: Art): SoundChannel[] {
  return kinds.map((kind) => {
    const src = previewClip(art, kind);
    return {
      kind,
      label: kind === 'music' ? 'Music' : 'Effects',
      help: kind === 'music' ? 'Rises as time runs out' : 'Beeps, strikes, the boom',
      canPreview: !!src,
      preview: (gain) =>
        src ? previewElement(src, kind === 'music' ? gain * MUSIC_LEVEL : gain, PREVIEW_MS) : null,
    };
  });
}

interface Props {
  v: DefuseView;
  room: GameRoomInfo;
  art: Art;
  send: (a: Action) => void;
  /** This device plays the bomb now (the defuser's, or its end). */
  playsBomb: boolean;
  nameOf: (id: string | null) => string;
}

function useDefuseSound({ v, room, art, send, playsBomb, nameOf }: Props): {
  sections: SoundSection[];
  note: string;
} {
  const [volumes, setVolume] = useDefuseVolumes();
  const [table, setTable] = useTableVolumes(v.tableVolumes, (t) => {
    send({ type: 'table-volume', volumes: t });
  });
  const both: SoundKind[] = ['music', 'effects'];
  // Between bombs anyone may defuse next, so everyone can set their own.
  const mine = v.stage === 'lobby' || playsBomb ? both : [];
  const stage = room.stage?.present === true;
  const tableToo = stage ? ' and on the table screen' : '';
  const note =
    v.stage === 'lobby'
      ? `The bomb’s sound plays on the defuser’s phone${tableToo}.`
      : playsBomb
        ? `The bomb’s sound plays on your phone${tableToo}.`
        : `The bomb’s sound plays on ${nameOf(v.defuser)}’s phone (the defuser)${tableToo}.`;
  return {
    sections: [
      {
        title: 'This phone',
        volumes,
        setVolume,
        channels: channelsOf(mine, art),
        testId: 'defuse-sound-mine',
      },
      {
        title: 'Table screen',
        volumes: table,
        setVolume: setTable,
        channels: channelsOf(room.isHost && stage ? both : [], art),
        testId: 'defuse-sound-table',
      },
    ],
    note: stage && room.isHost ? `${note} Your Table screen sliders set its volume.` : note,
  };
}

export function DefuseLobbySound(props: Props) {
  const { sections, note } = useDefuseSound(props);
  return <LobbySound sections={sections} note={note} />;
}

/** The in-play sound corner. */
export function DefuseSoundButton(props: Props & { className?: string }) {
  const { sections, note } = useDefuseSound(props);
  return (
    <SoundCorner
      sections={sections}
      note={note}
      className={props.className}
      testId="defuse-sound"
    />
  );
}
