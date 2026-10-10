import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-stone-200/80 bg-white/60 backdrop-blur dark:border-stone-800 dark:bg-stone-950/60">
        <div
          className={`mx-auto flex h-14 items-center justify-between px-4 ${wide ? 'max-w-7xl' : 'max-w-4xl'}`}
        >
          <Link to="/" className="flex items-center gap-2 font-serif text-xl font-bold">
            <span aria-hidden>🍺</span> Virtual Tavern
          </Link>
          <nav className="flex gap-4 text-sm font-medium text-stone-600 dark:text-stone-400">
            <Link to="/rules" className="hover:text-amber-700 dark:hover:text-amber-400">
              How to play
            </Link>
          </nav>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 py-6 ${wide ? 'max-w-7xl' : 'max-w-4xl'}`}>
        {children}
      </main>
      <footer className="py-6 text-center text-xs text-stone-500">
        A cosy corner of the internet for game nights with friends.
      </footer>
    </div>
  );
}
