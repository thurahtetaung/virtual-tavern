import { Link } from 'react-router';
import { Layout } from '../components/Layout.tsx';
import { usePageTitle } from '../lib/title.ts';

/**
 * A dead end with a way home. The heading and icon default to "not found"; the room passes its
 * own for being removed, leaving or not getting in, and the tab title follows the heading.
 */
export function NotFoundPage({
  message = "We couldn't find that page.",
  heading = 'Nobody here',
  icon = '🕯️',
  backTo = '/',
  backLabel = 'Back to the tavern',
}: {
  message?: string;
  heading?: string;
  icon?: string;
  backTo?: string;
  backLabel?: string;
}) {
  usePageTitle(heading);
  return (
    <Layout>
      <div className="py-16 text-center">
        <p className="text-6xl" aria-hidden>
          {icon}
        </p>
        <h1 className="mt-4 text-3xl font-bold">{heading}</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">{message}</p>
        <Link
          to={backTo}
          className="mt-6 inline-flex min-h-11 items-center font-semibold text-amber-700 underline dark:text-amber-400"
        >
          {backLabel}
        </Link>
      </div>
    </Layout>
  );
}
