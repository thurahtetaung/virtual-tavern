import { type Browser, type Page, expect } from '@playwright/test';
import { openSettings } from './lobby-settings.ts';

export const pageErrors: string[] = [];

export interface Table {
  host: Page;
  players: Page[];
  names: Map<Page, string>;
  /** Each page's role name, once read. */
  roles: Map<Page, string>;
}

export const EVIL = new Set(['Assassin', 'Morgana', 'Mordred', 'Oberon', 'Minion of Mordred']);

export async function seat(
  browser: Browser,
  name: string,
  url = '/',
  options: { viewport?: { width: number; height: number }; colorScheme?: 'dark' | 'light' } = {},
) {
  const page = await (await browser.newContext(options)).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

/** The host opens a Round Table room and everyone else joins it. */
export async function openTable(
  browser: Browser,
  names: string[],
  options: Parameters<typeof seat>[3] = {},
): Promise<Table> {
  const host = await seat(browser, names[0]!, '/', options);
  await host.getByRole('button', { name: 'Create a Round Table room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const others = await Promise.all(names.slice(1).map((n) => seat(browser, n, url, options)));
  const players = [host, ...others];
  await expect(host.getByText(`Players (${names.length}/10)`)).toBeVisible();
  // On a phone the host's settings start folded.
  await openSettings(host);
  return {
    host,
    players,
    names: new Map(players.map((p, i) => [p, names[i]!])),
    roles: new Map(),
  };
}

/** Everyone uncovers their card, reads it, and confirms. */
export async function readRoles(t: Table) {
  for (const p of t.players) {
    await p.getByRole('button', { name: '👁️ Show my role' }).click();
    const name = p.getByTestId('role-name');
    await expect(name).toBeVisible();
    t.roles.set(p, await name.innerText());
  }
  for (const p of t.players) await p.getByRole('button', { name: 'I’ve seen my role' }).click();
  for (const p of t.players) await expect(p.getByRole('list', { name: 'Seats' })).toBeVisible();
}

export const isEvil = (t: Table, p: Page) => EVIL.has(t.roles.get(p)!);
export const withRole = (t: Table, role: string) => t.players.find((p) => t.roles.get(p) === role)!;
export const goodPages = (t: Table) => t.players.filter((p) => !isEvil(t, p));
export const evilPages = (t: Table) => t.players.filter((p) => isEvil(t, p));

/** The page whose status says it leads. */
export async function leader(t: Table): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of t.players)
        if (await p.getByText(/^You lead!/).isVisible()) {
          found = p;
          return true;
        }
      return false;
    })
    .toBe(true);
  return found!;
}

/** The leader taps the team, announces it and, once everyone sees it, calls the vote. */
export async function propose(t: Table, team: Page[]) {
  const lead = await leader(t);
  for (const m of team)
    await lead.getByRole('button', { name: `Pick ${t.names.get(m)} for the team` }).click();
  await lead.getByRole('button', { name: 'Announce this team' }).click();
  for (const p of t.players)
    await expect(p.getByRole('region', { name: 'Announced team' })).toBeVisible();
  await lead.getByRole('button', { name: 'Call the vote' }).click();
  for (const p of t.players) await expect(p.getByRole('region', { name: 'Vote' })).toBeVisible();
}

/** Everyone votes; `no` lists who rejects. */
export async function vote(t: Table, no: Page[] = []) {
  for (const [i, p] of t.players.entries()) {
    const button = p.getByRole('button', { name: no.includes(p) ? 'Reject' : 'Approve' });
    await button.click();
    // The last vote resolves at once; every earlier one is checked in before the next.
    if (i < t.players.length - 1) await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
}

/** The team plays; `fail` lists who plays Fail. */
export async function play(t: Table, team: Page[], fail: Page[] = []) {
  for (const p of team)
    await p.getByRole('button', { name: fail.includes(p) ? '✕ Fail' : '✓ Success' }).click();
}

/** One whole quest: a team approved by all, then played. */
export async function quest(t: Table, team: Page[], fail: Page[] = []) {
  await propose(t, team);
  await vote(t);
  await play(t, team, fail);
}

/** The team size the leader needs now, read from the status line. */
export async function teamSize(t: Table): Promise<number> {
  const lead = await leader(t);
  const text = await lead.getByText(/^You lead!/).innerText();
  return Number(/Tap (\d+) players/.exec(text)![1]);
}
