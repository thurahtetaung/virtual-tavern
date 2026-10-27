import { type Page, expect } from '@playwright/test';
import { localArt, results, settings, table } from './defuse-play.ts';
import { type Op, call, changed, ready, stamp } from './defuse-3d-play.ts';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The defuser's 3D bomb. The e2e server builds every bomb from a fixed seed (see defuse-play.ts):
// with the default 3 modules it holds wires (cut the first), a keypad (keys 1, 4, 3, 2) and a
// password (GREAT). Without the private 3D pack (as in CI) the bomb is plain boxes; with
// DEFUSE_ART it is the real one. The test hooks on `window.__defuse3d` exist only while the server
// runs the test seed.

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

/** Taps a point on the bomb with a real pointer (mouse or touch). */
async function tapAt(p: Page, at: { x: number; y: number } | null) {
  expect(at).not.toBeNull();
  if (await p.evaluate(() => matchMedia('(pointer: coarse)').matches))
    await p.touchscreen.tap(at!.x, at!.y);
  else await p.mouse.click(at!.x, at!.y);
}

/** Looks at a module with real taps: pick the bomb up if it is down, turn to its face, tap it. */
async function look(p: Page, id: string) {
  if ((await call(p, 'pose')).pose === 'desk') {
    await tapAt(p, await call(p, 'where', id));
    await expect.poll(async () => (await call(p, 'pose')).pose).toBe('held');
  }
  if ((await call(p, 'pose')).module === id) return;
  if ((await call(p, 'pose')).pose === 'module') {
    await call(p, 'back');
    await p.waitForTimeout(300);
  }
  if (Number(id[1]) !== (await call(p, 'pose')).face) {
    // The other face: turn the bomb over first.
    await call(p, 'turn', 'right');
    await call(p, 'turn', 'right');
  }
  await p.waitForTimeout(400);
  await tapAt(p, await call(p, 'where', id));
  await expect.poll(async () => (await call(p, 'pose')).module).toBe(id);
  await p.waitForTimeout(300);
}

/** Uses one part of the focused module with a real tap. */
async function use(p: Page, id: string, op: Op) {
  const i = await call(p, 'partFor', id, op);
  expect(i, `a part for ${JSON.stringify(op)}`).toBeGreaterThanOrEqual(0);
  const before = await stamp(p);
  await tapAt(p, await call(p, 'where', id, i));
  await changed(p, before);
}

test('a bomb defused through the 3D view, then one that goes off', async ({ browser }) => {
  test.setTimeout(150_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], { setup: localArt })) as [Page, Page];
  // The 3D bomb is everyone's default.
  await expect(ana.getByTestId('view-3d')).toHaveAttribute('aria-pressed', 'true');
  await ana.getByTestId('start').click();
  await ready(ana);
  await expect(ana.getByTestId('bomb-hint')).toHaveText('Click the bomb to pick it up.');
  await expect(ben.getByTestId('status')).toContainText('Ana is defusing bomb 1');
  await expect(ben.getByTestId('bomb-3d')).toHaveCount(0);

  // The edges carry the serial number and the rest.
  const edges = await call(ana, 'edges');
  expect(edges.filter((e) => 'serial' in e)).toHaveLength(1);

  const bomb = await call(ana, 'bomb');
  const id = (kind: string) => bomb.modules.find((m) => m.kind === kind)!.id;
  await look(ana, id('wires'));
  await expect(ana.getByTestId('bomb-hint')).toHaveText(
    'Click a part to use it. Right-click or Esc steps back.',
  );
  await use(ana, id('wires'), { op: 'cut', wire: 0 });
  await expect.poll(async () => (await call(ana, 'look', id('wires')))?.led).toBe('pass');
  await expect(ana.getByTestId('bomb-hint')).toHaveCount(0);

  await look(ana, id('keypad'));
  for (const k of [0, 3, 2, 1]) await use(ana, id('keypad'), { op: 'press', button: k });
  await expect.poll(async () => (await call(ana, 'look', id('keypad')))?.led).toBe('pass');

  await look(ana, id('password'));
  for (const [c, letter] of [...'GREAT'].entries())
    for (let i = 0; i < 6; i++) {
      const shown = ((await call(ana, 'look', id('password'))) as { letters: string[] }).letters;
      if (shown[c] === letter) break;
      await use(ana, id('password'), { op: 'spin', column: c, by: 1 });
    }
  await use(ana, id('password'), { op: 'submit' });
  for (const p of [ana, ben]) await results(p, 'Defused');

  // Hardcore: one wrong cut and it goes off in Ben's hands; his screen goes dark first.
  await settings(ana);
  await ana.getByTestId('set-hardcore').click();
  await ana.getByTestId('next-bomb').click();
  await ready(ben);
  const wires = (await call(ben, 'bomb')).modules.find((m) => m.kind === 'wires')!.id;
  await look(ben, wires);
  await tapAt(ben, await call(ben, 'where', wires, 1));
  await expect(ben.getByTestId('binder')).toBeVisible();
  for (const p of [ana, ben]) await results(p, 'Exploded');
});

