import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { openBackroom, unlock, visitor } from './inquest-play.ts';
import {
  begin,
  guess,
  nextHour,
  playHour,
  reveal,
  seanceTable,
  sendVisions,
  targetOf,
  vote,
} from './seance-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

test('a ghost and three psychics find everything, read the shared vision in stages and win', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await seanceTable(browser, ['Gwen', 'Ana', 'Ben', 'Cy'], pageErrors);
  const [ghost, ana, ben, cy] = players as [(typeof players)[0], ...typeof players];
  await ana!.page.getByRole('button', { name: /^The purple psychic/ }).click();
  await begin(ghost.page, 'Gwen');

  // The ghost is reminded to stay silent and sees every target; psychics see none.
  await expect(ghost.page.getByText(/You’re the ghost: not a word/)).toBeVisible();
  expect(await targetOf(ghost.page, 'Ana')).toMatch(/^suspect-\d+$/);
  for (const p of [ana!, ben!, cy!]) {
    await expect(p.page.getByText(/waiting for your vision from the ghost/)).toBeVisible();
    await expect(p.page.locator('[aria-label$="’s target)"]')).toHaveCount(0);
  }

  // Hour I: Ana puts ✓ on Ben's and Cy's guesses before guessing herself.
  await sendVisions(ghost.page);
  for (const p of [ben!, cy!]) await guess(p.page, (await targetOf(ghost.page, p.name))!, true);
  for (const name of ['Ben', 'Cy']) {
    await ana!.page
      .getByRole('region', { name: `${name}’s reading` })
      .getByRole('button', { name: '✓ Right' })
      .click();
  }
  await guess(ana!.page, (await targetOf(ghost.page, 'Ana'))!, true);
  // Everyone is Ready, but nothing is judged until the ghost reveals; anyone may still back out.
  const waiting = (p: (typeof players)[0]) => p.page.getByRole('status', { name: 'Waiting for' });
  await expect(waiting(ben!)).toHaveText(/Everyone’s ready: waiting for the ghost to reveal/);
  const revealButton = ghost.page.getByRole('button', { name: '👻 Reveal the verdicts' });
  await expect(revealButton).toBeVisible();
  await ana!.page.getByRole('button', { name: '✓ Ready' }).click();
  await expect(revealButton).toHaveCount(0);
  await expect(waiting(ghost)).toHaveText(/✗ Ana not ready/);
  await ana!.page.getByRole('button', { name: 'Ready', exact: true }).click();
  await reveal(ghost.page);
  for (const p of players) {
    await expect(p.page.getByRole('region', { name: 'The ghost answers' })).toBeVisible();
    await expect(
      p.page.getByText('👻 The ghost revealed the verdicts', { exact: true }),
    ).toBeVisible();
  }
  await expect(ana!.page.getByText('Right! Next, your place.')).toBeVisible();
  await nextHour(ghost.page);

  // Hour II: everyone right, and Ana spends her last two tokens. Hour III: everyone right.
  await sendVisions(ghost.page);
  for (const p of [ben!, cy!]) await guess(p.page, (await targetOf(ghost.page, p.name))!, true);
  for (const name of ['Ben', 'Cy']) {
    await ana!.page
      .getByRole('region', { name: `${name}’s reading` })
      .getByRole('button', { name: '✓ Right' })
      .click();
  }
  await guess(ana!.page, (await targetOf(ghost.page, 'Ana'))!, true);
  await nextHour(ghost.page);
  await playHour(ghost.page, [ana!, ben!, cy!]);

  // The final: Ana (4 + 4 tokens = level 8) votes last, after all three cards.
  const pick = ghost.page.getByRole('region', { name: 'Choose the shared vision' });
  await expect(pick).toBeVisible();
  await ghost.page.getByRole('button', { name: 'This is the culprit (group 2)' }).click();
  for (let i = 0; i < 3; i++)
    await pick.getByRole('list', { name: 'Your hand' }).locator('button[data-pick]').nth(i).click();
  // Tag the first card privately (the tags show at the end).
  await pick
    .getByRole('list', { name: 'Tags' })
    .getByRole('button', { name: /Suspect/ })
    .first()
    .click();
  await pick.getByRole('button', { name: '👻 Send the shared vision' }).click();

  await expect(ben!.page.getByText(/Vote now, in silence/)).toBeVisible();
  await expect(
    ana!.page.getByText('You see more: you vote once 3 cards are face up.'),
  ).toBeVisible();
  // Only the first card is face up for the psychics.
  await expect(
    ben!.page
      .getByRole('region', { name: 'Shared vision' })
      .getByRole('img', { name: 'Face-down vision' }),
  ).toHaveCount(2);
  // Choosing a group casts nothing: only the bar does.
  await ben!.page.getByRole('button', { name: 'Choose group 1' }).click();
  await expect(ben!.page.getByRole('button', { name: '✓ Group 1 chosen' })).toBeVisible();
  await expect(ben!.page.getByText(/Your vote is in/)).toHaveCount(0);
  for (const p of [ben!, cy!]) await vote(p.page, 2);
  await expect(ana!.page.getByText(/Vote now, in silence.*3 of 3/)).toBeVisible();
  await vote(ana!.page, 2);

  for (const p of players) {
    await expect(p.page.getByRole('heading', { name: 'The ghost is at peace' })).toBeVisible();
    await expect(p.page.getByRole('region', { name: 'What the ghost meant' })).toBeVisible();
  }
});

