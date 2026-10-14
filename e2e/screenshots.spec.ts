import { type Browser, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';
import {
  dismissAnyEvent,
  dismissEvent,
  openBackroom as openInquestBackroom,
  placeBullets,
  presentAll as presentInquest,
  endDiscussion as endInquestDiscussion,
  solve as inquestSolve,
  replaceTile,
  startPresentations as startInquestPresentations,
  table as inquestTable,
  unlock as unlockInquest,
  visitor as inquestVisitor,
  whoShows,
  withRole,
} from './inquest-play.ts';
import { readCards, readyUp, votes } from './masquerade-play.ts';
import * as hy from './hydra-play.ts';
import { MANIFEST as HOGWARTS, WORDS as HOGWARTS_WORDS } from './hogwarts-manifest.ts';
import * as rt from './round-table-play.ts';
import { confirmWrap } from './recap-play.ts';
import {
  VAMPIRES,
  getReady,
  peek,
  playMarkedNight,
  playNight,
  setRoles,
} from './nightfall-play.ts';
import { type Exercised, type Shot, playUntil } from './royal-post-play.ts';
import { seanceScreenshots } from './seance-play.ts';
import { mockStatsApi, openStatsAsAdmin } from './stats-mock.ts';
import { openAdminSection } from './admin-sections.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm e2e screenshots
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

// SHOT_SCHEME=light (or dark) takes every screenshot in that colour scheme, phones included.
const forcedScheme = process.env.SHOT_SCHEME as 'light' | 'dark' | undefined;
const forced = new WeakSet<Browser>();
test.beforeEach(({ browser }) => {
  if (!forcedScheme || forced.has(browser)) return;
  forced.add(browser);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (options) => newContext({ ...options, colorScheme: forcedScheme });
});

const cards = (p: Page) => p.getByRole('region', { name: 'Word cards' }).getByRole('button');

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`screenshots (${label})`, async ({ browser }) => {
    const make = async (name: string) => {
      const ctx = await browser.newContext({
        viewport,
        colorScheme: label === 'phone' ? 'dark' : 'light',
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      return p;
    };
    const host = await make('Hana');
    await host.goto('/');
    await host.screenshot({ path: `test-results/shots/${label}-home.png`, fullPage: true });
    await host.getByRole('button', { name: 'Create a Codenames room' }).click();
    await expect(host.getByText('Pick a team below')).toBeVisible();
    const url = host.url();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    await host
      .getByRole('region', { name: 'Red team' })
      .getByRole('button', { name: 'Be the Spymaster' })
      .click();
    await others[0]!.getByRole('button', { name: 'Join Red as Operative' }).click();
    await others[1]!
      .getByRole('region', { name: 'Blue team' })
      .getByRole('button', { name: 'Be the Spymaster' })
      .click();
    await others[2]!.getByRole('button', { name: 'Join Blue as Operative' }).click();
    await expect(host.getByText('Everyone is seated')).toBeVisible();
    await host.screenshot({ path: `test-results/shots/${label}-lobby.png`, fullPage: true });
    await host.getByRole('button', { name: 'Change word lists' }).click();
    await expect(host.getByRole('dialog')).toBeVisible();
    await host.screenshot({ path: `test-results/shots/${label}-word-lists.png` });
    await host.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await host.getByRole('button', { name: 'Start game' }).click();
    await expect(cards(host)).toHaveCount(25);
    await host.screenshot({ path: `test-results/shots/${label}-spymaster.png`, fullPage: true });
    const redStarts = await host.getByText('Your turn! Give your team').isVisible();
    const [spy, op] = redStarts ? [host, others[0]!] : [others[1]!, others[2]!];
    await spy.getByPlaceholder('e.g. Ocean').fill('Tavern');
    await spy.getByRole('button', { name: '1', exact: true }).click();
    await spy.getByRole('button', { name: 'Give clue' }).click();
    await expect(op.getByText('Your turn to guess')).toBeVisible();
    await cards(op).first().click();
    await op.screenshot({ path: `test-results/shots/${label}-operative.png`, fullPage: true });
    await op.getByRole('button', { name: /^Guess / }).click();
    await expect(op.getByText(/guessed/).first()).toBeVisible();
    await op.screenshot({ path: `test-results/shots/${label}-result.png`, fullPage: true });
    await op.getByRole('button', { name: 'Rules' }).click();
    await op.screenshot({ path: `test-results/shots/${label}-rules.png` });
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`enigma screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(90_000);
    // Phones get viewport-sized shots: that is what a player actually sees without scrolling.
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/enigma-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    const make = async (name: string) => {
      const ctx = await browser.newContext({
        viewport,
        colorScheme: label === 'phone' ? 'dark' : 'light',
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      return p;
    };
    const host = await make('Hana');
    await host.goto('/');
    await host.getByRole('button', { name: 'Create an Enigma room' }).click();
    await expect(host.getByText('Pick a team below')).toBeVisible();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(host.url())));
    await host.getByRole('button', { name: 'Join Red' }).click();
    await others[0]!.getByRole('button', { name: 'Join Red' }).click();
    await others[1]!.getByRole('button', { name: 'Join Blue' }).click();
    await others[2]!.getByRole('button', { name: 'Join Blue' }).click();
    await expect(host.getByText('Everyone is in')).toBeVisible();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();

    const tx = (p: Page, team: string) => p.locator(`[aria-label="${team}'s transmission"]`);
    const teams = { Red: [host, others[0]!], Blue: [others[1]!, others[2]!] };
    await expect(host.getByText(/Encryptor|Waiting for/).first()).toBeVisible();
    const roles: Record<string, { enc: Page; dec: Page; code: number[] }> = {};
    for (const [team, pages] of Object.entries(teams)) {
      let enc: Page | undefined;
      // Wait for the round to render rather than checking once.
      await expect
        .poll(async () => {
          for (const p of pages)
            if (await tx(p, team).getByText('Your secret code').isVisible()) enc = p;
          return enc !== undefined;
        })
        .toBe(true);
      const code = (await tx(enc!, team).locator('.font-mono').first().innerText())
        .split('-')
        .map(Number);
      roles[team] = { enc: enc!, dec: pages.find((p) => p !== enc)!, code };
    }
    await shot(roles.Red!.enc, 'clue');
    for (const [team, r] of Object.entries(roles)) {
      const inputs = tx(r.enc, team).getByPlaceholder('A hint only your team will get');
      for (let i = 0; i < 3; i++) await inputs.nth(i).fill(['salty', 'orbit', 'crust'][i]!);
      await tx(r.enc, team).getByRole('button', { name: 'Send clues' }).click();
    }
    const red = roles.Red!;
    await tx(red.dec, 'Red')
      .getByRole('button', { name: `Clue 1 is keyword ${red.code[0]}` })
      .click();
    await shot(red.dec, 'guess');
    if (label === 'phone') {
      await red.dec
        .getByRole('navigation', { name: 'Game sections' })
        .getByRole('button', { name: /Chat/ })
        .click();
      await red.dec.getByLabel('Message your team').fill('first one is obviously the sea one');
      await red.dec.getByRole('button', { name: 'Send', exact: true }).click();
      await shot(red.dec, 'chat');
      await red.dec
        .getByRole('navigation', { name: 'Game sections' })
        .getByRole('button', { name: /Clues/ })
        .click();
      await shot(red.dec, 'clues');
      // The team notes, with enough of them to scroll inside their box.
      for (const note of [
        'Their 2 keeps coming up as weather',
        'Clue "tide" could be their 1 or their 3',
        'They like puns, watch out',
        'Blue 4 is probably an animal',
        'Remember to vary our clues for keyword 2',
        'Last note, so the list has to scroll',
      ]) {
        await red.dec.getByLabel('Add a note').fill(note);
        await red.dec.getByLabel('Add a note').press('Enter');
        await expect(red.dec.getByRole('list', { name: 'Team notes' })).toContainText(note);
      }
      // Centred, so the fixed tab bar doesn't cover it.
      await red.dec.getByLabel('Add a note').evaluate((el) => {
        el.scrollIntoView({ block: 'center' });
      });
      await shot(red.dec, 'notes');
      // Red's Encryptor sees the notes greyed out until Red decodes.
      await red.enc
        .getByRole('navigation', { name: 'Game sections' })
        .getByRole('button', { name: /Clues/ })
        .click();
      await expect(red.enc.getByLabel('Add a note')).toBeDisabled();
      await red.enc.getByLabel('Add a note').evaluate((el) => {
        el.scrollIntoView({ block: 'center' });
      });
      await shot(red.enc, 'notes-muted');
      await red.enc
        .getByRole('navigation', { name: 'Game sections' })
        .getByRole('button', { name: /Play/ })
        .click();
      await red.dec
        .getByRole('navigation', { name: 'Game sections' })
        .getByRole('button', { name: /Play/ })
        .click();
    }
    for (const [team, r] of Object.entries(roles)) {
      for (let i = 0; i < 3; i++) {
        const b = tx(r.dec, team).getByRole('button', {
          name: `Clue ${i + 1} is keyword ${r.code[i]}`,
        });
        if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
        await expect(b).toHaveAttribute('aria-pressed', 'true');
      }
      await tx(r.dec, team)
        .getByRole('button', { name: /^Lock in/ })
        .click();
    }
    await expect(host.getByText('The code was').first()).toBeVisible();
    await shot(host, 'reveal');
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`reverie screenshots (${label})`, async ({ browser, request }) => {
    test.setTimeout(90_000);
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/reverie-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    const login = await request.post('/api/admin/login', {
      data: { password: TEST_ADMIN_PASSWORD },
    });
    const admin = login
      .headersArray()
      .find((h) => h.name.toLowerCase() === 'set-cookie')!
      .value.split(';')[0]!;
    await request.put('/api/admin/backroom/password', {
      headers: { cookie: admin },
      data: { password: TEST_BACKROOM_WORD },
    });
    let ip = 1;
    const make = async (name: string) => {
      const ctx = await browser.newContext({
        viewport,
        colorScheme: label === 'phone' ? 'dark' : 'light',
        extraHTTPHeaders: { 'cf-connecting-ip': `10.3.${label === 'phone' ? 1 : 0}.${ip++}` },
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      await p.goto('/backroom');
      await p.getByLabel('The word').fill(TEST_BACKROOM_WORD);
      await p.getByRole('button', { name: 'Knock' }).click();
      await p.getByText("You're on the list").waitFor();
      return p;
    };
    const host = await make('Hana');
    await host.getByRole('button', { name: 'Create a Reverie room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    await expect(host.getByText('Players (4/8)')).toBeVisible();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();
    await expect(host.getByText('You are the storyteller')).toBeVisible();
    await shot(host, 'storyteller');
    const hand = (p: Page) =>
      p.getByRole('region', { name: 'Your hand' }).getByRole('button', { name: /^Card / });
    await hand(host).first().click();
    await shot(host, 'card-viewer');
    await host.getByRole('button', { name: 'Tell a story with this card' }).click();
    await host.getByPlaceholder('A word, a line, a feeling…').fill('a quiet storm');
    await host.getByRole('button', { name: 'Tell', exact: true }).click();
    const ana = others[0]!;
    await expect(ana.getByText('Give a card from your hand')).toBeVisible();
    await shot(ana, 'give');
    for (const p of others) {
      await hand(p).first().click();
      await p.getByRole('button', { name: 'Give this card' }).click();
    }
    await expect(ana.getByText(/Tap a card to vote/)).toBeVisible();
    await shot(ana, 'vote');
    for (const p of others) {
      const cards = p
        .getByRole('region', { name: 'Table' })
        .getByRole('button', { name: /^Card / });
      for (let i = 0; i < (await cards.count()); i++) {
        await cards.nth(i).click();
        const btn = p.getByRole('button', { name: `Vote for #${i + 1}` });
        if (await btn.isVisible()) {
          await btn.click();
          break;
        }
        await p.keyboard.press('Escape');
      }
    }
    await expect(host.getByText('Cards revealed!')).toBeVisible();
    await shot(host, 'reveal');
  });
}

