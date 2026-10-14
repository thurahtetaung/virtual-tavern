import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** How long a refusal stays next to its control. */
const SHOW_MS = 8000;

interface RefusalApi {
  /** Shows `message` in the slot named `anchor`; false when no such slot is on screen. */
  show: (anchor: string, message: string) => boolean;
  /** The game's wording for a server message (see `useRefusalWording`). */
  format: (message: string) => string;
  setFormat: (format: ((message: string) => string) | null) => void;
  clear: (anchor: string) => void;
  /** Clears every refusal on screen (the player did something else that worked). */
  clearAll: () => void;
  register: (anchor: string) => () => void;
  messages: ReadonlyMap<string, string>;
}

const RefusalContext = createContext<RefusalApi | null>(null);

/** Wraps a game so its `RefusalSlot`s can receive the server's refusals (the room shell does this). */
export function RefusalProvider({ children }: { children: ReactNode }) {
  const mounted = useRef(new Map<string, number>());
  const wording = useRef<((message: string) => string) | null>(null);
  const format = useCallback((message: string) => wording.current?.(message) ?? message, []);
  const setFormat = useCallback((f: ((message: string) => string) | null) => {
    wording.current = f;
  }, []);
  const timers = useRef(new Map<string, number>());
  const [messages, setMessages] = useState<ReadonlyMap<string, string>>(new Map());

  const clear = useCallback((anchor: string) => {
    window.clearTimeout(timers.current.get(anchor));
    timers.current.delete(anchor);
    setMessages((m) => {
      if (!m.has(anchor)) return m;
      const next = new Map(m);
      next.delete(anchor);
      return next;
    });
  }, []);
  const clearAll = useCallback(() => {
    for (const id of timers.current.values()) window.clearTimeout(id);
    timers.current.clear();
    setMessages((m) => (m.size === 0 ? m : new Map()));
  }, []);
  const show = useCallback(
    (anchor: string, message: string) => {
      if (!mounted.current.get(anchor)) return false;
      setMessages((m) => new Map(m).set(anchor, format(message)));
      window.clearTimeout(timers.current.get(anchor));
      timers.current.set(
        anchor,
        window.setTimeout(() => clear(anchor), SHOW_MS),
      );
      return true;
    },
    [clear, format],
  );
  const register = useCallback(
    (anchor: string) => {
      mounted.current.set(anchor, (mounted.current.get(anchor) ?? 0) + 1);
      return () => {
        const left = (mounted.current.get(anchor) ?? 1) - 1;
        if (left > 0) mounted.current.set(anchor, left);
        else {
          mounted.current.delete(anchor);
          clear(anchor);
        }
      };
    },
    [clear],
  );
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of t.values()) window.clearTimeout(id);
    };
  }, []);
  const api = useMemo(
    () => ({ show, clear, clearAll, register, messages, format, setFormat }),
    [show, clear, clearAll, register, messages, format, setFormat],
  );
  return <RefusalContext.Provider value={api}>{children}</RefusalContext.Provider>;
}

/** For the shell: shows a refusal at its anchor, or returns false so the caller can toast it. */
export function useRefusals() {
  const api = useContext(RefusalContext);
  return useMemo(
    () => ({
      show: (anchor: string | undefined, message: string) =>
        anchor !== undefined && api !== null && api.show(anchor, message),
      clear: (anchor: string | undefined) => {
        if (anchor !== undefined) api?.clear(anchor);
      },
      /** After any action that worked: earlier refusals no longer describe the table. */
      clearAll: () => api?.clearAll(),
      /** The game's wording for a message the shell shows as a toast. */
      format: (message: string) => api?.format(message) ?? message,
    }),
    [api],
  );
}

/**
 * Lets a game reword the server's refusals before they're shown, next to a control or as a toast
 * (a back-room edition naming its offices from a private manifest, say).
 */
export function useRefusalWording(format: (message: string) => string) {
  const setFormat = useContext(RefusalContext)?.setFormat;
  useEffect(() => {
    setFormat?.(format);
    return () => setFormat?.(null);
  }, [setFormat, format]);
}

/**
 * Where a game wants the server's refusal of an action to appear: put it right under the control
 * and pass the same `anchor` to `act(action, { anchor })`. Renders nothing until there's a message.
 * A refusal clears itself after a few seconds, when the player's next action works, and when
 * `resetKey` changes (pass something that changes with the game state the refusal was about,
 * such as the turn, so it never outlives the situation).
 */
export function RefusalSlot({
  anchor,
  className,
  resetKey,
}: {
  anchor: string;
  className?: string;
  resetKey?: string | number;
}) {
  const api = useContext(RefusalContext);
  const register = api?.register;
  const clear = api?.clear;
  useEffect(() => {
    return register?.(anchor);
  }, [register, anchor]);
  const shownFor = useRef(resetKey);
  useEffect(() => {
    if (shownFor.current === resetKey) return;
    shownFor.current = resetKey;
    clear?.(anchor);
  }, [clear, anchor, resetKey]);
  const message = api?.messages.get(anchor);
  if (!message) return null;
  return (
    <p
      role="alert"
      className={
        'mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink ring-1 ring-danger-line dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/30 ' +
        (className ?? '')
      }
    >
      {message}
    </p>
  );
}
