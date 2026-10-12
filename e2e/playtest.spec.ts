import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, ownLoginLimit } from './credentials.ts';
import { EVIL, type Table, readRoles } from './round-table-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const watch = (p: Page) => {
  p.on('pageerror', (e) => pageErrors.push(e.message));
  p.on('dialog', (d) => void d.accept());
  return p;
};

/** One normal browser (one context), signed in as the tavern keeper, on the Playtest tab. */
async function keeper(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<{ context: BrowserContext; admin: Page }> {
  const context = await browser.newContext(options);
  context.on('page', watch);
  const admin = await context.newPage();
  await ownLoginLimit(admin);
  await admin.goto('/tavern-keeper');
  await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByRole('link', { name: '🧪 Playtest' }).click();
  await expect(admin.getByRole('heading', { name: '🧪 New playtest' })).toBeVisible();
  return { context, admin };
}

/** Starts a playtest of `game` with `seats` seats; seat 1's tab opens on its own. */
async function startPlaytest(context: BrowserContext, admin: Page, game: RegExp, seats?: number) {
  await admin.getByRole('radio', { name: game }).click();
  if (seats !== undefined) {
    const count = admin.getByRole('group', { name: 'Seats' });
    for (;;) {
      const now = Number(await count.locator('span[aria-live]').innerText());
      if (now === seats) break;
      await count
        .getByRole('button', { name: now < seats ? 'One seat more' : 'One seat fewer' })
        .click();
    }
  }
  const opened = context.waitForEvent('page');
  await admin.getByRole('button', { name: 'Start playtest' }).click();
  const first = await opened;
  await expect(first).toHaveURL(/\/r\/[a-z0-9-]+$/);
  return first;
}

/** Opens another seat from its link on the Playtest tab (a new tab in the same browser). */
async function openSeat(context: BrowserContext, admin: Page, name: string) {
  const opened = context.waitForEvent('page');
  await admin
    .getByRole('link', { name: `Open ${name}`, exact: true })
    .first()
    .click();
  const page = await opened;
  await expect(page.getByTestId('playtest-seat')).toHaveText(name);
  return page;
}

/** How many stats events a room left, from a dry run of the admin delete. */
async function roomEvents(admin: Page, roomId: string) {
  const res = await admin.request.delete(`/api/admin/stats/rooms/${roomId}?dryRun=1`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { deleted: Record<string, number> }).deleted;
}

const roomIdOf = (p: Page) => new URL(p.url()).pathname.split('/').at(-1)!;

test('every seat of a Round Table playtest is its own tab in one browser, off the record', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, admin } = await keeper(browser);
  const ana = await startPlaytest(context, admin, /^Round Table/);
  // The seat's secret left the address bar as soon as the tab took it.
  expect(ana.url()).not.toContain('#');
  await expect(ana.getByTestId('playtest-seat')).toHaveText('Ana');
  await expect(ana).toHaveTitle(/^Ana · Round Table/);
  // Nobody can be invited to a playtest.
  await expect(ana.getByRole('button', { name: 'Invite friends' })).toHaveCount(0);

  const players = [ana];
  for (const name of ['Ben', 'Cy', 'Dee', 'Eli'])
    players.push(await openSeat(context, admin, name));
  await expect(ana.getByText('Players (5/10)')).toBeVisible();
  await ana.getByRole('button', { name: 'Start game' }).click();
  const t: Table = { host: ana, players, names: new Map(), roles: new Map() };
  await readRoles(t);
  // Five tabs, one browser, five different seats: Good and Evil cards both dealt.
  const roles = [...t.roles.values()];
  expect(roles.some((r) => EVIL.has(r))).toBe(true);
  expect(roles.some((r) => !EVIL.has(r))).toBe(true);

  // Private marks are per seat, though every tab shares this browser's storage.
  const mark = (p: Page, who: string) =>
    p.getByRole('button', { name: new RegExp(`^Your private mark on ${who}:`) });
  await mark(ana, 'Ben').click();
  await expect(mark(ana, 'Ben')).toHaveAccessibleName(/trusted$/);
  await players[2]!.reload();
  await expect(mark(players[2]!, 'Ben')).toHaveAccessibleName(/none$/);
  await ana.reload();
  await expect(mark(ana, 'Ben')).toHaveAccessibleName(/trusted$/);
  await expect(ana.getByTestId('playtest-seat')).toHaveText('Ana');

  // Nothing was recorded, and the Live tab doesn't count it as a room.
  const roomId = roomIdOf(ana);
  expect(Object.values(await roomEvents(admin, roomId)).every((n) => n === 0)).toBe(true);
  const live = (await (await admin.request.get('/api/admin/stats/live')).json()) as {
    rooms: { id: string }[];
    playtests: number;
  };
  expect(live.rooms.map((r) => r.id)).not.toContain(roomId);
  expect(live.playtests).toBeGreaterThanOrEqual(1);

  // A seat link is useless in anyone else's browser.
  const stranger = watch(await (await browser.newContext()).newPage());
  const link = await admin
    .getByRole('link', { name: 'Open Ben', exact: true })
    .first()
    .getAttribute('href');
  await stranger.goto(link!);
  await expect(stranger.getByRole('heading', { name: 'No such room' })).toBeVisible();
  await stranger.context().close();

  // The host seat ends it: every tab says so.
  await ana.getByRole('button', { name: 'End playtest' }).click();
  for (const p of players)
    await expect(p.getByRole('heading', { name: 'This playtest has ended' })).toBeVisible();
  await admin.reload();
  await expect(admin.getByText('None running.')).toBeVisible();
  await context.close();
});