for (const [label, viewport, colorScheme] of [
  ['desktop', { width: 1280, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
  ['phone-light', { width: 390, height: 844 }, 'light'],
] as const) {
  test(`royal post screenshots (${label})`, async ({ browser, request }) => {
    test.setTimeout(480_000);
    const taken = new Set<string>();
    const shot = async (p: Page, name: string) => {
      taken.add(name);
      await p.screenshot({
        path: `test-results/shots/royal-post-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    };
    const login = await request.post('/api/admin/login', {
      data: { password: TEST_ADMIN_PASSWORD },
    });
    const admin = login
      .headersArray()
      .find((h) => h.name.toLowerCase() === 'set-cookie')!
      .value.split(';')[0]!;
    await request.put('/api/admin/backroom/password', {
      headers: { cookie: admin },
      data: { password: TEST_BACKROOM_WORD },
    });
    let ip = 1;
    const make = async (name: string) => {
      const ctx = await browser.newContext({
        viewport,
        colorScheme,
        extraHTTPHeaders: {
          'cf-connecting-ip': `10.8.${['desktop', 'phone', 'phone-light'].indexOf(label)}.${ip++}`,
        },
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      await p.goto('/backroom');
      await p.getByLabel('The word').fill(TEST_BACKROOM_WORD);
      await p.getByRole('button', { name: 'Knock' }).click();
      await p.getByText("You're on the list").waitFor();
      return p;
    };
    const host = await make('Hana');
    await host.getByRole('button', { name: 'Create a Royal Post room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(['Ana', 'Ben'].map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    const players = [host, ...others];
    await host.getByRole('button', { name: /^2019 edition/ }).click();
    await expect(host.getByText('Players (3/6)')).toBeVisible();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();
    // Someone who joins mid-game watches.
    const watcher = await make('Wes');
    await watcher.goto(url);
    await expect(watcher.getByText(/^Watching:/).first()).toBeVisible();
    const done: Exercised = {
      guard: false,
      priest: false,
      handmaid: false,
      chancellor: false,
      baron: false,
      prince: false,
    };
    const wanted = [
      'my-turn',
      'targeting',
      'guard-guess',
      'priest-reveal',
      'baron-reveal',
      'handmaid',
      'prince',
      'chancellor',
      'elimination',
    ];
    // Each moment is captured the first time it comes up in play.
    let moments = 0;
    const moment: Shot = async (m, p) => {
      if (!taken.has(m)) await shot(p, m);
      if (++moments === 6) await shot(watcher, 'spectating');
    };
    await playUntil(
      host,
      players,
      '2019',
      done,
      (over) => over && wanted.every((m) => taken.has(m)),
      moment,
      async (over) => {
        if (!over && !taken.has('round-result')) await shot(host, 'round-result');
        if (over) await shot(host, 'podium');
      },
    );
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`echo screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/echo-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    const make = async (name: string) => {
      const ctx = await browser.newContext({
        viewport,
        colorScheme: label === 'phone' ? 'dark' : 'light',
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      return p;
    };
    const host = await make('Hana');
    await host.goto('/');
    await host.getByRole('button', { name: 'Create an Echo room' }).click();
    await expect(host.getByText('Almost ready')).toBeVisible();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(host.url())));
    const all = [host, ...others];
    await expect(host.getByText('Everyone is in')).toBeVisible();
    await host.getByRole('button', { name: '8 cards' }).click();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();

    /** Plays one card: the guesser picks, everyone writes, then `finish` resolves it. */
    const playCard = async (
      finish: (guesser: Page, writers: Page[], word: string) => Promise<void>,
      shots = false,
    ) => {
      let guesser: Page | undefined;
      await expect
        .poll(async () => {
          for (const p of all)
            if (await p.getByRole('button', { name: 'Pick word 1' }).isEnabled()) guesser = p;
          return guesser !== undefined;
        })
        .toBe(true);
      const writers = all.filter((p) => p !== guesser);
      if (shots) await shot(guesser!, 'pick');
      await guesser!.getByRole('button', { name: 'Pick word 2' }).click();
      const word = await writers[0]!.getByTestId('secret-word').innerText();
      const clues = ['Lantern', 'lanterns', 'Harbour'];
      for (const [i, w] of writers.entries()) {
        await w.getByLabel('Your clue').fill(clues[i]!);
        if (shots && i === 0) await shot(w, 'clue');
        await w.getByRole('button', { name: 'Send clue' }).click();
        if (i < writers.length - 1) {
          await expect(w.getByRole('button', { name: '✓ Sent' })).toBeVisible();
        }
      }
      await expect(guesser!.getByLabel('Your guess')).toBeVisible();
      if (shots) await shot(guesser!, 'guess');
      await finish(guesser!, writers, word);
    };
    const nextCard = async () => {
      await host.getByRole('button', { name: /^(Next card|Finish)$/ }).click();
    };
    const wrong = async (guesser: Page, writers: Page[]) => {
      await guesser.getByLabel('Your guess').fill('Nothing');
      await guesser.getByRole('button', { name: 'Guess', exact: true }).click();
      // The game decides a miss on its own; the host can move on straight away.
      await expect(host.getByRole('button', { name: /^(Next card|Finish)$/ })).toBeVisible();
      return writers[0]!;
    };

    await playCard(async (guesser, _w, word) => {
      await guesser.getByLabel('Your guess').fill(word);
      await guesser.getByRole('button', { name: 'Guess', exact: true }).click();
      await expect(host.getByText('🎉 Got it!')).toBeVisible();
      await shot(host, 'reveal');
    }, true);
    await nextCard();
    await playCard(async (guesser, writers) => {
      const writer = await wrong(guesser, writers);
      await shot(writer, 'wrong');
    });
    // 5 cards left: two more misses (two cards each) and a pass end the deck.
    for (let i = 0; i < 2; i++) {
      await nextCard();
      await playCard(async (guesser, writers) => {
        await wrong(guesser, writers);
      });
    }
    await nextCard();
    await playCard(async (guesser) => {
      await guesser.getByRole('button', { name: 'Pass' }).click();
    });
    await nextCard();
    await expect(host.getByText('Game over!')).toBeVisible();
    await shot(host, 'over');
  });
}

// Hoodwink, with a made-up deck imported by the admin (the real decks are private).
for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`hoodwink screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const colorScheme = label === 'phone' ? 'dark' : 'light';
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/hoodwink-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    const admin = await (await browser.newContext({ viewport, colorScheme })).newPage();
    await ownLoginLimit(admin);
    await admin.goto('/tavern-keeper');
    await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
    await admin.getByRole('button', { name: 'Sign in' }).click();
    await admin.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
    await admin.getByRole('button', { name: /Open the back room|Change password/ }).click();
    await expect(admin.getByRole('button', { name: 'Change password' })).toBeVisible();
    const deck = await admin.request.post('/api/admin/question-decks', {
      data: {
        name: 'Made-up oddities',
        description: 'Invented facts for the screenshots.',
        questions: Array.from({ length: 5 }, (_, i) => ({
          prompt: `In the invented hamlet of Wobbleton ${i + 1}, every newborn is given a ceremonial ___ by the oldest villager.`,
          answer: 'Tin spoon',
          decoys: ['Velvet hat', 'Wooden duck', 'Goose feather'],
        })),
      },
    });
    expect(deck.status()).toBe(201);
    const deckId = ((await deck.json()) as { id: string }).id;
    try {
      await admin.reload();
      await openAdminSection(admin, 'Question decks');
      const decks = admin.getByRole('region', { name: 'Question decks' });
      await decks.scrollIntoViewIfNeeded();
      await decks.screenshot({ path: `test-results/shots/hoodwink-${label}-admin-decks.png` });

      let ip = 1;
      const make = async (name: string) => {
        const ctx = await browser.newContext({
          viewport,
          colorScheme,
          extraHTTPHeaders: { 'cf-connecting-ip': `10.5.${label === 'phone' ? 1 : 0}.${ip++}` },
        });
        const p = await ctx.newPage();
        await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
        await p.goto('/backroom');
        await p.getByLabel('The word').fill(TEST_BACKROOM_WORD);
        await p.getByRole('button', { name: 'Knock' }).click();
        await p.getByText("You're on the list").waitFor();
        return p;
      };
      const host = await make('Hana');
      await host.getByRole('button', { name: 'Create a Hoodwink room' }).click();
      await expect(host).toHaveURL(/\/r\//);
      const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
      await Promise.all(others.map((p) => p.goto(host.url())));
      // The made-up deck has five questions, so pick five rounds before the game can start.
      await host.getByRole('button', { name: '5 rounds' }).click();
      await expect(host.getByRole('button', { name: '5 rounds' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(host.getByText('Everyone is in')).toBeVisible();
      await shot(host, 'lobby');
      await host.getByRole('button', { name: 'Start game' }).click();
      const [ana, ben, cy] = others as [Page, Page, Page];
      const everyone = [host, ana, ben, cy];

      const lies = [
        'A hand-knitted sock',
        'A tiny brass bell that must be rung at every single birthday until the child turns ninety',
        'Pickled egg',
      ];
      for (let round = 1; round <= 5; round++) {
        await expect(host.getByText(`Round ${round}/5`)).toBeVisible();
        if (round === 1) {
          await ana.getByLabel('Your lie').fill(lies[0]!);
          await shot(ana, 'writing');
        }
        for (const [i, p] of [ana, ben, cy].entries()) {
          await p.getByLabel('Your lie').fill(`${lies[i]!} ${round > 1 ? round : ''}`.trim());
          await p.getByRole('button', { name: 'Send lie' }).click();
        }
        await host.getByRole('button', { name: '🎲 Lie for me' }).click();
        for (const p of everyone)
          await expect(p.getByRole('list', { name: 'Answers' }).getByRole('button')).toHaveCount(5);
        if (round === 1) await shot(host, 'vote');
        for (const p of everyone) {
          const options = p.getByRole('list', { name: 'Answers' }).getByRole('button');
          for (let i = 0; i < 5; i++) {
            if (await options.nth(i).isEnabled()) {
              await options.nth(i).click();
              break;
            }
          }
        }
        await expect(host.getByRole('list', { name: 'Answers revealed' })).toBeVisible();
        if (round === 1) {
          await host.waitForTimeout(1200); // the reveal animates in
          await shot(host, 'reveal');
        }
        await host.getByRole('button', { name: round === 5 ? 'Finish' : 'Next round' }).click();
      }
      await expect(host.getByRole('list', { name: 'Podium' })).toBeVisible();
      await shot(host, 'podium');
    } finally {
      // Tidy up even on failure, so later runs see only their own decks.
      await admin.request.delete(`/api/admin/question-decks/${deckId}`);
    }
  });
}

// The admin stats page, served from the typed fixtures: phone in dark, desktop in light.
for (const [label, viewport, colorScheme] of [
  ['desktop', { width: 1280, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
] as const) {
  test(`stats screenshots (${label})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport, colorScheme });
    const page = await ctx.newPage();
    await mockStatsApi(page);
    await openStatsAsAdmin(page);
    // Charts and chips animate; let loads finish and transitions settle before each shot.
    const shot = async (name: string) => {
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(600);
      await page.screenshot({
        path: `test-results/shots/stats-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    };
    const tab = (name: string) => page.getByRole('tab', { name, exact: true }).click();
    await shot('live');
    await tab('Overview');
    await expect(page.getByRole('region', { name: 'Game mix' }).locator('svg')).toBeVisible();
    await shot('overview');
    if (label === 'phone') {
      await page.getByRole('region', { name: 'Game nights calendar' }).scrollIntoViewIfNeeded();
      await shot('overview-heatmaps');
    }
    await tab('Games');
    await page.getByRole('group', { name: 'Game' }).getByRole('button', { name: /Echo/ }).click();
    await expect(page.getByRole('region', { name: 'Scores' })).toBeVisible();
    await shot('games-echo');
    if (label === 'phone') {
      await page.getByRole('region', { name: 'Words' }).scrollIntoViewIfNeeded();
      await shot('games-echo-words');
    }
    const words = page.getByRole('region', { name: 'Words' });
    for (const game of ['Reverie', 'Hoodwink']) {
      await page
        .getByRole('group', { name: 'Game' })
        .getByRole('button', { name: new RegExp(game) })
        .click();
      await expect(words.getByRole('list')).toBeVisible();
      if (label === 'phone') await words.scrollIntoViewIfNeeded();
      await shot(`games-${game.toLowerCase()}`);
    }
    await tab('Players');
    await expect(page.getByRole('table')).toBeVisible();
    await shot('players');
    await page.getByRole('button', { name: /^Ivy/ }).click();
    await expect(page.getByText('Also known as')).toBeVisible();
    await shot('player');
    await tab('Fun');
    await expect(page.getByText('Most dramatic finish')).toBeVisible();
    await shot('fun');
  });
}

for (const [label, viewport, colorScheme] of [
  ['desktop', { width: 1280, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
  ['desktop-dark', { width: 1280, height: 900 }, 'dark'],
  ['phone-light', { width: 390, height: 844 }, 'light'],
] as const) {
  test(`masquerade screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const phone = viewport.width < 600;
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/masquerade-${label}-${name}.png`,
        fullPage: !phone,
      });
    const make = async (name: string) => {
      const ctx = await browser.newContext({ viewport, colorScheme });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      return p;
    };
    const host = await make('Hana');
    await host.goto('/');
    await host.getByRole('button', { name: 'Create a Masquerade room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    const players = [host, ...others];
    const names = new Map(players.map((p, i) => [p, ['Hana', 'Ana', 'Ben', 'Cy'][i]!]));
    await expect(host.getByText('Players (4/12)')).toBeVisible();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();
    const dealt = await readCards(players, names);
    const local = dealt.locals[0]!;
    const tab = async (p: Page, name: string) => {
      if (phone) await p.getByRole('navigation').getByRole('button', { name }).click();
    };
    // Covered, the spy's and a local's screens are the same; then each peeks with Show.
    await shot(local, 'card-hidden');
    for (const p of [local, dealt.spy])
      await p.getByRole('button', { name: 'Show your card' }).click();
    await shot(local, 'card-local');
    await shot(dealt.spy, 'card-spy');
    for (const p of [local, dealt.spy])
      await p.getByRole('button', { name: 'Hide your card' }).click();
    await tab(dealt.spy, 'Locations');
    const board = dealt.spy.getByRole('region', { name: 'Locations' });
    for (const n of ['Bakery', 'Gym', 'Cinema', 'Lift'].filter((x) => x !== dealt.location))
      await board.getByRole('button', { name: n, exact: true }).click();
    await board.getByRole('button', { name: 'Star Aquarium' }).click();
    await shot(dealt.spy, 'locations-spy');
    await tab(local, 'Ideas');
    await shot(local, 'ideas-hidden');
    const showIdeas = (p: Page) =>
      p
        .getByRole('region', { name: 'Question ideas' })
        .getByRole('button', { name: 'Show ideas for your card' })
        .click();
    await showIdeas(local);
    await shot(local, 'ideas-local');
    await tab(dealt.spy, 'Ideas');
    await showIdeas(dealt.spy);
    await shot(dealt.spy, 'ideas-spy');
    await tab(dealt.spy, 'Play');
    await tab(local, 'Play');
    await readyUp(players);
    const [a, b, c] = dealt.locals as [Page, Page, Page];
    await votes([[a, names.get(dealt.spy)!]]);
    await shot(a, 'vote');
    await votes([
      [b, names.get(dealt.spy)!],
      [c, names.get(dealt.spy)!],
      [dealt.spy, names.get(a)!],
    ]);
    // A caught spy's screen opens on the board, ready to guess.
    await expect(dealt.spy.getByText('🎯 You were caught! Pick your one guess.')).toBeVisible();
    await shot(dealt.spy, 'caught');
    await board.getByRole('button', { name: `Pick ${dealt.location}`, exact: true }).click();
    await shot(dealt.spy, 'guess');
    await board.getByRole('button', { name: `Guess ${dealt.location}`, exact: true }).click();
    await expect(host.getByTestId('revealed-location')).toBeVisible();
    await shot(host, 'reveal');
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`nightfall screenshots (${label})`, async ({ browser, request }) => {
    test.setTimeout(240_000);
    const taken = new Set<string>();
    const shot = async (p: Page, name: string) => {
      taken.add(name);
      await p.screenshot({
        path: `test-results/shots/nightfall-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    };
    const login = await request.post('/api/admin/login', {
      data: { password: TEST_ADMIN_PASSWORD },
    });
    const admin = login
      .headersArray()
      .find((h) => h.name.toLowerCase() === 'set-cookie')!
      .value.split(';')[0]!;
    await request.put('/api/admin/backroom/password', {
      headers: { cookie: admin },
      data: { password: TEST_BACKROOM_WORD },
    });
    let ip = 1;
    const make = async (name: string) => {
      const ctx = await browser.newContext({
        viewport,
        colorScheme: label === 'phone' ? 'dark' : 'light',
        extraHTTPHeaders: { 'cf-connecting-ip': `10.10.${label === 'phone' ? 1 : 0}.${ip++}` },
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      await p.goto('/backroom');
      await p.getByLabel('The word').fill(TEST_BACKROOM_WORD);
      await p.getByRole('button', { name: 'Knock' }).click();
      await p.getByText("You're on the list").waitFor();
      return p;
    };
    const names = ['Hana', 'Ana', 'Ben', 'Cy'];
    const host = await make(names[0]!);
    await host.getByRole('button', { name: 'Create a Nightfall room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(names.slice(1).map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    const players = [host, ...others];
    await expect(host.getByText('Players (4/10)')).toBeVisible();
    await setRoles(host, {
      werewolf: 2,
      seer: 1,
      robber: 1,
      troublemaker: 1,
      insomniac: 1,
      villager: 1,
    });
    await host
      .getByRole('group', { name: 'Time for each role at night' })
      .getByRole('button', { name: '8 s', exact: true })
      .click();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Deal the cards' }).click();
    await expect(host.getByRole('button', { name: 'Tap to see your card' })).toBeVisible();
    await shot(host, 'ready-covered');
    await host.getByRole('button', { name: 'Tap to see your card' }).click();
    await shot(host, 'ready');
    await host.getByRole('button', { name: 'Cover it again' }).click();
    const roles = await getReady(players);
    await expect(host.getByTestId(/night-/)).toBeVisible();
    let idleShot = false;
    await playNight(players, roles, async (p) => {
      if (!taken.has('night-acting')) await shot(p, 'night-acting');
      if (!idleShot) {
        idleShot = true;
        const idle = players.find((q) => q !== p)!;
        if (await idle.getByTestId('night-idle').count()) await shot(idle, 'night-idle');
      }
    });
    await expect(host.getByRole('button', { name: 'Ready to vote' })).toBeVisible();
    await shot(host, 'day');
    await host.getByRole('tab', { name: 'Learned' }).click();
    await shot(host, 'day-learned');
    await host.getByRole('tab', { name: 'Roles' }).click();
    await shot(host, 'day-roles');
    await host.getByRole('tab', { name: 'Table' }).click();
    for (const p of players) await p.getByRole('button', { name: 'Ready to vote' }).click();
    await expect(host.getByText('🗳️ The vote')).toBeVisible();
    await host.getByRole('button', { name: `Vote for ${names[1]}` }).click();
    await shot(host, 'vote');
    await others[0]!.getByRole('button', { name: `Vote for ${names[2]}` }).click();
    await others[1]!.getByRole('button', { name: `Vote for ${names[1]}` }).click();
    await others[2]!.getByRole('button', { name: `Vote for ${names[1]}` }).click();
    await expect(host.getByTestId('teams')).toBeVisible();
    await shot(host, 'reveal');
    await host.getByRole('tab', { name: 'The night, step by step' }).click();
    await shot(host, 'reveal-night');
    await host.getByRole('tab', { name: 'Everyone’s cards' }).click();
    await host.getByTestId('reveal-player').first().getByRole('button').first().click();
    await shot(host, 'card-details');
  });

  test(`nightfall vampire screenshots (${label})`, async ({ browser, request }) => {
    test.setTimeout(300_000);
    const taken = new Set<string>();
    const shot = async (p: Page, name: string) => {
      taken.add(name);
      await p.screenshot({
        path: `test-results/shots/nightfall-${label}-vampire-${name}.png`,
        fullPage: label === 'desktop',
      });
    };
    const login = await request.post('/api/admin/login', {
      data: { password: TEST_ADMIN_PASSWORD },
    });
    const admin = login
      .headersArray()
      .find((h) => h.name.toLowerCase() === 'set-cookie')!
      .value.split(';')[0]!;
    await request.put('/api/admin/backroom/password', {
      headers: { cookie: admin },
      data: { password: TEST_BACKROOM_WORD },
    });
    let ip = 1;
    const make = async (name: string) => {
      const ctx = await browser.newContext({
        viewport,
        colorScheme: label === 'phone' ? 'dark' : 'light',
        extraHTTPHeaders: { 'cf-connecting-ip': `10.10.${label === 'phone' ? 3 : 2}.${ip++}` },
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      await p.goto('/backroom');
      await p.getByLabel('The word').fill(TEST_BACKROOM_WORD);
      await p.getByRole('button', { name: 'Knock' }).click();
      await p.getByText("You're on the list").waitFor();
      return p;
    };
    const names = ['Hana', 'Ana', 'Ben', 'Cy'];
    const host = await make(names[0]!);
    await host.getByRole('button', { name: 'Create a Nightfall room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    // Join one at a time, so the seats follow `names`.
    const others: Page[] = [];
    for (const n of names.slice(1)) {
      const p = await make(n);
      await p.goto(url);
      await expect(host.getByText(`Players (${others.length + 2}/10)`)).toBeVisible();
      others.push(p);
    }
    const players = [host, ...others];
    await setRoles(host, {
      vampire: 1,
      'the-count': 1,
      werewolf: 1,
      cupid: 1,
      seer: 1,
      priest: 1,
      pickpocket: 1,
    });
    await host
      .getByRole('group', { name: 'Time for each role at night' })
      .getByRole('button', { name: '8 s', exact: true })
      .click();
    await host.locator('details[aria-label="Vampire"]').scrollIntoViewIfNeeded();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Deal the cards' }).click();
    let roles: string[] = [];
    for (let tries = 0; tries < 40; tries++) {
      roles = await peek(players);
      if (
        roles.includes('werewolf') &&
        roles.includes('cupid') &&
        roles.some((r) => VAMPIRES.includes(r)) &&
        roles.some((r) => ['seer', 'pickpocket'].includes(r))
      )
        break;
      await host.getByRole('button', { name: 'Shuffle and deal again' }).click();
      await expect(host.getByRole('button', { name: 'Tap to see your card' })).toBeVisible();
    }
    const W = roles.indexOf('werewolf');
    const T = roles.findIndex((r) => VAMPIRES.includes(r));
    const marked = roles.findIndex((r) => ['seer', 'pickpocket'].includes(r));
    await getReady(players);
    await expect(host.getByTestId(/night-/)).toBeVisible();
    await playMarkedNight(players, names, roles, marked, async (p) => {
      if (!taken.has('dusk') && (await p.getByTestId('dusk').count())) await shot(p, 'dusk');
      if (!taken.has('lovers') && (await p.getByTestId('lovers').count())) await shot(p, 'lovers');
      if (!taken.has('acting') && (await p.getByTestId('prompt').count())) await shot(p, 'acting');
    });
    const lover = players[W]!;
    await expect(lover.getByRole('button', { name: 'Ready to vote' })).toBeVisible();
    await shot(lover, 'day');
    await lover.getByTestId('my-mark').getByRole('button').click();
    await shot(lover, 'my-mark');
    await lover.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await lover.getByRole('tab', { name: 'Learned' }).click();
    await shot(lover, 'day-learned');
    await lover.getByRole('tab', { name: 'Roles' }).click();
    await shot(lover, 'day-roles');
    await lover.getByRole('tab', { name: 'Table' }).click();
    for (const p of players) await p.getByRole('button', { name: 'Ready to vote' }).click();
    await expect(host.getByText('🗳️ The vote')).toBeVisible();
    for (const [i, p] of players.entries())
      await p.getByRole('button', { name: `Vote for ${names[i === W ? T : W]}` }).click();
    await expect(host.getByTestId('teams')).toBeVisible();
    await shot(host, 'reveal');
    await host.getByRole('tab', { name: 'The night, step by step' }).click();
    await shot(host, 'reveal-night');
  });

  test(`nightfall alien screenshots (${label})`, async ({ browser, request }) => {
    test.setTimeout(300_000);
    const taken = new Set<string>();
    const shot = async (p: Page, name: string) => {
      taken.add(name);
      await p.screenshot({
        path: `test-results/shots/nightfall-${label}-alien-${name}.png`,
        fullPage: label === 'desktop',
      });
    };
    const login = await request.post('/api/admin/login', {
      data: { password: TEST_ADMIN_PASSWORD },
    });
    const admin = login
      .headersArray()
      .find((h) => h.name.toLowerCase() === 'set-cookie')!
      .value.split(';')[0]!;
    await request.put('/api/admin/backroom/password', {
      headers: { cookie: admin },
      data: { password: TEST_BACKROOM_WORD },
    });
    let ip = 1;
    const make = async (name: string) => {
      const ctx = await browser.newContext({
        viewport,
        colorScheme: label === 'phone' ? 'dark' : 'light',
        extraHTTPHeaders: { 'cf-connecting-ip': `10.10.${label === 'phone' ? 5 : 4}.${ip++}` },
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      await p.goto('/backroom');
      await p.getByLabel('The word').fill(TEST_BACKROOM_WORD);
      await p.getByRole('button', { name: 'Knock' }).click();
      await p.getByText("You're on the list").waitFor();
      return p;
    };
    const names = ['Hana', 'Ana', 'Ben', 'Cy'];
    const host = await make(names[0]!);
    await host.getByRole('button', { name: 'Create a Nightfall room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others: Page[] = [];
    for (const n of names.slice(1)) {
      const p = await make(n);
      await p.goto(url);
      await expect(host.getByText(`Players (${others.length + 2}/10)`)).toBeVisible();
      others.push(p);
    }
    const players = [host, ...others];
    await setRoles(host, {
      alien: 2,
      werewolf: 1,
      cow: 1,
      psychic: 1,
      rascal: 1,
      exposer: 1,
    });
    await host
      .getByRole('group', { name: 'Time for each role at night' })
      .getByRole('button', { name: '8 s', exact: true })
      .click();
    // The Alien options: each alien looks at a card; the night ends with a ripple for all.
    const only = async (table: string, entry: string) => {
      const panel = host.getByTestId(`weights-${table}`);
      if (!(await panel.getAttribute('open'))) await panel.locator('summary').click();
      for (const row of await panel.getByRole('listitem').all()) {
        const label = (await row.locator('span').first().textContent())!.trim();
        const weight = row.getByTestId('weight');
        const want = label === entry ? 5 : 0;
        for (let i = 0; i < 30; i++) {
          const now = Number(await weight.textContent());
          if (now === want) break;
          await row
            .getByRole('button', { name: now > want ? /^Less likely/ : /^More likely/ })
            .click();
          await expect(weight).not.toHaveText(String(now));
        }
      }
    };
    await only('ripple', 'Face away');
    await host.getByTestId('weights-ripple').locator('summary').click();
    await only('alien', 'Each looks at a card');
    await host.getByTestId('alien-options').scrollIntoViewIfNeeded();
    await shot(host, 'lobby-options');
    await host.getByTestId('numbers-hint').scrollIntoViewIfNeeded();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Deal the cards' }).click();
    let roles: string[] = [];
    for (let tries = 0; tries < 40; tries++) {
      roles = await peek(players);
      if (roles.includes('alien') && roles.includes('cow')) break;
      await host.getByRole('button', { name: 'Shuffle and deal again' }).click();
      await expect(host.getByRole('button', { name: 'Tap to see your card' })).toBeVisible();
    }
    await getReady(players);
    await expect(host.getByTestId(/night-/)).toBeVisible();
    // Each player answers with the first legal choice (or skips), and the screens are captured.
    await Promise.all(
      players.map(async (p) => {
        const quick = { timeout: 2000 };
        const deadline = Date.now() + 150_000;
        while (Date.now() < deadline) {
          if (await p.getByRole('button', { name: 'Ready to vote' }).count()) break;
          if (!taken.has('cow') && (await p.getByTestId('eyes-closed').count()))
            await shot(p, 'cow');
          if (
            !taken.has('ripple') &&
            (await p.getByTestId('night-idle').count()) &&
            (await p.getByTestId('announcement').count())
          )
            await shot(p, 'ripple');
          const prompt = p.getByTestId('prompt');
          if (await prompt.count()) {
            try {
              const stage = (await prompt.getAttribute('data-stage', quick)) ?? '';
              if (stage === 'alien-view' && !taken.has('alien-step')) await shot(p, 'alien-step');
              const confirm = prompt.getByRole('button', { name: 'Confirm' });
              const pool = prompt.locator('ul button:enabled');
              if (['alien-view', 'psychic', 'expose'].includes(stage)) {
                for (let i = 0; i < 3 && !(await confirm.isEnabled(quick)); i++)
                  await pool.nth(i).click(quick);
                await confirm.click(quick);
              } else await prompt.getByRole('button', { name: 'Skip' }).click(quick);
            } catch {
              // The step ended under the click.
            }
            continue;
          }
          await p.waitForTimeout(150);
        }
      }),
    );
    await expect(host.getByRole('button', { name: 'Ready to vote' })).toBeVisible();
    await shot(host, 'day');
    await host.getByRole('tab', { name: 'Learned' }).click();
    await shot(host, 'day-learned');
    await host.getByRole('tab', { name: 'Roles' }).click();
    await shot(host, 'day-roles');
    await host.getByRole('tab', { name: 'Table' }).click();
    const W = roles.indexOf('werewolf') >= 0 ? roles.indexOf('werewolf') : 0;
    for (const p of players) await p.getByRole('button', { name: 'Ready to vote' }).click();
    await expect(host.getByText('🗳️ The vote')).toBeVisible();
    for (const [i, p] of players.entries())
      await p.getByRole('button', { name: `Vote for ${names[i === W ? (W + 1) % 4 : W]}` }).click();
    await expect(host.getByTestId('teams')).toBeVisible();
    await shot(host, 'reveal');
    await host.getByRole('tab', { name: 'The night, step by step' }).click();
    await shot(host, 'reveal-night');
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`recap screenshots (phone, ${colorScheme})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const viewport = { width: 390, height: 844 };
    const make = async (name: string) => {
      const p = await (await browser.newContext({ viewport, colorScheme })).newPage();
      p.on('dialog', (d) => void d.accept());
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      return p;
    };
    const host = await make('Hana');
    await host.goto('/');
    await host.getByRole('button', { name: 'Create a Masquerade room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    const players = [host, ...others];
    const names = new Map(players.map((p, i) => [p, ['Hana', 'Ana', 'Ben', 'Cy'][i]!]));
    await expect(host.getByText('Players (4/12)')).toBeVisible();
    await host.getByLabel('Rounds').selectOption('1');
    for (let game = 1; game <= 2; game++) {
      if (game === 2) await host.getByRole('button', { name: 'Play again' }).click();
      else await host.getByRole('button', { name: 'Start game' }).click();
      const dealt = await readCards(players, names);
      await readyUp(players);
      const [a, b, c] = dealt.locals as [Page, Page, Page];
      // Game 1 the spy escapes untouched; game 2 the table catches them.
      const target = game === 1 ? names.get(a)! : names.get(dealt.spy)!;
      await votes([
        [a, game === 1 ? names.get(b)! : target],
        [b, target],
        [c, target],
        [dealt.spy, names.get(a)!],
      ]);
      if (game === 2) {
        const board = dealt.spy.getByRole('region', { name: 'Locations' });
        const wrong = dealt.location === 'Bakery' ? 'Gym' : 'Bakery';
        await board.getByRole('button', { name: `Pick ${wrong}`, exact: true }).click();
        await board.getByRole('button', { name: `Guess ${wrong}`, exact: true }).click();
      }
      await expect(host.getByRole('region', { name: 'Superlatives' })).toBeVisible();
    }
    const strip = host.getByRole('region', { name: 'Superlatives' });
    await strip.scrollIntoViewIfNeeded();
    await host.screenshot({ path: `test-results/shots/phone-${colorScheme}-recap-strip.png` });
    await host.getByRole('button', { name: '🍻 Wrap up the night' }).first().click();
    await confirmWrap(host);
    const sheet = host.getByRole('dialog', { name: /at the tavern/ });
    await expect(sheet.getByText('Wrapped up')).toBeVisible();
    await host.screenshot({ path: `test-results/shots/phone-${colorScheme}-recap-sheet.png` });
    await sheet.getByRole('region', { name: 'Past rounds' }).scrollIntoViewIfNeeded();
    await host.screenshot({ path: `test-results/shots/phone-${colorScheme}-recap-rounds.png` });

    // The saved picture, drawn on the device in its own theme.
    const download = host.waitForEvent('download');
    await sheet.getByRole('button', { name: '🖼️ Save image' }).click();
    await (await download).saveAs(`test-results/shots/phone-${colorScheme}-recap-image.png`);
    for (const p of players)
      await p
        .getByRole('dialog', { name: /at the tavern/ })
        .getByRole('button', { name: 'Close' })
        .click();

    // A second night, wrapped up too: the Hall of fame opens.
    await host.getByRole('button', { name: 'Play again' }).click();
    const dealt = await readCards(players, names);
    await readyUp(players);
    const [a, b, c] = dealt.locals as [Page, Page, Page];
    await votes([
      [a, names.get(dealt.spy)!],
      [b, names.get(dealt.spy)!],
      [c, names.get(dealt.spy)!],
      [dealt.spy, names.get(a)!],
    ]);
    const board = dealt.spy.getByRole('region', { name: 'Locations' });
    const wrong = dealt.location === 'Bakery' ? 'Gym' : 'Bakery';
    await board.getByRole('button', { name: `Pick ${wrong}`, exact: true }).click();
    await board.getByRole('button', { name: `Guess ${wrong}`, exact: true }).click();
    await expect(host.getByRole('region', { name: 'Superlatives' })).toBeVisible();
    await host.getByRole('button', { name: '🍻 Wrap up the night' }).first().click();
    await confirmWrap(host);
    await expect(sheet.getByText('Wrapped up')).toBeVisible();
    await sheet.getByRole('tab', { name: '🏆 Hall of fame' }).click();
    await expect(sheet.getByText(/Nights together: 2/)).toBeVisible();
    await host.screenshot({ path: `test-results/shots/phone-${colorScheme}-recap-hall.png` });
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`round-table screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(240_000);
    const phone = label === 'phone';
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/round-table-${label}-${name}.png`,
        fullPage: !phone,
      });
    const t = await rt.openTable(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay'], {
      viewport,
      colorScheme: phone ? 'dark' : 'light',
    });
    const { host } = t;
    await host.getByRole('button', { name: /^Classic\+/ }).click();
    await expect(host.getByTestId('balance')).toContainText('4 Good vs 3 Evil');
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();
    await expect(host.getByRole('button', { name: '👁️ Show my role' })).toBeVisible();
    await shot(host, 'card-covered');
    await rt.readRoles(t);
    const merlin = rt.withRole(t, 'Merlin');
    const percival = rt.withRole(t, 'Percival');
    await merlin.getByRole('button', { name: 'My role' }).click();
    await shot(merlin, 'role-merlin');
    await merlin.keyboard.press('Escape');
    await percival.getByRole('button', { name: 'My role' }).click();
    await shot(percival, 'role-percival');
    await percival.keyboard.press('Escape');
    const good = rt.goodPages(t);
    const evil = rt.evilPages(t);
    const lead = await rt.leader(t);
    await lead.getByRole('button', { name: `Pick ${t.names.get(good[0]!)} for the team` }).click();
    await shot(lead, 'propose-leader');
    await shot(
      t.players.find((p) => p !== lead)!,
      'propose-watching',
    );
    await lead.getByRole('button', { name: `Pick ${t.names.get(good[1]!)} for the team` }).click();
    await lead.getByRole('button', { name: 'Send this team to the vote' }).click();
    await expect(host.getByRole('region', { name: 'Vote' })).toBeVisible();
    await shot(host, 'vote');
    await rt.vote(t, t.players.slice(0, 4));
    await expect(host.getByTestId('vote-result')).toBeVisible();
    await shot(host, 'vote-rejected');
    await rt.quest(t, good.slice(0, 2));
    const size = await rt.teamSize(t);
    const team = [evil[0]!, ...good.slice(0, size - 1)];
    await rt.propose(t, team);
    await rt.vote(t);
    await expect(evil[0]!.getByRole('button', { name: '✕ Fail' })).toBeVisible();
    await shot(evil[0]!, 'quest-evil');
    await rt.play(t, team, [evil[0]!]);
    let holder: Page | undefined;
    await expect
      .poll(async () => {
        for (const p of t.players)
          if (await p.getByText(/^You hold the Lady of the Lake/).isVisible()) {
            holder = p;
            return true;
          }
        return false;
      })
      .toBe(true);
    const choice = holder!
      .getByRole('button', { name: /^Check / })
      .and(holder!.locator(':enabled'));
    await choice.first().click();
    await shot(holder!, 'lady');
    await holder!.getByRole('button', { name: /’s loyalty$/ }).click();
    await expect(holder!.getByTestId('lady-result')).toBeVisible();
    await shot(holder!, 'lady-result');
    if (phone) {
      await host.getByRole('navigation').getByRole('button', { name: 'History' }).click();
      await shot(host, 'history');
      await host.getByRole('navigation').getByRole('button', { name: 'Table' }).click();
    }
    await rt.quest(t, good.slice(0, await rt.teamSize(t)));
    let assassin: Page | undefined;
    // Lady again after quest 3, then quest 4 to reach the assassination.
    await expect
      .poll(async () => {
        for (const p of t.players)
          if (await p.getByText(/^You hold the Lady of the Lake/).isVisible()) {
            holder = p;
            return true;
          }
        return false;
      })
      .toBe(true);
    const again = holder!.getByRole('button', { name: /^Check / }).and(holder!.locator(':enabled'));
    await again.first().click();
    await holder!.getByRole('button', { name: /’s loyalty$/ }).click();
    await rt.quest(t, good.slice(0, await rt.teamSize(t)));
    await expect
      .poll(async () => {
        for (const p of evil)
          if (await p.getByText(/^Good won three quests, but you get one shot/).isVisible()) {
            assassin = p;
            return true;
          }
        return false;
      })
      .toBe(true);
    const target = t.names.get(good[2]!)!;
    await assassin!
      .getByRole('button', { name: `Name ${target} as Merlin` })
      .first()
      .click();
    await shot(assassin!, 'assassin');
    await shot(merlin, 'assassin-waiting');
    await assassin!
      .getByRole('button', { name: `Name ${target} as Merlin` })
      .last()
      .click();
    await expect(assassin!.getByRole('dialog')).toBeVisible();
    await shot(assassin!, 'assassin-confirm');
    await assassin!.getByRole('button', { name: /^Yes, it’s/ }).click();
    await expect(host.getByTestId('winner')).toBeVisible();
    await shot(host, 'end');
  });
}

for (const [label, viewport, colorScheme] of [
  ['desktop', { width: 1280, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
] as const) {
  test(`inquest screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    const opts = { viewport, colorScheme };
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/inquest-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    const tab = async (p: Page, name: string) => {
      if (label === 'phone')
        await p
          .getByRole('navigation', { name: 'Game sections' })
          .getByRole('button', { name })
          .click();
    };
    await openInquestBackroom(await inquestVisitor(browser, 'Admin', errors, opts));
    const players = await inquestTable(
      browser,
      ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eve'],
      errors,
      opts,
    );
    const host = players[0]!.page;
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Host picks', exact: true }).click();
    await host
      .getByLabel('Pick the Forensic Scientist')
      .getByRole('button', { name: 'Hana', exact: true })
      .click();
    // This tour shows the presentations too (off by default).
    await host.getByRole('button', { name: 'Presentations', exact: true }).click();
    await expect(host.getByRole('button', { name: '✓ Presentations' })).toBeVisible();
    await host.getByRole('button', { name: 'Start the investigation' }).click();

    const murderer = await whoShows(
      players,
      'Murderer: pick 1 Clue + 1 Means from your own cards.',
    );
    const night = murderer.page.getByRole('region', { name: 'Choose your crime' });
    await night
      .getByRole('button', { name: /^Clue:/ })
      .first()
      .click();
    await night
      .getByRole('button', { name: /^Means:/ })
      .first()
      .click();
    await shot(murderer.page, 'night-murderer');
    const others = players.filter((p) => p.page !== host && p !== murderer);
    await shot(others[0]!.page, 'night');
    await night.getByRole('button', { name: /^Commit:/ }).click();

    await expect(host.getByText('Pick the Location tile for this crime.')).toBeVisible();
    await host.locator('button[data-tile]:visible').first().click();
    await shot(host, 'fs-location');
    await host.getByRole('button', { name: /^Use Location [A-D] / }).click();
    await placeBullets(host, 3);
    await host.locator('button[data-item]:visible').first().click();
    await shot(host, 'fs-bullet');
    await host.getByRole('button', { name: /^Place bullet on/ }).click();
    await placeBullets(host, 2);

    const accomplice = await withRole(others, 'Accomplice');
    const witness = await withRole(others, 'Witness');
    const inv = others.find((p) => p !== accomplice && p !== witness)!;
    await tab(inv.page, 'Suspects');
    await shot(inv.page, 'suspects');
    if (label === 'phone') {
      await inv.page.getByRole('button', { name: '▦ Grid' }).click();
      await shot(inv.page, 'suspects-grid');
      await inv.page.getByRole('button', { name: '▦ Grid' }).click();
    }
    await tab(inv.page, 'Scene');
    await shot(inv.page, 'scene');
    await tab(inv.page, 'Me');
    await inv.page.getByRole('button', { name: 'Reveal your role card' }).click();
    await shot(inv.page, 'me');
    await tab(witness.page, 'Me');
    await witness.page.getByRole('button', { name: 'Reveal your role card' }).click();
    await shot(witness.page, 'me-witness');
    // The discussion before the presentations.
    await tab(inv.page, 'Scene');
    await shot(inv.page, 'discussion');
    await tab(host, 'Scene');
    await shot(host, 'discussion-fs');
    await startInquestPresentations(players);
    const speaker = await whoShows(players, /^Your turn to present/);
    if (label === 'desktop') {
      // A watcher puts the public table on a shared screen.
      const tv = await inquestVisitor(browser, 'Tv', errors, {
        viewport: { width: 1920, height: 1080 },
        colorScheme: 'dark',
      });
      await unlockInquest(tv, `/backroom?next=${encodeURIComponent(new URL(host.url()).pathname)}`);
      await tv.getByRole('button', { name: '📺 Table screen' }).click();
      await expect(tv.getByLabel('Table screen')).toBeVisible();
      await tv.screenshot({ path: `test-results/shots/inquest${''}-tv-table-screen.png` });
      await tv.context().close();
    }
    await tab(speaker.page, 'Suspects');
    await shot(speaker.page, 'presenting');

    await inv.page
      .getByRole('button', { name: /🔎 Solve/ })
      .first()
      .click();
    const sheet = inv.page.getByRole('dialog', { name: /^Solve/ });
    await shot(inv.page, 'solve-1');
    await sheet.getByRole('button', { name: murderer.name, exact: true }).click();
    await sheet
      .getByRole('button', { name: /^Clue:/ })
      .nth(1)
      .click();
    await sheet
      .getByRole('button', { name: /^Means:/ })
      .first()
      .click();
    await shot(inv.page, 'solve-confirm');
    await inv.page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await presentInquest(players, 5, false);
    await expect(inv.page.getByRole('dialog', { name: /Event: Cleared Evidence/ })).toBeVisible();
    await shot(inv.page, 'event-card');
    await dismissEvent(players, /Event: Cleared Evidence/);
    for (let i = 0; i < 5; i++) {
      const flipper = await whoShows(
        players,
        'Your turn: flip one of your own Clue cards face down.',
      );
      const panel = flipper.page.getByRole('region', { name: 'Flip a Clue card' });
      await panel
        .getByRole('button', { name: /^Clue:/ })
        .and(panel.locator(':enabled'))
        .first()
        .click();
      if (i === 0) await shot(flipper.page, 'flip');
      await panel.getByRole('button', { name: /^Flip / }).click();
      await expect(panel.getByRole('button', { name: /^Flip / })).toHaveCount(0);
    }
    await dismissEvent(players, /Event: Shifted Bullet/);
    await host.locator('button[data-item][data-marked="false"]:visible').first().click();
    await shot(host, 'fs-move');
    await host.getByRole('button', { name: /^Move the bullet to/ }).click();
    await dismissEvent(players, /Event: Last Call/);
    await host.locator('button[data-slot]:visible').first().click();
    await shot(host, 'fs-replace');
    await host.getByRole('button', { name: /^Replace “/ }).click();
    await replaceTile(host);
    await placeBullets(host, 2);
    await replaceTile(host);
    await placeBullets(host, 1);
    await tab(inv.page, 'Suspects');
    await shot(inv.page, 'last-call');

    const right = others.find((p) => p !== accomplice && p !== witness && p !== inv)!;
    await right.page
      .getByRole('button', { name: /🔎 Solve/ })
      .first()
      .click();
    const d = right.page.getByRole('dialog', { name: /^Solve/ });
    await d.getByRole('button', { name: murderer.name, exact: true }).click();
    await d
      .getByRole('button', { name: /^Clue:/ })
      .first()
      .click();
    await d
      .getByRole('button', { name: /^Means:/ })
      .first()
      .click();
    await d.getByRole('button', { name: '🔎 Solve the crime' }).click();
    const rev = murderer.page.getByRole('region', { name: 'The Reversal' });
    await accomplice.page
      .getByRole('region', { name: 'The Reversal' })
      .getByRole('button', { name: new RegExp(`^${inv.name}`) })
      .click();
    await rev.getByRole('button', { name: new RegExp(`^${inv.name}`) }).click();
    await shot(murderer.page, 'reversal');
    await shot(inv.page, 'reversal-waiting');
    await rev.getByRole('button', { name: `Final answer: ${inv.name}` }).click();
    await expect(host.getByRole('heading', { name: 'Who was who' })).toBeVisible();
    await shot(host, 'over');
    await shot(inv.page, 'over-investigator');
    expect(errors).toEqual([]);
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`playtest screenshots (${label})`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport,
      colorScheme: label === 'phone' ? 'dark' : 'light',
    });
    const admin = await context.newPage();
    await ownLoginLimit(admin);
    await admin.goto('/tavern-keeper');
    await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
    await admin.getByRole('button', { name: 'Sign in' }).click();
    await admin.getByRole('link', { name: '🧪 Playtest' }).click();
    await admin.getByRole('radio', { name: /^Round Table/ }).click();
    // Ben is a second human seat; the other three are bots.
    await admin.getByRole('button', { name: 'Seat 2: bot' }).click();
    await admin.screenshot({
      path: `test-results/shots/${label}-playtest-setup.png`,
      fullPage: true,
    });
    const opened = context.waitForEvent('page');
    await admin.getByRole('button', { name: 'Start playtest' }).click();
    const ana = await opened;
    await expect(ana.getByTestId('playtest-seat')).toHaveText('Ana');
    await expect(admin.getByRole('link', { name: 'Open Ben' })).toBeVisible();
    await admin.screenshot({
      path: `test-results/shots/${label}-playtest-running.png`,
      fullPage: true,
    });
    const next = context.waitForEvent('page');
    await admin.getByRole('link', { name: 'Open Ben' }).click();
    const ben = await next;
    await expect(ben.getByTestId('playtest-seat')).toHaveText('Ben');
    await ana.bringToFront();
    await ana.screenshot({ path: `test-results/shots/${label}-playtest-bar-host.png` });
    await ben.bringToFront();
    await ben.screenshot({ path: `test-results/shots/${label}-playtest-bar-seat.png` });
    ana.on('dialog', (d) => void d.accept());
    await ana.getByRole('button', { name: 'End playtest' }).click();
    await expect(ben.getByRole('heading', { name: 'This playtest has ended' })).toBeVisible();
    await context.close();
  });
}

for (const [label, viewport, colorScheme] of [
  ['desktop', { width: 1280, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
] as const) {
  test(`inquest final accusations screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    const opts = { viewport, colorScheme };
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/inquest-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    await openInquestBackroom(await inquestVisitor(browser, 'Admin', errors, opts));
    const players = await inquestTable(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'], errors, opts);
    const host = players[0]!.page;
    await host.getByRole('button', { name: 'Host picks', exact: true }).click();
    await host
      .getByLabel('Pick the Forensic Scientist')
      .getByRole('button', { name: 'Hana', exact: true })
      .click();
    await host.getByRole('button', { name: '✓ Event tiles' }).click();
    const settings = host.getByRole('heading', { name: 'How rounds end' });
    await settings.scrollIntoViewIfNeeded();
    await shot(host, 'lobby-round-settings');
    await host.getByRole('button', { name: 'Start the investigation' }).click();
    const murderer = await whoShows(
      players,
      'Murderer: pick 1 Clue + 1 Means from your own cards.',
    );
    const night = murderer.page.getByRole('region', { name: 'Choose your crime' });
    await night
      .getByRole('button', { name: /^Clue:/ })
      .first()
      .click();
    await night
      .getByRole('button', { name: /^Means:/ })
      .first()
      .click();
    await night.getByRole('button', { name: /^Commit:/ }).click();
    await expect(host.getByText('Pick the Location tile for this crime.')).toBeVisible();
    await host.locator('button[data-tile]:visible').first().click();
    await host.getByRole('button', { name: /^Use Location [A-D] / }).click();
    await placeBullets(host, 6);
    await shot(host, 'discussion-next-round');
    await endInquestDiscussion(players, 'Next round');
    for (const round of [2, 3]) {
      await replaceTile(host);
      await placeBullets(host, 1);
      if (round === 3) await shot(host, 'discussion-start-final');
      await endInquestDiscussion(players, round === 2 ? 'Next round' : 'Start final accusations');
    }
    // The first accuser (left of the Forensic Scientist) names a wrong pair.
    const seats = players.slice(1);
    const first = await whoShows(seats, /^Final accusations: your turn/);
    await shot(first.page, 'final-your-turn');
    const target = seats.find((p) => p !== murderer && p !== first)!;
    await inquestSolve(first.page, target.name, 1, 1);
    await expect(first.page.getByText(/^Final accusations: your turn/)).toHaveCount(0);
    const second = await whoShows(seats, /^Final accusations: your turn/);
    const watcher = seats.find((p) => p !== first && p !== second)!;
    await shot(watcher.page, 'final-watching');
    await shot(host, 'final-fs');
    if (label === 'desktop') {
      const tv = await inquestVisitor(browser, 'Tv', errors, {
        viewport: { width: 1920, height: 1080 },
        colorScheme: 'dark',
      });
      await unlockInquest(tv, `/backroom?next=${encodeURIComponent(new URL(host.url()).pathname)}`);
      await tv.getByRole('button', { name: '📺 Table screen' }).click();
      await expect(tv.getByLabel('Table screen')).toBeVisible();
      await tv.screenshot({ path: `test-results/shots/inquest${''}-tv-final-accusations.png` });
      await tv.context().close();
    }
    // The host skips everyone else's turn: every final accusation missed.
    for (let i = 0; i < 3; i++) {
      await host.getByRole('button', { name: 'Skip', exact: true }).click();
      if (i < 2) await expect(host.getByText(/turn skipped/).nth(i)).toBeVisible();
    }
    await expect(
      host.getByText('Every final accusation missed: the Murderer’s side wins.'),
    ).toBeVisible();
    await shot(host, 'final-end');
    expect(errors).toEqual([]);
  });
}

for (const [label, viewport, colorScheme] of [
  ['desktop', { width: 1280, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
] as const) {
  // The Allies expansion at 14 players (13 suspects). Set INQUEST_ART to preview the real art.
  test(`inquest allies screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    const opts = { viewport, colorScheme };
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/inquest-${label}-allies-${name}.png`,
        fullPage: label === 'desktop',
      });
    const tab = async (p: Page, name: string) => {
      if (label === 'phone')
        await p
          .getByRole('navigation', { name: 'Game sections' })
          .getByRole('button', { name })
          .click();
    };
    await openInquestBackroom(await inquestVisitor(browser, 'Admin', errors, opts));
    const names = [
      'Hana',
      'Ana',
      'Ben',
      'Cy',
      'Dee',
      'Eve',
      'Fay',
      'Gus',
      'Hal',
      'Ivy',
      'Jo',
      'Kai',
    ];
    const players = await inquestTable(browser, names, errors, opts);
    const host = players[0]!.page;
    await host.getByRole('button', { name: 'Allies expansion', exact: true }).click();
    await expect(host.getByRole('button', { name: '✓ Allies expansion' })).toBeVisible();
    // Two more join (and are seated) once the cap is 14.
    const path = new URL(host.url()).pathname;
    for (const n of ['Lee', 'Mo']) {
      const page = await inquestVisitor(browser, n, errors, opts);
      await unlockInquest(page, `/backroom?next=${encodeURIComponent(path)}`);
      await expect(page).toHaveURL(host.url());
      players.push({ name: n, page });
    }
    await expect(host.getByText('(14/14)')).toBeVisible();
    await host.getByRole('button', { name: 'Host picks', exact: true }).click();
    await host
      .getByLabel('Pick the Forensic Scientist')
      .getByRole('button', { name: 'Hana', exact: true })
      .click();
    await host.getByRole('button', { name: /^Use the suggested roles/ }).click();
    await host.getByRole('button', { name: 'Protective Detail', exact: true }).click();
    await host.getByRole('button', { name: '✓ Event tiles' }).click();
    await host.getByRole('heading', { name: /^Allies expansion/ }).scrollIntoViewIfNeeded();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start the investigation' }).click();

    const murderer = await whoShows(
      players,
      'Murderer: pick 1 Clue + 1 Means from your own cards.',
      45_000,
    );
    const night = murderer.page.getByRole('region', { name: 'Choose your crime' });
    await night
      .getByRole('button', { name: /^Clue:/ })
      .first()
      .click();
    await night
      .getByRole('button', { name: /^Means:/ })
      .first()
      .click();
    await night.getByRole('button', { name: /^Commit:/ }).click();
    await expect(host.getByText('Pick the Location tile for this crime.')).toBeVisible();
    await host.locator('button[data-tile]:visible').first().click();
    await host.getByRole('button', { name: /^Use Location [A-D] / }).click();
    await placeBullets(host, 6);
    const others = players.filter((p) => p.page !== host && p !== murderer);
    const guard = await withRole(others, 'Protective Detail');
    await tab(guard.page, 'Me');
    await guard.page.getByRole('button', { name: 'Reveal your role card' }).click();
    await shot(guard.page, 'me-protective');
    await guard.page.getByRole('button', { name: 'Hide your role card' }).click();
    const inv = others.find((p) => p !== guard)!;
    await tab(inv.page, 'Suspects');
    if (label === 'phone') await inv.page.getByRole('button', { name: '▦ Grid' }).click();
    // The card images load lazily as they scroll in.
    await inv.page.waitForTimeout(1500);
    await shot(inv.page, 'suspects-13');
    if (label === 'phone') await inv.page.getByRole('button', { name: '▦ Grid' }).click();

    // The Allies Phase.
    await endInquestDiscussion(players, 'Next round');
    const lab = await whoShows(players, /^Allies Phase: check one card/, 45_000);
    const check = lab.page.getByRole('region', { name: 'Check a card' });
    await check.getByLabel('Whose card').getByRole('button', { name: murderer.name }).click();
    await check
      .getByRole('button', { name: /^Means:/ })
      .first()
      .click();
    await shot(lab.page, 'lab-check');
    const waiting = players.find((p) => p !== lab && p.page !== host)!;
    await shot(waiting.page, 'waiting');
    await check.getByRole('button', { name: /^Check / }).click();
    await expect(lab.page.getByText(/🤫 Your check:/)).toBeVisible();
    await shot(lab.page, 'lab-result');
    const inside = await whoShows(players, 'Allies Phase: take one player’s badge.', 45_000);
    const take = inside.page.getByRole('region', { name: 'Take a badge' });
    const victim = players.find((p) => p !== inside && p.page !== host && p !== murderer)!;
    await take.getByRole('button', { name: victim.name, exact: true }).click();
    await shot(inside.page, 'inside-pick');
    await take.getByRole('button', { name: /^Take / }).click();
    await expect(host.getByText(`📣 ${victim.name} lost their badge.`)).toBeVisible();
    await shot(host, 'badge-lost');
    if (label === 'desktop') {
      const tv = await inquestVisitor(browser, 'Tv', errors, {
        viewport: { width: 1920, height: 1080 },
        colorScheme: 'dark',
      });
      await unlockInquest(tv, `/backroom?next=${encodeURIComponent(path)}`);
      await tv.getByRole('button', { name: '📺 Table screen' }).click();
      await expect(tv.getByLabel('Table screen')).toBeVisible();
      await tv.waitForTimeout(1500);
      await tv.screenshot({ path: `test-results/shots/inquest${''}-tv-allies-13-suspects.png` });
      await tv.context().close();
    }

    // Round 2, a right solve, and the Reversal with the Inside Man.
    await replaceTile(host);
    await placeBullets(host, 1);
    const solver = await withRole(
      players.filter((p) => p !== victim && p !== inside && p.page !== host && p !== murderer),
      'Investigator',
    );
    await inquestSolve(solver.page, murderer.name, 0, 0);
    const insidePanel = inside.page.getByRole('region', { name: 'The Reversal' });
    await expect(insidePanel.getByText(/Your side: /)).toBeVisible();
    await insidePanel.getByRole('button').filter({ hasNotText: 'Final answer' }).first().click();
    await shot(inside.page, 'reversal-inside');
    const murPanel = murderer.page.getByRole('region', { name: 'The Reversal' });
    await murPanel.getByRole('button').filter({ hasText: '👈' }).first().click();
    await murPanel.getByRole('button', { name: /^Final answer/ }).click();
    await expect(host.getByRole('heading', { name: 'Who was who' })).toBeVisible();
    await shot(host, 'end');
    expect(errors).toEqual([]);
  });

  test(`inquest change of heart screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    const opts = { viewport, colorScheme };
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/inquest-${label}-allies-${name}.png`,
        fullPage: label === 'desktop',
      });
    await openInquestBackroom(await inquestVisitor(browser, 'Admin', errors, opts));
    const players = await inquestTable(browser, ['Hal', 'Ida', 'Jon', 'Kim'], errors, opts);
    const host = players[0]!.page;
    await host.getByRole('button', { name: 'Host picks', exact: true }).click();
    await host
      .getByLabel('Pick the Forensic Scientist')
      .getByRole('button', { name: 'Hal', exact: true })
      .click();
    await host.getByRole('button', { name: 'Allies expansion', exact: true }).click();
    await host.getByRole('button', { name: 'Start the investigation' }).click();
    const murderer = await whoShows(
      players,
      'Murderer: pick 1 Clue + 1 Means from your own cards.',
    );
    const night = murderer.page.getByRole('region', { name: 'Choose your crime' });
    await night
      .getByRole('button', { name: /^Clue:/ })
      .first()
      .click();
    await night
      .getByRole('button', { name: /^Means:/ })
      .first()
      .click();
    await night.getByRole('button', { name: /^Commit:/ }).click();
    await expect(host.getByText('Pick the Location tile for this crime.')).toBeVisible();
    await host.locator('button[data-tile]:visible').first().click();
    await host.getByRole('button', { name: /^Use Location [A-D] / }).click();
    await placeBullets(host, 6);
    await endInquestDiscussion(players, 'Next round');
    // The event cards, in order: the Change of Heart (renamed by the art's manifest, if any),
    // then the events after it.
    await expect(host.getByRole('dialog', { name: /^Event: / })).toBeVisible();
    await shot(host, 'change-of-heart-card');
    await dismissAnyEvent(players);
    await dismissAnyEvent(players);
    await expect(host.getByText(/🎭 Secret: you peeked at an event/)).toBeVisible();
    await shot(host, 'fs-switched');
    await host.locator('button[data-item][data-marked="false"]:visible').first().click();
    await host.getByRole('button', { name: /^Move the bullet to/ }).click();
    await dismissAnyEvent(players);
    await replaceTile(host);
    await replaceTile(host);
    await placeBullets(host, 2);
    await replaceTile(host);
    await placeBullets(host, 1);
    const solver = players.find((p) => p.page !== host && p !== murderer)!;
    await inquestSolve(solver.page, murderer.name, 0, 0);
    await expect(host.getByText(/an event, and switched to the Murderer’s side/)).toBeVisible();
    await shot(host, 'change-of-heart-end');
    expect(errors).toEqual([]);
  });
}

for (const [label, viewport, colorScheme] of [
  ['desktop', { width: 1280, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
] as const) {
  test(`seance screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    await openInquestBackroom(
      await inquestVisitor(browser, 'Admin', [], { viewport, colorScheme }),
    );
    await seanceScreenshots(browser, label, { viewport, colorScheme });
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`hydra screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(600_000);
    const phone = label === 'phone';
    const errors: string[] = [];
    const opts = {
      viewport,
      colorScheme: phone ? ('dark' as const) : ('light' as const),
      moments: true,
    };
    const shot = (p: Page, name: string) =>
      p.screenshot({ path: `test-results/shots/hydra-${label}-${name}.png`, fullPage: !phone });
    const tab = async (p: Page, name: string) => {
      if (phone)
        await p
          .getByRole('navigation', { name: 'Game sections' })
          .getByRole('button', { name })
          .click();
    };
    await openInquestBackroom(await inquestVisitor(browser, 'Admin', errors, opts));
    const players = await hy.hydraTable(
      browser,
      ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'],
      errors,
      opts,
    );
    const host = players[0]!.page;
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start with 10 players' }).click();
    const card = host.getByRole('region', { name: 'Your role card' });
    await card.getByRole('button', { name: '👁️ Show my role' }).click();
    await host.waitForTimeout(700);
    await shot(host, 'reveal');
    await card.getByRole('button', { name: '🙈 Hide my role' }).click();
    await hy.readRoles(players);
    const notLeader = (p: hy.Player) => p.role === 'leader';

    // Nomination at ten players: every seat, the header and the dock fit a phone.
    const pres = await hy.president(players);
    const chan = await hy.eligible(pres, players, notLeader);
    await pres.page.getByRole('button', { name: `Nominate ${chan.name} as Chancellor` }).click();
    await shot(pres.page, 'nominate');
    await pres.page
      .getByTestId('dock')
      .getByRole('button', { name: `Nominate ${chan.name}` })
      .click();
    const voter = players.find((p) => p !== pres && p !== chan)!;
    await voter.page.getByRole('button', { name: 'Vote Yes' }).click();
    await shot(voter.page, 'vote');
    await hy.voteAll(players.filter((p) => p !== players.at(-1)));
    const last = players.at(-1)!;
    await last.page.getByRole('button', { name: 'Vote No' }).click();
    await expect(host.getByTestId('moment')).toBeVisible();
    await host.waitForTimeout(2200);
    await shot(host, 'vote-reveal');

    // The session behind the privacy shield, then the claims.
    const sheet = pres.page.getByRole('dialog', { name: 'You’re the President' });
    await sheet.getByRole('button', { name: 'Show cards' }).click();
    await sheet
      .getByRole('button', { name: /^Discard: / })
      .first()
      .click();
    await pres.page.waitForTimeout(600);
    await shot(pres.page, 'president-sheet');
    await sheet.getByRole('button', { name: /^Discard this/ }).click();
    const two = chan.page.getByRole('dialog', { name: 'You’re the Chancellor' });
    await chan.page.waitForTimeout(250);
    await shot(chan.page, 'chancellor-shuffle');
    await two.getByRole('button', { name: 'Show cards' }).click();
    await two
      .getByRole('button', { name: /^Enact: / })
      .first()
      .click();
    await chan.page.waitForTimeout(600);
    await shot(chan.page, 'chancellor-sheet');
    await two.getByRole('button', { name: /^Enact this/ }).click();
    await expect(host.getByTestId('moment')).toBeVisible();
    await host.waitForTimeout(1800);
    await shot(host, 'enact-moment');
    const form = pres.page.getByTestId('claim-form');
    await form
      .getByRole('button', { name: '2 Conspirator, 1 Loyalist, discarded Conspirator' })
      .click();
    await form.getByRole('button', { name: 'Make this claim' }).click();
    await shot(pres.page, 'claim');
    await form.getByRole('button', { name: 'Confirm claim' }).click();
    await shot(host, 'claims-waiting');
    await hy.claim(chan, { blues: 0 });

    // Red #1 at ten players: investigate.
    const target = players.find((p) => p !== pres)!;
    await pres.page.getByRole('button', { name: `Investigate loyalty: ${target.name}` }).click();
    await shot(pres.page, 'power');
    await pres.page
      .getByTestId('dock')
      .getByRole('button', { name: `Investigate ${target.name}` })
      .click();
    await pres.page.waitForTimeout(1200);
    await shot(pres.page, 'investigate-claim');
    await hy.claim(pres, { team: 'red' });
    await tab(host, 'Log');
    await shot(host, 'log');
    await tab(host, 'Me');
    await shot(host, 'me');
    await tab(host, 'Table');

    // More governments until the danger zone, the Leader check, and an execution.
    let red = 1;
    let checked = false;
    for (let round = 0; round < 14 && (await host.getByTestId('winner').count()) === 0; round++) {
      const p = await hy.whoShows(players, /You’re the Presidential Candidate|Use your power/);
      if ((await p.page.getByText(/Use your power/).count()) > 0) {
        const power = (await p.page.getByTestId('dock').textContent()) ?? '';
        const leader = players.find((x) => x.role === 'leader')!;
        const victim =
          p !== leader && !leader.dead
            ? leader
            : players.find((x) => x !== p && !x.dead && x.role !== 'leader')!;
        const verb = /Execution/.test(power)
          ? 'Execution'
          : /Special election/.test(power)
            ? 'Special election'
            : 'Investigate loyalty';
        const pick =
          verb === 'Investigate loyalty'
            ? players.find((x) => x !== p && !x.dead && x !== target)!
            : victim;
        await p.page.getByRole('button', { name: `${verb}: ${pick.name}` }).click();
        if (verb === 'Execution') {
          await shot(p.page, 'execute');
          await p.page
            .getByTestId('dock')
            .getByRole('button', { name: `Execute ${pick.name}…` })
            .click();
          await p.page
            .getByTestId('dock')
            .getByRole('button', { name: `Yes, execute ${pick.name}` })
            .click();
          pick.dead = true;
        } else {
          await p.page
            .getByTestId('dock')
            .getByRole('button', {
              name:
                verb === 'Special election'
                  ? `Make ${pick.name} the next candidate`
                  : `Investigate ${pick.name}`,
            })
            .click();
          if (verb === 'Investigate loyalty') await hy.claim(p, { team: 'blue' });
        }
        continue;
      }
      const alive = players.filter((x) => !x.dead);
      const c = await hy.eligible(p, alive, notLeader);
      await hy.nominate(p, c.name);
      await hy.voteAll(alive);
      if (red >= 3 && !checked) {
        await expect(host.getByTestId('leader-check')).toBeVisible();
        await shot(host, 'leader-check');
        checked = true;
      }
      const gov = await hy.legislate(alive, 'red');
      red++;
      await hy.claimSession(gov);
    }
    await expect(host.getByTestId('winner')).toBeVisible();
    await host.waitForTimeout(3500);
    await shot(host, 'end');
    if (phone) {
      await host.getByRole('region', { name: 'The truth' }).scrollIntoViewIfNeeded();
      await shot(host, 'end-truth');
    }
    expect(errors).toEqual([]);
  });
  // Hydra's themed edition with a made-up manifest: its own names and team colours.
  test(`hogwarts screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const phone = label === 'phone';
    const errors: string[] = [];
    const opts = {
      viewport,
      colorScheme: phone ? ('dark' as const) : ('light' as const),
      moments: true,
      manifest: { gameId: 'hogwarts', body: HOGWARTS },
    };
    const shot = (p: Page, name: string) =>
      p.screenshot({ path: `test-results/shots/hogwarts-${label}-${name}.png`, fullPage: !phone });
    await openInquestBackroom(await inquestVisitor(browser, 'Admin', errors, opts));
    const players = await hy.hydraTable(
      browser,
      ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'],
      errors,
      opts,
      HOGWARTS_WORDS,
    );
    const host = players[0]!.page;
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start with 5 players' }).click();
    await hy.readRoles(players);
    const pres = await hy.president(players);
    const chan = await hy.eligible(pres, players, (p) => p.role === 'leader');
    await hy.nominate(pres, chan.name);
    await hy.voteAll(players);
    await expect(host.getByTestId('moment')).toBeVisible();
    await host.waitForTimeout(2200);
    await shot(host, 'vote-reveal');
    const gov = await hy.legislate(players, 'red');
    await expect(host.getByTestId('moment')).toBeVisible();
    await host.waitForTimeout(1800);
    await shot(host, 'enact-moment');
    await hy.claimSession(gov);
    await host.waitForTimeout(600);
    await shot(host, 'table');
    expect(errors).toEqual([]);
  });
}
