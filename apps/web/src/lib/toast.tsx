import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

interface Toast {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export const useToast = () => useContext(ToastContext);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: Toast['tone'] = 'error') => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              'pointer-events-auto max-w-md rounded-xl px-4 py-2 text-sm font-medium shadow-lg ' +
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
