import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  accuse,
  notebook,
  playLaps,
  talk,
  roundOrder,
  table,
  writeWord,
} from './red-herring-play.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The e2e server's rig deals known hands and roles (see red-herring-play.ts): Ana picks the first
// word, and the Conspirator sits two seats after the word-picker.

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };
const NAMES = ['Ana', 'Ben', 'Cy', 'Dee'];

/** Whom each voter accuses in round `k` (0-based): Ben always finds the Conspirator, Dee in round 1. */
function target(voter: number, k: number): number {
  const picker = k % 4;
  const conspirator = (k + 2) % 4;
  const finds = voter !== conspirator && (voter === 1 || (voter === 3 && k === 0));
  if (finds) return conspirator;
  return [0, 1, 2, 3].find((i) => i !== picker && i !== voter && i !== conspirator)!;
}

/** The rulebook's points for every round of the game above. */
function expectedScores(rounds: number) {
  const points = [0, 0, 0, 0];
  const tokens = [0, 0, 0, 0];
  const add = (i: number, n: number) => {
    points[i]! += n;
    tokens[i]! += 1;
  };
  for (let k = 0; k < rounds; k++) {
    const picker = k % 4;
    const conspirator = (k + 2) % 4;
    const finders = [0, 1, 2, 3].filter(
      (v) => v !== picker && v !== conspirator && target(v, k) === conspirator,
    );
    for (const f of finders) add(f, 3);
    if (finders.length < 2) {
      add(conspirator, 5);
      add(picker, 4);
    }
  }
  return { points, tokens };
}

test('4 players: a whole game with the secret vote and the rulebook scoring', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = (await table(browser, NAMES, [
    { viewport: PHONE },
    {},
    { viewport: PHONE },
    {},
  ])) as [Page, Page, Page, Page];
  const [ana] = pages;
  await expect(ana.getByTestId('host-settings')).toContainText('8 rounds');
  // The draw pile, face down: both of the game's decks.
  await expect(ana.getByTestId('rh-pile')).toContainText('252 cards in the deck');
  await ana.getByRole('button', { name: 'Start the game' }).click();
  // Every seat's two slots wait face down; the pile is the decks less four hands of six.
  await expect(ana.getByTestId('rh-empty-slot')).toHaveCount(8);
  await expect(ana.getByTestId('rh-pile')).toContainText('228 cards in the deck');

  for (let k = 0; k < 8; k++) {
    const order = roundOrder(pages, k % 4);
    const picker = order[0]!;
    const conspirator = pages[(k + 2) % 4]!;
    await expect(ana.getByTestId('rh-round')).toHaveText(`Round ${k + 1} of 8`);
    await writeWord(picker, `Clue${k + 1}`, k === 0);
    // Everyone but the Conspirator reads the word; the Conspirator's page has no word.
    if (k < 2)
      for (const p of order.slice(1))
        expect(await notebook(p)).toBe(p === conspirator ? '' : `Clue${k + 1}`);
    await playLaps(order);
    // The talk step: the word for everyone, the Conspirator too, until the host starts the vote.
    await talk(pages, ana, `Clue${k + 1}`);
    for (const v of order.slice(1)) {
      const i = pages.indexOf(v);
      await accuse(v, NAMES[target(i, k)]!);
      if (k === 0 && i === 1)
        // Secret: the others see only that Ben voted.
        await expect(pages[2].getByTestId('rh-ballot')).not.toContainText('🔍×');
    }
    // The reveal turns over a step at a time: the votes, the Conspirator, the points.
    // Read from a page that isn't the Conspirator's (theirs says "You were").
    const reveal = (conspirator === ana ? pages[1] : ana).getByTestId('rh-reveal');
    await expect(reveal).toContainText(`${NAMES[(k + 2) % 4]} was the Conspirator`);
    if (k === 0) {
      // Ben and Dee found Cy: 3 each, and Cy and Ana score nothing.
      await expect(reveal).toContainText('Caught!');
      await expect(ana.getByTestId('rh-result-' + (await idOf(ana, 'Ben')))).toContainText('+3');
    }
    await ana.getByTestId('rh-next').click();
  }

  const { points, tokens } = expectedScores(8);
  const best = Math.max(...points);
  const top = [0, 1, 2, 3].filter((i) => points[i] === best);
  const most = Math.max(...top.map((i) => tokens[i]!));
  const winners = top.filter((i) => tokens[i] === most).map((i) => NAMES[i]!);
  // A loser's page names the winner (a winner's own says "You win!").
  const loser = pages[[0, 1, 2, 3].find((i) => !winners.includes(NAMES[i]!))!]!;
  await expect(loser.getByText(/ wins!$| share the win!$/)).toContainText(
    winners.length === 1 ? `${winners[0]} wins` : 'share the win',
  );
  const rows = pages[1].getByRole('region', { name: 'Final standings' }).getByRole('listitem');
  for (const [i, n] of NAMES.entries())
    await expect(rows.filter({ hasText: n }).last()).toHaveText(
      new RegExp(`\\D${points[i]} points?$`),
    );
  await expect(pages[1].getByTestId('rh-rounds').getByRole('listitem')).toHaveCount(8);
});

