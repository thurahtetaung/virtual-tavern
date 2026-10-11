import { useEffect } from 'react';

const SITE = 'Virtual Tavern';

/** "Page · Virtual Tavern", or just the site name for the landing page. */
export const pageTitle = (page?: string) => (page ? `${page} · ${SITE}` : SITE);

/** The tab title for a room: marked when the viewer is expected to act, so a background tab stands out. */
export function roomTitle(gameName: string, yourMove: boolean): string {
  const title = pageTitle(gameName);
  return yourMove ? `● Your turn · ${title}` : title;
}

/** Names the tab after the page while it is shown; `null` leaves the title to someone else. */
export function usePageTitle(page?: string | null) {
  useEffect(() => {
    if (page !== null) document.title = pageTitle(page);
  }, [page]);
}