test('the clock runs out after the seventh hour', async ({ browser }) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await seanceTable(browser, ['Hal', 'Ida', 'Jo'], pageErrors);
  const [ghost, ...psychics] = players as [(typeof players)[0], ...typeof players];
  await begin(ghost.page, 'Hal');
  for (let hour = 1; hour <= 7; hour++) {
    await expect(ghost.page.getByRole('list', { name: /^Hour/ })).toHaveAttribute(
      'aria-label',
      new RegExp(`^Hour ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][hour - 1]} of VII$`),
    );
    await playHour(ghost.page, psychics, false);
  }
  for (const p of players) {
    await expect(p.page.getByRole('heading', { name: 'The ghost wanders on' })).toBeVisible();
    await expect(p.page.getByText(/The seventh hour has passed/)).toBeVisible();
  }
});

test('when the ghost goes away, the host hands the seat to a new joiner, never a psychic', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await seanceTable(browser, ['Kim', 'Lou', 'Max'], pageErrors);
  const [host, lou, max] = players as [(typeof players)[0], ...typeof players];
  await begin(host.page, 'Max');
  await expect(max!.page.getByText(/You’re the ghost: not a word/)).toBeVisible();
  await sendVisions(max!.page);
  const url = host.page.url();
  await max!.page.context().close();

  await expect(host.page.getByText(/Waiting for the ghost \(Max, offline\)/)).toBeVisible();
  // Only people watching are offered: the psychics are not.
  await expect(host.page.getByRole('button', { name: /^Hand the ghost to/ })).toHaveCount(0);
  const zed = await visitor(browser, 'Zed', pageErrors);
  await unlock(zed, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
  await expect(zed).toHaveURL(url);
  await host.page.getByRole('button', { name: 'Hand the ghost to Zed' }).click();
  await host.page
    .getByRole('dialog', { name: 'Make Zed the ghost?' })
    .getByRole('button', { name: 'Hand the ghost over' })
    .click();
  await expect(zed.getByText(/You’re the ghost: not a word/)).toBeVisible();
  await expect(lou!.page.getByText(/Zed is the ghost now/)).toBeVisible();
  await expect(host.page.getByRole('button', { name: /^Hand the ghost to/ })).toHaveCount(0);

  // The new ghost carries on: the psychics guess, and the next hour's visions come from Zed.
  for (const p of [host, lou!]) await guess(p.page, (await targetOf(zed, p.name))!, true);
  await nextHour(zed);
  await sendVisions(zed);
  await expect(
    lou!.page.getByText('Your vision is here: which place does it point to?'),
  ).toBeVisible();
});

