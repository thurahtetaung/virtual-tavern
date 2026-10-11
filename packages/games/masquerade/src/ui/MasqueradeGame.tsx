import { publicDisplay } from './display.ts';
import { MasqueradeBoard, type MasqueradeUiProps } from './MasqueradeBoard.tsx';

/** The public game: our own pack of places. */
export function MasqueradeGame(props: MasqueradeUiProps) {
  return <MasqueradeBoard {...props} display={publicDisplay} />;
}
