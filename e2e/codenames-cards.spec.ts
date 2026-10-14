import { type Browser, type Page, expect, test } from '@playwright/test';
import { escapeRegExp } from '../packages/game-sdk/src/regex.ts';
import { TEST_ADMIN_PASSWORD, ownLoginLimit } from './credentials.ts';

// Every card's text must sit inside its card, clear of its caption and corner mark, at phone and
// desktop widths and with larger browser text, for the longest phrases a word list can hold.
// SCREENSHOTS=1 also saves each board (light and dark) to test-results/shots/codenames-cards.

const PHRASES = [
  'Charlie & The Chocolate Factory',
  'Diamondback Rattlesnake',
  'Do You Expect Me to Talk?',
  'Car Chase in an Ice Palace',
  'Shorts & Hawaiian Shirt',
  'Blizzard Entertainment',
  'Switchboard Operator',
  'Coffin Corner Punt',
  'Back to the Future',
  'Unused Gym Membership',
  'Life Is Like a Box of Chocolates',
  "Nice Day for Fishin', Ain't It?",
  'Eats Shoots & Leaves',
  'There Can Be Only One',
  'Florence Nightingale',
  'Harlem Globetrotters',
  'Commissioner Gordon',
  'The Flintstones',
  'Terraforming Mars',
  'Microtransaction',
  'Honorificabilitudinitatibus',
  'Buy It, Use It, Break It, Fix It.',
  'The Spy Who Came In from the Cold',
  'Cat',
  'Ice Cream',
];

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function player(browser: Browser, name: string, url = '/') {
  // Sharper shots, so small text can be checked by eye.
  const scale = process.env.SCREENSHOTS ? 2 : 1;
  const page = await (await browser.newContext({ deviceScaleFactor: scale })).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

const board = (page: Page) => page.getByRole('region', { name: 'Word cards' });
/** A card's aria-label ends with its kind and whether it is revealed; words may hold commas. */
const LABEL_END = /(, (Red agent|Blue agent|Bystander|Assassin))?(, revealed)?$/;
const wordOf = (label: string) => label.replace(LABEL_END, '');
const card = (page: Page, word: string) =>
  board(page).getByRole('button', {
    name: new RegExp(`^${escapeRegExp(word)}${LABEL_END.source}`),
  });

/** Every way a card's text breaks the layout, read from the rendered glyph boxes. */
function problems(page: Page) {
  return board(page)
    .getByRole('button')
    .evaluateAll((buttons, end) => {
      const found: string[] = [];
      const canvas = document.createElement('canvas').getContext('2d')!;
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 0.5 &&
        a.right > b.left + 0.5 &&
        a.top < b.bottom - 0.5 &&
        a.bottom > b.top + 0.5;
      const glyphs = (node: Node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect();
      };
      for (const button of buttons) {
        const word = button.getAttribute('aria-label')!.replace(new RegExp(end), '');
        const span = [...button.querySelectorAll('span')].find(
          (s) =>
            s.firstChild instanceof Text && s.firstChild.data.replaceAll('\u00ad', '') === word,
        )!;
        const text = span.firstChild as Text;
        const style = getComputedStyle(span);
        const size = parseFloat(style.fontSize);
        const cardBox = button.getBoundingClientRect();
        // The caption (the kind, under the word) and the corner mark (✓ or ☠).
        const extras = [...button.querySelectorAll(':scope > span')]
          .filter((e) => !e.contains(span) && !e.className.includes('-top-1.5'))
          .map((e) => ({ what: e.textContent.trim(), box: glyphs(e) }));
        if (size < 5) found.push(`${word}: shown at ${size}px`);
        const range = document.createRange();
        for (const run of text.data.matchAll(/\S+/g)) {
          range.setStart(text, run.index);
          range.setEnd(text, run.index + run[0].length);
          const lines = [...range.getClientRects()].filter((r) => r.width > 0);
          const plain = run[0].replaceAll('­', '').toUpperCase();
          for (const r of lines) {
            if (
              r.left < cardBox.left - 0.5 ||
              r.right > cardBox.right + 0.5 ||
              r.top < cardBox.top - 0.5 ||
              r.bottom > cardBox.bottom + 0.5
            )
              found.push(`${word}: "${plain}" runs out of the card`);
            for (const e of extras)
              if (overlaps(r, e.box)) found.push(`${word}: "${plain}" overlaps ${e.what}`);
          }
          if (lines.length > 1) {
            if (plain.replace(/[^A-Z]/g, '').length <= 10)
              found.push(`${word}: the short word "${plain}" breaks`);
            canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const width =
              canvas.measureText(plain).width +
              (parseFloat(style.letterSpacing) || 0) * plain.length;
            if (width <= span.clientWidth)
              found.push(`${word}: "${plain}" breaks although it fits a line by itself`);
          }
        }
      }
      return found;
    }, LABEL_END.source);
}

async function check(page: Page, name: string) {
  for (const [width, height] of [
    [360, 780],
    [390, 844],
    [1280, 900],
  ] as const) {
    for (const textSize of [100, 150]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((t) => {
        document.getElementById('vt-text-size')?.remove();
        if (t === 100) return;
        const style = document.createElement('style');
        style.id = 'vt-text-size';
        style.textContent = `html { font-size: ${t}% }`;
        document.head.append(style);
      }, textSize);
      const view = `${name} ${width}px ${textSize}%`;
      await expect.poll(() => problems(page), { message: view }).toEqual([]);
      if (!process.env.SCREENSHOTS) continue;
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await board(page).screenshot({
          path: `test-results/shots/codenames-cards/${name}-${width}-${textSize}-${scheme}.png`,
        });
      }
      await page.emulateMedia({ colorScheme: null });
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => document.getElementById('vt-text-size')?.remove());
}

// One list for every test, created once and deleted in afterAll with its own request context,
// so a test that runs out of time can't make the cleanup throw.
const NAME = `Zz E2E long phrases ${Math.random().toString(36).slice(2, 7)}`;
let listId: string | undefined;

async function adminContext(browser: Browser) {
  const admin = await browser.newContext();
  await ownLoginLimit(admin);
  const login = await admin.request.post('/api/admin/login', {
    data: { password: TEST_ADMIN_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  return admin;
}

test.beforeAll(async ({ browser }) => {
  const admin = await adminContext(browser);
  // Named to sort last, so other specs' new rooms never default to it.
  const created = await admin.request.post('/api/admin/word-lists', {
    data: { name: NAME, words: PHRASES },
  });
  expect(created.ok()).toBe(true);
  listId = ((await created.json()) as { id: string }).id;
  await admin.close();
});

test.afterAll(async ({ browser }) => {
  if (!listId) return;
  const admin = await adminContext(browser);
  try {
    await admin.request.delete(`/api/admin/word-lists/${listId}`);
  } finally {
    await admin.close();
  }
});

/** A started game on the long-phrase list, with the starting team's spymaster and operative. */
async function startedGame(browser: Browser) {
  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(host.getByText('Pick a team below')).toBeVisible();
  const url = host.url();
  const [ana, ben, cy] = await Promise.all(
    ['Ana', 'Ben', 'Cy'].map((n) => player(browser, n, url)),
  );
  await host.getByRole('button', { name: 'Change word lists' }).click();
  const picker = host.getByRole('dialog');
  for (const box of await picker.getByRole('checkbox', { checked: true }).all())
    await box.uncheck();
  await picker.getByRole('searchbox').fill(NAME);
  await picker.getByRole('checkbox', { name: NAME }).check();
  await picker.getByRole('button', { name: 'Save' }).click();
  await expect(picker).toBeHidden();
  await expect(host.getByRole('region', { name: 'Word lists' }).getByText(NAME)).toBeVisible();

  await host
    .getByRole('region', { name: 'Red team' })
    .getByRole('button', { name: 'Be the Spymaster' })
    .click();
  await ana!.getByRole('button', { name: 'Join Red as Operative' }).click();
  await ben!
    .getByRole('region', { name: 'Blue team' })
    .getByRole('button', { name: 'Be the Spymaster' })
    .click();
  await cy!.getByRole('button', { name: 'Join Blue as Operative' }).click();
  await expect(host.getByText('Everyone is seated')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(board(host).getByRole('button')).toHaveCount(25);
  const labels = await board(host)
    .getByRole('button')
    .evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')!));
  expect(labels.map(wordOf).sort()).toEqual([...PHRASES].sort());

  const redStarts = await host.getByText('Your turn! Give your team').isVisible();
  const [spy, op] = redStarts ? [host, ana!] : [ben!, cy!];
  return { spy, op, team: redStarts ? 'Red' : 'Blue' };
}

/** Two of the team's own cards guessed (✓ and a caption), the longest phrases first. */
async function guessTwo({ spy, op, team }: Awaited<ReturnType<typeof startedGame>>) {
  await spy.getByPlaceholder('e.g. Ocean').fill('Tavern');
  await spy.getByRole('button', { name: '3', exact: true }).click();
  await spy.getByRole('button', { name: 'Give clue' }).click();
  await expect(op.getByText('Your turn to guess')).toBeVisible();
  const ours = (
    await board(spy)
      .getByRole('button', { name: new RegExp(`, ${team} agent`) })
      .evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')!))
  ).map(wordOf);
  // The longest phrases first, so revealed cards include some of the hardest.
  ours.sort((a, b) => b.length - a.length);
  for (const word of ours.slice(0, 2)) {
    await card(op, word).click();
    await op.getByRole('button', { name: `Guess ${word.toUpperCase()}` }).click();
    await expect(card(op, word)).toHaveAttribute('aria-label', /revealed/);
  }
}

// Each board state sets up its own room, so every test stays well inside the default timeout.
test.describe('long phrases fit their cards at every width and text size', () => {
  test.describe.configure({ timeout: 60_000 });

  test("the spymaster's key", async ({ browser }) => {
    // Every card captioned, the assassin with its ☠.
    const { spy } = await startedGame(browser);
    await check(spy, 'spymaster');
  });

  test("the operative's board after two guesses", async ({ browser }) => {
    const game = await startedGame(browser);
    await guessTwo(game);
    await check(game.op, 'operative');
  });

  test("the spymaster's key after two guesses", async ({ browser }) => {
    // The spymaster's cards gain their ✓ in place, so they are fitted again too.
    const game = await startedGame(browser);
    await guessTwo(game);
    await check(game.spy, 'spymaster-guessed');
  });

  test('the end of the game', async ({ browser }) => {
    // Every card captioned, the guessed assassin with its ☠.
    const game = await startedGame(browser);
    const { spy, op } = game;
    await guessTwo(game);
    const assassin = wordOf(
      (await board(spy)
        .getByRole('button', { name: /Assassin/ })
        .getAttribute('aria-label'))!,
    );
    await card(op, assassin).click();
    await op.getByRole('button', { name: `Guess ${assassin.toUpperCase()}` }).click();
    await expect(op.getByText('team wins!').first()).toBeVisible();
    await check(op, 'over');
  });
});
