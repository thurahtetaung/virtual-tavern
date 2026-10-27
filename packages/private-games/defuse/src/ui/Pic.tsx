import { ProtectedImage } from '@vt/ui';
import type { ComponentProps } from 'react';

/**
 * A render that never takes a tap: module layers, glyphs and the casing sit over or under the
 * controls, and `ProtectedImage` makes images catch the pointer (against long-press saving).
 */
export function Pic(props: ComponentProps<typeof ProtectedImage>) {
  return <ProtectedImage {...props} style={{ ...props.style, pointerEvents: 'none' }} />;
}