test('the host retires a departed psychic’s seat and the others play on to the line-up', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await seanceTable(browser, ['Gwen', 'Ana', 'Ben', 'Cy'], pageErrors);
  const [ghost, ana, ben, cy] = players as [(typeof players)[0], ...typeof players];
  await begin(ghost.page, 'Gwen');
  await expect(ghost.page.getByText(/You’re the ghost: not a word/)).toBeVisible();

  // Cy leaves for good: the ghost needn't send them a vision, and the host may retire the seat.
  await cy!.page.getByRole('button', { name: /^Players/ }).click();
  await cy!.page
    .getByRole('dialog', { name: 'Players' })
    .getByRole('button', { name: 'Leave room' })
    .click();
  await cy!.page
    .getByRole('dialog', { name: 'Leave this room?' })
    .getByRole('button', { name: 'Leave', exact: true })
    .click();
  await expect(ana!.page.getByText(/Cy left\. Someone watching can take over/)).toBeVisible();
  await sendVisions(ghost.page);
  await expect(ghost.page.getByRole('button', { name: /^🔍 Choose Cy’s vision$/ })).toHaveCount(0);
  await ghost.page.getByRole('button', { name: 'Retire Cy’s seat' }).click();
  await ghost.page
    .getByRole('dialog', { name: 'Retire Cy’s seat?' })
    .getByRole('button', { name: 'Retire the seat' })
    .click();
  await expect(ben!.page.getByText(/The host retired Cy’s seat/)).toBeVisible();
  await expect(ghost.page.getByRole('region', { name: 'Cy (ghost view)' })).toHaveCount(0);

  // Ana and Ben find everything; the line-up has their two groups only.
  const psychics = [ana!, ben!];
  for (const p of psychics) await guess(p.page, (await targetOf(ghost.page, p.name))!, true);
  await nextHour(ghost.page);
  const final = ghost.page.getByText(/Everyone found their cards! Pick the culprit/);
  const choose = ghost.page.getByRole('button', { name: /^🔍 Choose/ });
  for (;;) {
    await expect(final.or(choose.first())).toBeVisible();
    if (await final.isVisible()) break;
    await playHour(ghost.page, psychics);
  }
  await expect(
    ghost.page.getByRole('button', { name: 'This is the culprit (group 2)' }),
  ).toBeVisible();
  await expect(
    ghost.page.getByRole('button', { name: 'This is the culprit (group 3)' }),
  ).toHaveCount(0);
});