test('a back-room playtest needs no back-room unlock', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, admin } = await keeper(browser);
  // This browser has no back-room unlock at all.
  expect((await context.cookies()).some((c) => c.name === 'vt_backroom')).toBe(false);
  const ana = await startPlaytest(context, admin, /^Royal Post/);
  const ben = await openSeat(context, admin, 'Ben');
  await expect(ana.getByText('Players (2/4)')).toBeVisible();
  await ana.getByRole('button', { name: 'Start game' }).click();
  await expect(ana.getByRole('region', { name: 'Your hand' })).toBeVisible();
  await expect(ben.getByRole('region', { name: 'Your hand' })).toBeVisible();
  // The admin's own page ends it this time.
  await admin.getByRole('button', { name: 'End', exact: true }).click();
  for (const p of [ana, ben])
    await expect(p.getByRole('heading', { name: 'This playtest has ended' })).toBeVisible();
  await context.close();
});

test('a normal room opened in two tabs of one browser is still one player', async ({ browser }) => {
  const context = await browser.newContext();
  context.on('page', watch);
  const first = await context.newPage();
  await first.addInitScript(() => localStorage.setItem('vt.playerName', 'Solo'));
  await first.goto('/');
  await first.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(first).toHaveURL(/\/r\//);
  // A crafted seat fragment on a normal room is ignored and wiped.
  const second = await context.newPage();
  await second.goto(`${first.url()}#seat=${'A'.repeat(43)}&as=Mallory`);
  await expect(second.getByRole('heading', { name: /Codenames/ })).toBeVisible();
  expect(second.url()).not.toContain('#');
  await second.getByRole('button', { name: /^Players/ }).click();
  const drawer = second.getByRole('dialog', { name: 'Players' });
  await expect(drawer.getByText('Solo', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Mallory')).toHaveCount(0);
  await expect(drawer.getByRole('listitem')).toHaveCount(1);
  await expect(second.getByTestId('playtest-seat')).toHaveCount(0);
  // A refresh rejoins as the same player, and the landing page offers the room back.
  await second.reload();
  await second.getByRole('button', { name: /^Players/ }).click();
  await expect(second.getByRole('dialog', { name: 'Players' }).getByRole('listitem')).toHaveCount(
    1,
  );
  await second.goto('/');
  await expect(second.getByRole('link', { name: 'Rejoin your Codenames room' })).toBeVisible();
  // A visitor with no name saved is still asked for one.
  const fresh = watch(await (await browser.newContext()).newPage());
  await fresh.goto(new URL(first.url()).pathname);
  await expect(
    fresh.getByRole('heading', { name: "You're invited to play Codenames!" }),
  ).toBeVisible();
  await fresh.context().close();
  await context.close();
});
