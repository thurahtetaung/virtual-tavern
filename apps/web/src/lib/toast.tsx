import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

interface Toast {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export const useToast = () => useContext(ToastContext);

let nextId = 1;

/** Errors stay a little longer than notices; any toast goes away when tapped. */
const DURATION_MS: Record<Toast['tone'], number> = { error: 6000, info: 4000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (text: string, tone: Toast['tone'] = 'error') => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-2), { id, text, tone }]);
      setTimeout(() => dismiss(id), DURATION_MS[tone]);
    },
    [dismiss],
  );
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            // Errors interrupt (assertive); notices wait their turn (polite).
            role={t.tone === 'error' ? 'alert' : 'status'}
            title="Tap to dismiss"
            onClick={() => dismiss(t.id)}
            className={
              'pointer-events-auto max-w-md cursor-pointer rounded-xl px-4 py-2 text-sm font-medium shadow-lg ' +
              (t.tone === 'error'
                ? 'bg-rose-600 text-white'
                : 'bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900')
            }
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
