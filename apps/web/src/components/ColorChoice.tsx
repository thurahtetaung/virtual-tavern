import type { Ack, PlayerColor, RoomSnapshot } from '@vt/protocol';
import { ColorPicker } from '@vt/ui';
import { useState } from 'react';

/**
 * The viewer's colour in this room: the swatches and the room's refusal under them. While a game is
 * in play and not between rounds the swatches are simply disabled.
 */
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
  const me = snapshot.players.find((p) => p.id === snapshot.you);
  // Without `colors` (no meta yet), only the lobby and the end screen allow it.
  const open = snapshot.meta?.colors ?? snapshot.meta?.phase !== 'playing';
  const taken = new Map(
    snapshot.players.filter((p) => p.id !== snapshot.you).map((p) => [p.color, p.name] as const),
  );
  const pick = async (color: PlayerColor) => {
    if (color === me?.color) return;
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
        disabled={!open || busy}
        onPick={(c) => void pick(c)}
      />
      {open && error && (
        <p role="alert" className="text-sm font-medium text-danger-ink dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
