import { HydraGame, type HydraUiProps } from '@vt/private-hydra/ui';

/** Hydra's table, dressed from this edition's manifest and art. */
export function HogwartsGame(props: HydraUiProps) {
  return <HydraGame {...props} edition="hogwarts" />;
}
