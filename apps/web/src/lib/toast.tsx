import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

interface Toast {
  id: number;
  text: string;
  tone: 'error' | 'info';
  /** How many times this same message was shown while it was up ("×2"). */
  count: number;
}

const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export const useToast = () => useContext(ToastContext);

let nextId = 1;

/** Errors stay a little longer than notices; any toast goes away when tapped. */
const DURATION_MS: Record<Toast['tone'], number> = { error: 6000, info: 4000 };

/** At most two at once, so the stack never reaches far into the page; a new one pushes out the oldest. */
const MAX_TOASTS = 2;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const shown = useRef<Toast[]>([]);
  const timers = useRef(new Map<number, number>());
  const update = useCallback((next: Toast[]) => {
    shown.current = next;
    setToasts(next);
  }, []);
  const dismiss = useCallback(
    (id: number) => {
      window.clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      update(shown.current.filter((x) => x.id !== id));
    },
    [update],
  );
  const show = useCallback(
    (text: string, tone: Toast['tone'] = 'error') => {
      // The same message again (a double tap, a repeated refusal) refreshes the one on screen.
      const same = shown.current.find((x) => x.text === text && x.tone === tone);
      const id = same?.id ?? nextId++;
      if (same) {
        update(shown.current.map((x) => (x.id === id ? { ...x, count: x.count + 1 } : x)));
      } else {
        update([...shown.current.slice(1 - MAX_TOASTS), { id, text, tone, count: 1 }]);
      }
      window.clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), DURATION_MS[tone]),
      );
    },
    [dismiss, update],
  );
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* On phones only the newest shows, at most two lines tall, at the right of the site's title
          bar: there it stays clear of both the site title and the room's Invite / Players / Rules
          row (y 81), which a second toast or a third line would cover. */}
      <div className="pointer-events-none fixed inset-x-0 top-1.5 z-50 flex flex-col items-center gap-2 px-4 max-sm:items-end max-sm:pl-48 max-sm:[&>*:not(:last-child)]:hidden sm:top-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            // Errors interrupt (assertive); notices wait their turn (polite).
            role={t.tone === 'error' ? 'alert' : 'status'}
            title="Tap to dismiss"
            onClick={() => dismiss(t.id)}
            className={
              'pointer-events-auto max-w-md cursor-pointer rounded-xl px-4 py-2 text-sm max-sm:px-3 max-sm:py-1.5 font-medium shadow-lg ' +
              (t.tone === 'error'
                ? 'bg-danger dark:bg-rose-600 text-white'
                : 'bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900')
            }
          >
            <span className="max-sm:line-clamp-2 max-sm:text-xs">
              {t.text}
              {t.count > 1 && <span className="ml-2 opacity-75">×{t.count}</span>}
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