test('the hover outline follows the cursor and clears when it leaves', async ({ browser }) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana] = (await table(browser, ['Ana', 'Ben'], {
    setup: localArt,
    viewport: { width: 1280, height: 720 },
  })) as [Page, Page];
  // A full bomb, so the front face holds modules.
  await settings(ana);
  await ana.getByTestId('set-modules').selectOption('11');
  await ana.getByTestId('start').click();
  await ready(ana);
  await call(ana, 'pickUp');
  const [a, b] = (await call(ana, 'bomb')).modules.filter((m) => m.face === 0).map((m) => m.id);
  const lit = () => call(ana, 'lit');
  const hoverOn = async (id: string) => {
    const at = await call(ana, 'where', id);
    await ana.mouse.move(at!.x, at!.y, { steps: 4 });
  };
  // Over module A: A alone is lit.
  await hoverOn(a!);
  await expect.poll(lit).toHaveLength(1);
  const litA = (await lit())[0];
  // Over module B: the outline moves; A is no longer lit.
  await hoverOn(b!);
  await expect.poll(async () => (await lit())[0]).not.toBe(litA);
  await expect.poll(lit).toHaveLength(1);
  // The mouse's hover never buzzes.
  expect((await call(ana, 'haptics')).filter((h) => h.type === 'Selection')).toEqual([]);
  // Off the bomb (the canvas's left edge): nothing lit.
  await ana.mouse.move(4, 360, { steps: 4 });
  await expect.poll(lit).toHaveLength(0);
  // Back on B, then out of the canvas onto the overlay's ? button: nothing lit.
  await hoverOn(b!);
  await expect.poll(lit).toHaveLength(1);
  await ana.getByTestId('bomb-help').hover();
  await expect.poll(lit).toHaveLength(0);
  // Back on A, then zoom in and out with the cursor off the bomb: nothing stays lit.
  await hoverOn(a!);
  await expect.poll(lit).toHaveLength(1);
  await call(ana, 'focus', a!);
  await ana.mouse.move(4, 360, { steps: 2 });
  await call(ana, 'back');
  await expect.poll(lit).toHaveLength(0);
});

