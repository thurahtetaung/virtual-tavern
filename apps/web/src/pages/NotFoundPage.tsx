import { Link } from 'react-router';
import { Layout } from '../components/Layout.tsx';

export function NotFoundPage({ message = "We couldn't find that page." }: { message?: string }) {
  return (
    <Layout>
      <div className="py-16 text-center">
        <p className="text-6xl" aria-hidden>
          🕯️
        </p>
        <h1 className="mt-4 text-3xl font-bold">Nobody here</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">{message}</p>
        <Link
          to="/"
          className="mt-6 inline-block font-semibold text-amber-700 underline dark:text-amber-400"
        >
          Back to the tavern
        </Link>
      </div>
    </Layout>
  );
}