test('one round with the options: one picture set, No Discussion and the open vote', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = (await table(browser, NAMES)) as [Page, Page, Page, Page];
  const [ana, ben, cy, dee] = pages;
  // One of our picture sets on its own: Reverie's first set, without the game's own decks.
  await ana.getByRole('button', { name: 'Change card sets' }).click();
  const picker = ana.getByRole('dialog');
  await picker.getByRole('checkbox', { name: /Classic deck/ }).uncheck();
  await picker.getByRole('checkbox', { name: /Noir deck/ }).uncheck();
  await picker.getByRole('checkbox', { name: /^Base set/ }).check();
  await expect(picker).toContainText('1 set · 84 cards');
  await picker.getByRole('button', { name: 'Save' }).click();
  await expect(picker).toBeHidden();
  const sets = ana.getByTestId('rh-sets');
  await expect(sets.getByRole('listitem')).toHaveCount(1);
  await expect(sets).toContainText('Playing with this set (84 cards; 4 players need 64).');
  await expect(ben.getByTestId('rh-sets')).toContainText('Base set');
  await ana.getByTestId('rh-no-discussion').click();
  await ana.getByTestId('rh-open-vote').click();
  await expect(ana.getByTestId('rh-open-vote')).toHaveAttribute('aria-checked', 'true');
  await ana.getByRole('button', { name: 'Start the game' }).click();
  // That set only: Ana's hand starts at its first card (Reverie's card 0).
  await expect(ana.getByTestId('rh-hand').locator('[data-card="1000"]')).toHaveCount(1);

  await writeWord(ana, 'Harbour');
  expect(await notebook(cy)).toBe('');
  expect(await notebook(ben)).toBe('Harbour');
  await playLaps(pages);
  // No Discussion: straight to the vote, and the Conspirator still hasn't seen the word.
  await expect(ben.getByTestId('rh-ballot')).toContainText('Vote in turn, in the open');
  await expect(cy.getByText('Harbour')).toHaveCount(0);
  // In turn from Ana's left: Dee waits for Ben and Cy.
  await expect(dee.getByRole('button', { name: 'Accuse Ben' })).toBeDisabled();
  await accuse(ben, 'Cy');
  // Open: the vote shows as it is cast.
  await expect(dee.getByRole('button', { name: 'Accuse Cy' })).toContainText('🔍×1');
  await accuse(cy, 'Dee');
  await accuse(dee, 'Cy');
  const reveal = ana.getByTestId('rh-reveal');
  await expect(reveal).toContainText('Cy was the Conspirator: 2 votes. Caught!');
  await expect(cy.getByTestId('rh-reveal')).toContainText('Harbour');
});

/** A player's id, from the seat list's test id. */
async function idOf(page: Page, name: string): Promise<string> {
  const seat = page.locator('[data-testid^="rh-seat-"]', { hasText: name }).first();
  const id = await seat.getAttribute('data-testid');
  return id!.replace('rh-seat-', '');
}