test('a ghost and a psychic open cards full screen, swipe to the next and close', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await seanceTable(browser, ['Nia', 'Oto', 'Pam'], pageErrors);
  const [ghost, oto] = players as [(typeof players)[0], ...typeof players];
  await begin(ghost.page, 'Nia');
  await expect(ghost.page.getByText(/You’re the ghost: not a word/)).toBeVisible();

  // The ghost looks at a hand card: looking never picks it.
  const hand = ghost.page.getByRole('list', { name: 'Your hand' });
  const cards = hand.locator('button[data-card]');
  const first = await cards.nth(0).getAttribute('data-card');
  const second = await cards.nth(1).getAttribute('data-card');
  await cards.nth(0).click();
  const viewer = ghost.page.getByRole('dialog', { name: /^Your hand/ });
  await expect(viewer.locator(`[data-viewer-card="${first}"]`)).toBeVisible();
  await expect(viewer.getByText('1 / 7')).toBeVisible();
  await viewer.press('ArrowRight');
  await expect(viewer.locator(`[data-viewer-card="${second}"]`)).toBeVisible();
  await viewer.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(cards.nth(0)).not.toHaveAttribute('aria-pressed', 'true');

  // A swipe moves on and a swipe down closes (touch-style pointer drags on the card).
  await cards.nth(0).click();
  const stage = viewer.locator('[aria-roledescription="card"]');
  const box = (await stage.boundingBox())!;
  const drag = async (dx: number, dy: number) => {
    await ghost.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await ghost.page.mouse.down();
    await ghost.page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, {
      steps: 6,
    });
    await ghost.page.mouse.up();
  };
  await drag(-150, 0);
  await expect(viewer.locator(`[data-viewer-card="${second}"]`)).toBeVisible();
  await drag(0, 150);
  await expect(viewer).toHaveCount(0);

  // A psychic opens a candidate, and the back button closes it without leaving the room.
  await sendVisions(ghost.page);
  const url = oto!.page.url();
  const candidates = oto!.page
    .getByRole('list', { name: 'Candidates' })
    .locator('button[data-card]');
  const c0 = await candidates.nth(0).getAttribute('data-card');
  const c1 = await candidates.nth(1).getAttribute('data-card');
  await candidates.nth(0).click();
  const look = oto!.page.getByRole('dialog', { name: /on the table/ });
  await expect(look.locator(`[data-viewer-card="${c0}"]`)).toBeVisible();
  await look.press('ArrowRight');
  await expect(look.locator(`[data-viewer-card="${c1}"]`)).toBeVisible();
  // Guessing from the viewer is the button under the card.
  await look.getByRole('button', { name: /^Guess this one/ }).click();
  await expect(look.getByRole('button', { name: /^✓ Your guess/ })).toBeVisible();
  await oto!.page.goBack();
  await expect(look).toHaveCount(0);
  expect(oto!.page.url()).toBe(url);
  await expect(
    oto!.page.getByRole('list', { name: 'Candidates' }).locator(`button[data-pick="${c1}"]`),
  ).toHaveAttribute('aria-pressed', 'true');
});

/** A finger dragged straight down from (x, y), as raw touch events. */
async function swipeDown(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + i * 30 }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('on a phone, a tap straight after swiping the card viewer closed registers', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
  const players = await seanceTable(browser, ['Rae', 'Sol', 'Tam'], pageErrors, phone);
  const [ghost, sol] = players as [(typeof players)[0], (typeof players)[0]];
  await begin(ghost.page, 'Rae');
  await sendVisions(ghost.page);

  const page = sol.page;
  const list = page.getByRole('list', { name: 'Candidates' });
  const card = list.locator('button[data-card]').nth(2);
  const id = await card.getAttribute('data-card');
  const pick = list.locator(`button[data-pick="${id}"]`);
  await card.scrollIntoViewIfNeeded();
  const at = (await pick.boundingBox())!;
  await card.tap();
  const look = page.getByRole('dialog', { name: /on the table/ });
  const stage = look.locator('[aria-roledescription="card"]');
  await expect(stage).toBeVisible();
  const box = (await stage.boundingBox())!;
  await swipeDown(page, box.x + box.width / 2, box.y + box.height / 3);
  // At once, before anything settles: the browser used to swallow this tap.
  await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2);
  await expect(look).toHaveCount(0);
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
});