test('on touch the finger selects what it is on, and the selection never sticks', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana] = (await table(browser, ['Ana', 'Ben'], {
    setup: localArt,
    viewport: { width: 844, height: 390 },
    touch: true,
  })) as [Page, Page];
  // A full bomb, so the front face holds modules.
  await settings(ana);
  await ana.getByTestId('set-modules').selectOption('11');
  await ana.getByTestId('start').click();
  await ready(ana);
  await call(ana, 'pickUp');
  const [a, b] = (await call(ana, 'bomb')).modules.filter((m) => m.face === 0).map((m) => m.id);
  const lit = () => call(ana, 'lit');
  const cdp = await ana.context().newCDPSession(ana);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  await expect.poll(async () => (await call(ana, 'pose')).pose).toBe('held');
  await ana.waitForTimeout(500);
  const at = (id: string) => call(ana, 'where', id) as Promise<{ x: number; y: number }>;
  // Finger down on A: A alone is selected.
  const pa = await at(a!);
  await touch('touchStart', pa.x, pa.y);
  await expect.poll(lit).toHaveLength(1);
  const litA = (await lit())[0];
  // The finger slides onto B: the selection moves (one lit, not A).
  const pb = await at(b!);
  for (let i = 1; i <= 6; i++)
    await touch('touchMove', pa.x + ((pb.x - pa.x) * i) / 6, pa.y + ((pb.y - pa.y) * i) / 6);
  await expect.poll(async () => (await lit())[0]).not.toBe(litA);
  await expect.poll(lit).toHaveLength(1);
  // Each module the finger reaches ticks (a light buzz), never the mouse's hover.
  await expect
    .poll(async () => (await call(ana, 'haptics')).filter((h) => h.type === 'Selection').length)
    .toBeGreaterThanOrEqual(2);
  // Off the bomb: nothing selected; the lift leaves nothing either.
  await touch('touchMove', 4, 195);
  await expect.poll(lit).toHaveLength(0);
  await touch('touchEnd');
  await expect.poll(lit).toHaveLength(0);
  // A tap on B: selected while down, cleared on the lift, and B is looked at.
  await touch('touchStart', pb.x, pb.y);
  await expect.poll(lit).toHaveLength(1);
  await touch('touchEnd');
  await expect.poll(lit).toHaveLength(0);
  await expect.poll(async () => (await call(ana, 'pose')).module).toBe(b);
});

/** A touch drag from (x, y) toward the right and down, with raw touch events. */
async function touchDrag(p: Page, x: number, y: number) {
  const cdp = await p.context().newCDPSession(p);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', tx = 0, ty = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: tx, y: ty }],
    });
  await touch('touchStart', x, y);
  for (let i = 1; i <= 8; i++) await touch('touchMove', x + i * 40, y + i * 12);
  return () => touch('touchEnd');
}

test('on touch a drag that starts off the bomb on the desk looks around, and the view comes back', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana] = (await table(browser, ['Ana', 'Ben'], {
    setup: localArt,
    viewport: { width: 844, height: 390 },
    touch: true,
  })) as [Page, Page];
  await ana.getByTestId('start').click();
  await ready(ana);
  expect((await call(ana, 'pose')).pose).toBe('desk');
  await ana.waitForTimeout(500);
  // From near the top left (clear of the overlay's buttons), off the bomb, toward the right and down.
  expect(await call(ana, 'pickAt', 100, 80)).toBeNull();
  const end = await touchDrag(ana, 100, 80);
  await expect.poll(async () => (await call(ana, 'glance'))[0]).toBeGreaterThan(0.3);
  expect((await call(ana, 'glance'))[1]).toBeGreaterThan(0);
  // The bomb stayed on the desk.
  expect((await call(ana, 'pose')).pose).toBe('desk');
  await end();
  await expect.poll(() => call(ana, 'glance')).toEqual([0, 0]);
  expect((await call(ana, 'pose')).pose).toBe('desk');
});

test('on touch a held bomb never looks around: a drag off it turns the bomb', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana] = (await table(browser, ['Ana', 'Ben'], {
    setup: localArt,
    viewport: { width: 844, height: 390 },
    touch: true,
  })) as [Page, Page];
  await ana.getByTestId('start').click();
  await ready(ana);
  await call(ana, 'pickUp');
  await expect.poll(async () => (await call(ana, 'pose')).pose).toBe('held');
  await ana.waitForTimeout(500);
  expect(await call(ana, 'pickAt', 100, 80)).toBeNull();
  const end = await touchDrag(ana, 100, 80);
  // Give a glance time to start, as it does at the desk: the view never turns.
  await ana.waitForTimeout(600);
  expect(await call(ana, 'glance')).toEqual([0, 0]);
  await end();
  expect(await call(ana, 'glance')).toEqual([0, 0]);
  expect((await call(ana, 'pose')).pose).toBe('held');
});

