import { Fragment } from 'react';

/** A copy line with its `**stressed**` words in bold. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <Fragment key={i}>{p}</Fragment>))}</>
  );
}

/** The class for the few big display texts that may use an edition's heading font. */
export const DISPLAY = 'hy-display';
