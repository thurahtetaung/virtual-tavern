import { MasqueradeBoard, type MasqueradeUiProps } from '@vt/game-masquerade/ui';
import { displayFor, useManifest } from './assets.ts';

/** The back-room edition: locations and art come from the private manifest. */
export function MasqueradeOriginalsGame(props: MasqueradeUiProps) {
  const manifest = useManifest();
  return <MasqueradeBoard {...props} display={displayFor(manifest)} />;
}