test('stories, an extra vision pool and the extra suspects and places, played to the end', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await seanceTable(browser, ['Kit', 'Lu', 'Mo'], pageErrors);
  const [ghost, ...psychics] = players as [(typeof players)[0], ...typeof players];
  const host = ghost.page;
  // Objects and no extra visions by default; the host picks stories and the second pool.
  await expect(host.getByRole('button', { name: /^Objects/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(host.getByText('173 visions in play.')).toBeVisible();
  await host.getByRole('button', { name: /^Stories \(20\)/ }).click();
  await host.getByRole('button', { name: /^Extra visions B \(84\)/ }).click();
  await expect(host.getByRole('button', { name: /^✓ Extra visions B/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(host.getByText('257 visions in play.')).toBeVisible();
  await expect(host.getByText(/Story cards take the place of objects/)).toBeVisible();
  // The extra suspects and places are off by default; switching them on adds 20 of each.
  await expect(host.getByText(/31 suspects and 31 places in play\./)).toBeVisible();
  await host.getByRole('button', { name: /^Extra suspects & places \(\+20 suspects/ }).click();
  await expect(host.getByText(/51 suspects and 51 places in play\./)).toBeVisible();
  // A psychic sees the host's choices in the settings summary.
  await expect(
    psychics[0]!.page.locator('details > summary', {
      hasText: /stories · \+1 extra pool · extra suspects & places/,
    }),
  ).toBeVisible();
  await begin(host, 'Kit');

  // Two hours (suspect, place), then each psychic's third card is a story.
  await playHour(host, psychics);
  await playHour(host, psychics);
  for (const p of psychics) {
    expect(await targetOf(host, p.name)).toMatch(/^story-\d+$/);
    await expect(p.page.getByText(/· story 3 of 3/)).toBeVisible();
  }
  // The ghost taps Lu's story in the progress row: the viewer opens on that story, not the suspect.
  const story = (await targetOf(host, 'Lu'))!;
  await host.getByRole('list', { name: 'Progress' }).locator(`[data-card="${story}"]`).click();
  const progressViewer = host.getByRole('dialog', { name: 'Lu’s cards' });
  await expect(progressViewer.locator(`[data-viewer-card="${story}"]`)).toBeVisible();
  await expect(progressViewer.getByText('3 / 3')).toBeVisible();
  await progressViewer.press('Escape');
  await expect(progressViewer).toHaveCount(0);
  // Lu opens a story on the table full screen and can guess it from there.
  const lu = psychics[0]!.page;
  await lu.getByRole('list', { name: 'Candidates' }).locator('button[data-card]').first().click();
  const luViewer = lu.getByRole('dialog', { name: /Stories on the table/ });
  await expect(luViewer.locator('[data-viewer-card^="story-"]')).toBeVisible();
  await expect(luViewer.getByRole('button', { name: /^Guess this one/ })).toBeVisible();
  await luViewer.press('Escape');
  await expect(luViewer).toHaveCount(0);
  // The ghost's sheet shows every story on the table, the target among them.
  await host.getByRole('button', { name: 'All of Lu’s cards' }).click();
  const sheet = host.getByRole('dialog', { name: 'Lu’s cards' });
  const row = sheet.getByRole('list', { name: 'Stories on the table for Lu' });
  await expect(row.locator('[data-card^="story-"]')).toHaveCount(5);
  await expect(row.locator(`[data-card="${await targetOf(host, 'Lu')}"]`)).toHaveAttribute(
    'aria-label',
    /\(Lu’s target\)$/,
  );
  await sheet.getByRole('button', { name: 'Close' }).first().click();
  await expect(sheet).toBeHidden();
  await playHour(host, psychics);

  // The final: with 3 players the shared vision is face up and both psychics vote at once.
  const pick = host.getByRole('region', { name: 'Choose the shared vision' });
  await expect(pick).toBeVisible();
  await expect(pick.getByText(/one for its story/)).toBeVisible();
  await host.getByRole('button', { name: 'This is the culprit (group 1)' }).click();
  for (let i = 0; i < 3; i++)
    await pick.getByRole('list', { name: 'Your hand' }).locator('button[data-pick]').nth(i).click();
  await pick
    .getByRole('list', { name: 'Tags' })
    .getByRole('button', { name: /Story/ })
    .first()
    .click();
  await pick.getByRole('button', { name: '👻 Send the shared vision' }).click();
  for (const p of psychics) await vote(p.page, 1);
  for (const p of players)
    await expect(p.page.getByRole('heading', { name: 'The ghost is at peace' })).toBeVisible();
  // The end shows each psychic's story among their found cards.
  await expect(psychics[0]!.page.locator('[data-card^="story-"]').first()).toBeVisible();
});