test('a pinch zooms in on an edge, pans with the fingers, and steps back out', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana] = (await table(browser, ['Ana', 'Ben'], {
    setup: localArt,
    viewport: { width: 844, height: 390 },
    touch: true,
  })) as [Page, Page];
  await ana.getByTestId('start').click();
  await ready(ana);
  await call(ana, 'pickUp');
  await expect.poll(async () => (await call(ana, 'pose')).pose).toBe('held');
  // The top edge, where the edgework is (▾ brings it toward you).
  await call(ana, 'turn', 'down');
  await ana.waitForTimeout(800);
  const cdp = await ana.context().newCDPSession(ana);
  const fingers = (type: 'touchStart' | 'touchMove' | 'touchEnd', spread = 0, dx = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              { x: 422 - 40 - spread + dx, y: 195, id: 1 },
              { x: 422 + 40 + spread + dx, y: 195, id: 2 },
            ],
    });
  const zoom = () => call(ana, 'zoom');
  const z0 = await zoom();
  expect(z0.zoom).toBe(0);
  // Beyond the original's 0.15 m, to 0.1 m from the edge looked at.
  expect(z0.max).toBeGreaterThan(0.15);
  await fingers('touchStart');
  for (let i = 1; i <= 10; i++) await fingers('touchMove', i * 30);
  // The fingers move together: the view goes with them.
  for (let i = 1; i <= 5; i++) await fingers('touchMove', 300, -i * 20);
  await fingers('touchEnd');
  await expect.poll(async () => (await zoom()).zoom).toBeGreaterThan(0.15);
  // Both fingers are gone once lifted.
  expect((await zoom()).pointers).toBe(0);
  expect(Math.abs((await zoom()).pan.x)).toBeGreaterThan(0.001);
  // Back: the zoom and the pan go home.
  await call(ana, 'back');
  await expect.poll(async () => (await zoom()).zoom).toBeLessThan(0.001);
  await expect.poll(async () => Math.abs((await zoom()).pan.x)).toBeLessThan(0.001);
});

// Under the test seed this bomb holds the Button, which always sits on the timer's face.
const SIZES = [
  { name: 'phone-sideways', viewport: { width: 844, height: 390 }, touch: true },
  { name: 'phone-upright', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, touch: false },
];
for (const size of SIZES)
  test(`the timer stays in view while the Button is looked at: ${size.name}`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    await openBackroom(await visitor(browser, 'Admin'));
    const [ana] = (await table(browser, ['Ana', 'Ben'], {
      setup: localArt,
      viewport: size.viewport,
      ...(size.touch ? { touch: true } : {}),
    })) as [Page, Page];
    await settings(ana);
    await ana.getByTestId('set-modules').selectOption('11');
    await ana.getByTestId('vetoes').locator('summary').click();
    for (const k of ['simon', 'whos-on-first', 'memory']) {
      await ana.getByTestId(`veto-${k}`).click();
      await expect(ana.getByTestId(`veto-${k}`)).toHaveAttribute('aria-pressed', 'true');
    }
    await ana.getByTestId('start').click();
    await ready(ana);
    const button = (await call(ana, 'bomb')).modules.find((m) => m.kind === 'button');
    expect(button, 'the seed deals the Button').toBeTruthy();
    await look(ana, button!.id);
    // The original's Button keeps its focus distance on touch: no zoom in.
    expect((await call(ana, 'zoom')).zoom).toBe(0);
    await ana.waitForTimeout(400);
    const at = await call(ana, 'where', 'timer');
    const where = await call(ana, 'where', button!.id);
    expect(at).not.toBeNull();
    const { width, height } = size.viewport;
    for (const p of [at!, where!]) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(width);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(height);
    }
    if (process.env.SCREENSHOTS)
      await ana.screenshot({
        path: `${process.env.SHOTS_DIR ?? 'test-results/shots'}/button-timer-${size.name}.png`,
      });
  });
