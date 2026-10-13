import type { GameGuide } from '@vt/game-sdk';
import { useEffect, useState } from 'react';
import type { ClientGame } from '../games/registry.ts';

/** Named guides already loaded this page, so a card or page mounted later shows them at once. */
const namedGuides = new Map<string, GameGuide>();

/**
 * A game's guide, named from its private manifest once that has loaded (back-room games that
 * offer `namedGuide`); the plain guide until then, or when it can't load. Cards, rules pages and
 * the rules drawer all read it, so a back-room game never shows its placeholder words to players
 * who can see the real ones.
 */
export function useGameGuide(game: ClientGame): GameGuide {
  const [named, setNamed] = useState<{ id: string; guide: GameGuide } | null>(null);
  useEffect(() => {
    if (!game.namedGuide || namedGuides.has(game.id)) return;
    let live = true;
    game
      .namedGuide()
      .then((guide) => {
        namedGuides.set(game.id, guide);
        if (live) setNamed({ id: game.id, guide });
      })
      .catch(() => {
        // No manifest: the plain guide stays.
      });
    return () => {
      live = false;
    };
  }, [game]);
  return (
    (named?.id === game.id ? named.guide : undefined) ??
    (game.namedGuide && namedGuides.get(game.id)) ??
    game.guide
  );
}

/** A game's guide (see `useGameGuide`). */
export function GameGuideView({ game, compact = false }: { game: ClientGame; compact?: boolean }) {
  return <GuideView guide={useGameGuide(game)} compact={compact} />;
}

/** A role entry's anchor, so a game can open the guide at it: "Merlin (Good)" → "guide-role-merlin". */
export const roleAnchor = (name: string) =>
  `guide-role-${name
    .replace(/\s*\(.*\)$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

/** Renders any game's guide with the same structure, so every game reads alike. */
export function GuideView({ guide, compact = false }: { guide: GameGuide; compact?: boolean }) {
  const h = compact ? 'text-base' : 'text-xl';
  return (
    <article className="space-y-6 leading-relaxed">
      {guide.quickStart && guide.quickStart.length > 0 && (
        <section
          aria-label="Quick start"
          className="rounded-2xl bg-card p-4 ring-1 ring-accent-line dark:ring-2 dark:bg-stone-900 dark:ring-amber-500/60"
        >
          <h3 className={`${h} mb-2 font-bold`}>
            <span aria-hidden>⚡ </span>Quick start
          </h3>
          <ul className="space-y-1.5">
            {guide.quickStart.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-amber-600 dark:text-amber-400">
                  ▸
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {compact && (
            <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
              That's enough to start. The full rules follow below.
            </p>
          )}
        </section>
      )}
      <div className="rounded-2xl bg-accent-soft/70 p-4 ring-1 ring-accent-line dark:bg-amber-500/10 dark:ring-amber-500/30">
        <p className="text-sm font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-300">
          Goal
        </p>
        <p className="mt-1 text-lg">{guide.goal}</p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
          <span>👥 {guide.players}</span>
          <span>⏳ {guide.duration}</span>
        </p>
      </div>

      <section>
        <h3 className={`${h} mb-2 font-bold`}>Getting started</h3>
        <ol className="list-inside list-decimal space-y-1">
          {guide.setup.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      {guide.roles && (
        <section>
          <h3 className={`${h} mb-2 font-bold`}>Roles</h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            {guide.roles.map((r) => (
              <div
                key={r.name}
                id={roleAnchor(r.name)}
                className="scroll-mt-4 rounded-xl bg-white p-3 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800"
              >
                <dt className="font-bold">{r.name}</dt>
                <dd className="mt-1 text-sm text-stone-700 dark:text-stone-300">{r.summary}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {guide.sections.map((s) => (
        <section key={s.title}>
          <h3 className={`${h} mb-2 font-bold`}>{s.title}</h3>
          {s.paragraphs?.map((p) => (
            <p key={p} className="mb-2">
              {p}
            </p>
          ))}
          {s.bullets && (
            <ul className="list-disc space-y-1 pl-5">
              {s.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section>
        <h3 className={`${h} mb-2 font-bold`}>Tips</h3>
        <ul className="space-y-1">
          {guide.tips.map((t) => (
            <li key={t}>💡 {t}</li>
          ))}
        </ul>
      </section>

      {guide.glossary && (
        <section>
          <h3 className={`${h} mb-2 font-bold`}>Glossary</h3>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            {guide.glossary.map((g) => (
              <div key={g.term} className="contents">
                <dt className="font-semibold">{g.term}</dt>
                <dd className="mb-2 text-stone-700 sm:mb-0 dark:text-stone-300">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {guide.footer && (
        <footer
          aria-label={guide.footer.title}
          className="rounded-2xl bg-stone-100 p-4 text-sm text-stone-700 ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-300 dark:ring-stone-800"
        >
          <h3 className="mb-1 font-bold">{guide.footer.title}</h3>
          {guide.footer.paragraphs.map((p) => (
            <p key={p} className="mb-1">
              {p}
            </p>
          ))}
          {guide.footer.links && guide.footer.links.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {guide.footer.links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-amber-700 underline dark:text-amber-400"
                >
                  {l.label}
                </a>
              ))}
            </p>
          )}
        </footer>
      )}
    </article>
  );
}
