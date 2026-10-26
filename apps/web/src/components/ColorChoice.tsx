import type { Ack, PlayerColor, RoomSnapshot } from '@vt/protocol';
import { ColorPicker } from '@vt/ui';
import { useEffect, useRef, useState } from 'react';

/** The viewer's colour in this room: the swatches and the room's refusal under them. */
export function ColorChoice({
  snapshot,
  recolor,
  onDone,
  heading = true,
}: {
  snapshot: RoomSnapshot;
  recolor: (color: PlayerColor) => Promise<Ack>;
  /** After a change went through. */
  onDone?: () => void;
  /** Off where the dialog's title says it already. */
  heading?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The picker sits at the foot of the Players drawer: on a phone the refusal under it would land
  // below the fold, so bring it into view (its scroll margin clears the sticky Done bar).
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) alertRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [error]);
  const me = snapshot.players.find((p) => p.id === snapshot.you);
  const taken = new Map(
    snapshot.players.filter((p) => p.id !== snapshot.you).map((p) => [p.color, p.name] as const),
  );
  const pick = async (color: PlayerColor) => {
    // Your own colour changes nothing, but dismisses a refusal.
    if (color === me?.color) {
      setError(null);
      return;
    }
    setBusy(true);
    const res = await recolor(color);
    setBusy(false);
    setError(res.ok ? null : res.error.message);
    if (res.ok) onDone?.();
  };
  return (
    <div className="space-y-1">
      {heading && <p className="text-sm font-semibold">Your colour</p>}
      <ColorPicker
        value={me?.color}
        taken={taken}
        disabled={busy}
        colors={snapshot.colors}
        onPick={(c) => void pick(c)}
      />
      {error && (
        <p
          ref={alertRef}
          role="alert"
          className="scroll-mb-20 text-sm font-medium text-danger-ink dark:text-rose-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
