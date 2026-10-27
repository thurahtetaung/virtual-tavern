import { mkdirSync, writeFileSync } from 'node:fs';
import { type Page, expect } from '@playwright/test';
import { nextMove } from '../packages/private-games/defuse/src/logic/bot.ts';
import { localArt, results, settings, table, tv } from './defuse-play.ts';
import { test } from './fixtures.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check and measurements of the 3D bomb:
//   SCREENSHOTS=1 pnpm exec playwright test e2e/defuse-3d-shots.spec.ts
// With DEFUSE_ART=<folder holding manifest.json (or manifest-draft.json), the art and the 3D pack>
// the pages get them from disk; without it the bomb is plain boxes. Shots go to SHOTS_DIR, the
// measurements to the log (one JSON line each).
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const DIR = process.env.SHOTS_DIR ?? 'test-results/defuse-3d-shots';

type Op = { op: string; [k: string]: unknown };
interface Hooks {
  where: (id: string, i?: number) => { x: number; y: number } | null;
  focus: (id: string) => void;
  back: () => void;
  pickUp: () => void;
  turn: (d: string) => void;
  press: (i: number) => void;
  release: () => void;
  partFor: (id: string, op: Op) => number;
  next: () => { module: string; op: Op } | 'wait' | null;
  bomb: () => { modules: { id: string; kind: string; solved: boolean }[]; end: unknown };
  info: () => Record<string, number | boolean>;
  middle: (id: string) => { x: number; y: number } | null;
  pose: () => { pose: string; module: string | null; face: 0 | 1 };
}

const call = <K extends keyof Hooks>(p: Page, name: K, ...args: Parameters<Hooks[K]>) =>
  p.evaluate(
    ([n, a]) => {
      // The hooks go with the 3D view (at the bomb's end): then every call answers null.
      const hooks = (
        window as unknown as { __defuse3d?: Record<string, (...x: unknown[]) => unknown> }
      ).__defuse3d;
      return hooks?.[n]?.(...a) ?? null;
    },
    [name, args] as [string, unknown[]],
  ) as Promise<ReturnType<Hooks[K]>>;

async function ready(p: Page) {
  await expect(p.getByTestId('bomb-3d')).toHaveAttribute('data-ready', /ready|failed/, {
    timeout: 60_000,
  });
  await p.waitForFunction(() => !!(window as unknown as { __defuse3d?: unknown }).__defuse3d);
}

/** Plays the bomb out with the solver, through the scene. */
async function solve(p: Page) {
  for (let guard = 0; guard < 300; guard++) {
    const b = await call(p, 'bomb');
    if (!b || b.end) return;
    const mv = await call(p, 'next');
    if (mv === null) return;
    if (mv === 'wait') {
      await p.waitForTimeout(250);
      continue;
    }
    await call(p, 'focus', mv.module);
    await p.waitForTimeout(250);
    if (mv.op.op === 'up') await call(p, 'release');
    else {
      await call(p, 'press', await call(p, 'partFor', mv.module, mv.op));
      if (mv.op.op === 'tap') await call(p, 'release');
    }
    await p.waitForTimeout(400);
  }
}

for (const [label, viewport, colorScheme] of [
  ['phone-sideways', { width: 844, height: 390 }, 'dark'],
  ['phone-upright', { width: 390, height: 844 }, 'light'],
  ['desktop', { width: 1440, height: 900 }, 'light'],
] as const) {
  test(`defuse 3D screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 600_000));
    const touch = viewport.width < 1024;
    const look: Look = { viewport, colorScheme, setup: localArt, touch };
    const shot = async (p: Page, name: string, wait = 700) => {
      await p.waitForTimeout(wait);
      await p.screenshot({ path: `${DIR}/${label}/${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const [ana, ben] = (await table(browser, ['Ana', 'Ben'], look)) as [Page, Page];
    await shot(ana, '00-lobby');
    // A bomb with every slot filled and a needy module.
    await settings(ana);
    await ana.getByTestId('set-modules').selectOption('11');
    await ana.getByTestId('set-needy').click();
    const t0 = Date.now();
    await ana.getByTestId('start').click();
    await ready(ana);
    const loadMs = Date.now() - t0;
    await shot(ana, '01-desk-dark', 300);
    if (touch) {
      await shot(ana, '01b-turn-your-phone', 0);
    }
    await ana.waitForTimeout(6500);
    await shot(ana, '02-desk');
    await call(ana, 'pickUp');
    await shot(ana, '03-held');
    if (!touch) {
      // The hover outline round a module.
      const at = await call(ana, 'where', 'm01');
      if (at) await ana.mouse.move(at.x, at.y);
      await shot(ana, '03b-hover');
    }
    for (const d of ['up', 'down', 'left', 'right', 'right']) {
      await call(ana, 'turn', d);
      await shot(ana, `04-turn-${d}`);
      if (d === 'up' || d === 'down') await call(ana, 'turn', d === 'up' ? 'down' : 'up');
    }
    await call(ana, 'turn', 'right');
    const bomb = await call(ana, 'bomb');
    for (const m of [...bomb.modules].sort((a, b) => a.id.localeCompare(b.id))) {
      await call(ana, 'focus', m.id);
      await shot(ana, `10-${m.kind}-${m.id}`);
      // The module looked at sits in the middle of the screen.
      console.log(JSON.stringify({ label, module: m.id, middle: await call(ana, 'middle', m.id) }));
    }
    // Measurements, as the design review took them: holding still, turning, zoomed.
    const measure = async (what: string, during: () => Promise<void>) => {
      await during();
      const info = await call(ana, 'info');
      const heap = await ana.evaluate(
        () =>
          (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
            ?.usedJSHeapSize ?? 0,
      );
      console.log(
        JSON.stringify({ label, what, loadMs, heapMB: +(heap / 1e6).toFixed(1), ...info }),
      );
    };
    await call(ana, 'back');
    await call(ana, 'back');
    await call(ana, 'pickUp');
    // Phones: a slow phone's CPU (4× slower), as the design review measured.
    const cdp = touch ? await ana.context().newCDPSession(ana) : null;
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await measure('held', () => ana.waitForTimeout(5000));
    await measure('turning', async () => {
      for (let i = 0; i < 10; i++) {
        await call(ana, 'turn', i % 2 ? 'right' : 'up');
        await ana.waitForTimeout(500);
        await call(ana, 'turn', 'down');
      }
    });
    await call(ana, 'focus', bomb.modules[0]!.id);
    await measure('zoomed', () => ana.waitForTimeout(5000));
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    // The ? card.
    await ana.getByTestId('bomb-help').click();
    await shot(ana, '20-controls-card');
    await ana.getByRole('button', { name: 'Back to the bomb' }).click();
    // A strike: a wrong cut on the wires (any wire but the solver's answer).
    const wires = bomb.modules.find((m) => m.kind === 'wires');
    if (wires) {
      const right = await call(ana, 'next');
      await call(ana, 'focus', wires.id);
      await ana.waitForTimeout(300);
      const answer =
        right && right !== 'wait' && right.module === wires.id ? (right.op.wire as number) : -1;
      for (let i = 0; i < 6; i++) {
        if (i === answer) continue;
        const part = await call(ana, 'partFor', wires.id, { op: 'cut', wire: i });
        if (part < 0) continue;
        await call(ana, 'press', part);
        break;
      }
      await shot(ana, '30-strike', 250);
      await call(ana, 'back');
      await shot(ana, '31-strike-lamp', 200);
    }

    await ben.close();
  });
}

test('defuse 3D screenshots: the last minute, explode and defuse', async ({ browser }) => {
  test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 600_000));
  for (const [label, viewport] of [
    ['phone-sideways', { width: 844, height: 390 }],
    ['desktop', { width: 1440, height: 900 }],
  ] as const) {
    const touch = viewport.width < 1024;
    const look: Look = { viewport, colorScheme: 'dark', setup: localArt, touch };
    const shot = async (p: Page, name: string, wait = 400) => {
      await p.waitForTimeout(wait);
      await p.screenshot({ path: `${DIR}/${label}/${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const [ana, ben] = (await table(browser, ['Ana', 'Ben'], look)) as [Page, Page];
    await settings(ana);
    await ana.getByTestId('set-time').selectOption('30');
    await ana.getByTestId('start').click();
    await ready(ana);
    await ana.waitForTimeout(8500);
    await call(ana, 'pickUp');
    for (let i = 0; i < 4; i++) await shot(ana, `40-last-minute-${i}`, 600);
    // Let the clock run out.
    await expect(ana.getByTestId('binder')).toBeVisible({ timeout: 40_000 });
    await shot(ana, '41-exploded', 300);
    await results(ana, 'Exploded');
    await shot(ana, '42-result-exploded');
    // A defused bomb (the default three modules) in Ben's hands, by the solver through the scene.
    await settings(ana);
    await ana.getByTestId('set-time').selectOption('300');
    await ana.getByTestId('next-bomb').click();
    await ready(ben);
    await ben.waitForTimeout(8500);
    await call(ben, 'pickUp');
    await solve(ben);
    await shot(ben, '43-defused', 300);
    await results(ben, 'Defused');
    await shot(ben, '44-result-defused');
  }
});

test('defuse 3D screenshots: the table screen follows the defuser', async ({ browser }) => {
  test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 300_000));
  const look: Look = {
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    setup: localArt,
  };
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana] = (await table(browser, ['Ana', 'Ben'], look)) as [Page, Page];
  const screen = await tv(browser, ana, look);
  await settings(ana);
  await ana.getByTestId('table-bomb').click();
  await ana.getByTestId('start').click();
  await ready(ana);
  await ana.waitForTimeout(6500);
  await call(ana, 'pickUp');
  const first = (await call(ana, 'bomb')).modules[0]!.id;
  await call(ana, 'focus', first);
  await expect(screen.getByTestId('bomb-3d')).toHaveAttribute('data-pose', 'module', {
    timeout: 10_000,
  });
  await screen.waitForTimeout(800);
  await screen.screenshot({ path: `${DIR}/table-screen/50-table-follows.png` });
  await ana.screenshot({ path: `${DIR}/table-screen/50-defuser.png` });
});

for (const [label, viewport] of [
  ['phone-sideways', { width: 844, height: 390 }],
  ['phone-upright', { width: 390, height: 844 }],
] as const)
  test(`defuse 3D screenshots: the hint line (${label})`, async ({ browser }) => {
    test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 300_000));
    const look: Look = { viewport, colorScheme: 'dark', setup: localArt, touch: true };
    await openBackroom(await visitor(browser, 'Admin'));
    const [ana] = (await table(browser, ['Ana', 'Ben'], look)) as [Page, Page];
    await ana.getByTestId('start').click();
    await ready(ana);
    await ana.waitForTimeout(6500);
    await ana.screenshot({ path: `${DIR}/hint/${label}-1-desk.png` });
    await call(ana, 'pickUp');
    await ana.waitForTimeout(800);
    await ana.screenshot({ path: `${DIR}/hint/${label}-2-held.png` });
    // The line is one line, inside the screen, clear of every arrow and corner button.
    const hint = await ana.getByTestId('bomb-hint').boundingBox();
    const text = await ana.getByTestId('bomb-hint').evaluate((e) => e.scrollWidth <= e.clientWidth);
    const buttons = await ana
      .locator('[data-testid^="turn-"], [data-testid="bomb-back"], [data-testid="bomb-help"]')
      .evaluateAll((els) =>
        els
          .filter((e) => getComputedStyle(e).opacity !== '0')
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          }),
      );
    console.log(JSON.stringify({ label, hint, fits: text, buttons: buttons.length }));
    expect(hint!.height).toBeLessThan(30);
    expect(text).toBe(true);
    for (const b of buttons)
      expect(
        hint!.x + hint!.width <= b.x ||
          b.x + b.w <= hint!.x ||
          hint!.y + hint!.height <= b.y ||
          b.y + b.h <= hint!.y,
      ).toBe(true);
  });

test('defuse 3D phone shots: the touch outline, an edge and a module zoomed in', async ({
  browser,
}) => {
  test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 600_000));
  const viewport = { width: 844, height: 390 };
  const look: Look = { viewport, colorScheme: 'dark', setup: localArt, touch: true };
  const out = `${DIR}/phone-zoom`;
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], look)) as [Page, Page];
  await settings(ana);
  await ana.getByTestId('set-modules').selectOption('11');
  await ana.getByTestId('start').click();
  await ready(ana);
  await ana.waitForTimeout(6500);
  const cdp = await ana.context().newCDPSession(ana);
  type Pt = { x: number; y: number };
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Pt[] = []) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: pts.map((p, i) => ({ ...p, id: i + 1 })),
    });
  const shot = async (name: string, wait = 600) => {
    await ana.waitForTimeout(wait);
    await ana.screenshot({ path: `${out}/${name}.png` });
  };
  /** Two fingers spread apart round `at`, `by` px each. */
  const pinch = async (at: Pt, by: number) => {
    const pair = (s: number) => [
      { x: at.x - 30 - s, y: at.y },
      { x: at.x + 30 + s, y: at.y },
    ];
    await touch('touchStart', pair(0));
    for (let i = 1; i <= 12; i++) await touch('touchMove', pair((by * i) / 12));
    await touch('touchEnd');
  };
  const zoom = () =>
    ana
      .evaluate(() =>
        (window as unknown as { __defuse3d: { zoom?: () => unknown } }).__defuse3d.zoom?.(),
      )
      .catch(() => null);
  await call(ana, 'pickUp');
  await ana.waitForTimeout(600);
  const bomb = await call(ana, 'bomb');
  const front = bomb.modules.filter((m) => m.kind !== 'timer');
  // A module whose parts stay as they are when pressed (a cut wire changes its mesh).
  const keyed =
    bomb.modules.find((m) => m.kind === 'keypad') ??
    bomb.modules.find((m) => m.kind === 'memory') ??
    front[0]!;
  // The outline on a whole module, finger held down.
  const m = (await call(ana, 'where', front[0]!.id))!;
  await touch('touchStart', [m]);
  await shot('40-highlight-module', 900);
  await touch('touchMove', [{ x: 4, y: 195 }]);
  await touch('touchEnd');
  // The outline on one part of a module looked at.
  await call(ana, 'focus', keyed.id);
  await ana.waitForTimeout(700);
  const part = (await call(ana, 'where', keyed.id, 0))!;
  await touch('touchStart', [part]);
  // Parts act on touch-down, so this presses the key (maybe a strike): the shot is of the outline.
  await shot('41-highlight-part', 900);
  await touch('touchMove', [{ x: 4, y: 195 }]);
  await touch('touchEnd');
  console.log(JSON.stringify({ what: 'before-pinch', zoom: await zoom() }));
  // The module zoomed in as far as it goes.
  await pinch({ x: 422, y: 195 }, 300);
  await shot('42-module-zoomed', 900);
  console.log(JSON.stringify({ what: 'module-zoom', zoom: await zoom() }));
  await call(ana, 'back');
  await ana.waitForTimeout(500);
  // The top edge (▾), then a side, zoomed in on the edgework.
  await call(ana, 'turn', 'down');
  await shot('43-edge-top');
  // Aimed at the left end of the edge, where the serial number usually sits with this seed.
  await pinch({ x: 255, y: 140 }, 190);
  await shot('44-edge-top-zoomed', 900);
  console.log(JSON.stringify({ what: 'top-zoom', zoom: await zoom() }));
  await call(ana, 'back');
  await call(ana, 'pickUp');
  await ana.waitForTimeout(500);
  await call(ana, 'turn', 'left');
  await shot('45-edge-side');
  await pinch({ x: 422, y: 195 }, 300);
  await shot('46-edge-side-zoomed', 900);
  console.log(JSON.stringify({ what: 'side-zoom', zoom: await zoom() }));
  await ben.close();
});

test('defuse 3D parity shots: the lid, the cap, a page turn, the lever, the edges', async ({
  browser,
}) => {
  test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 600_000));
  const look: Look = {
    viewport: { width: 844, height: 390 },
    colorScheme: 'dark',
    setup: localArt,
    touch: true,
  };
  const out = `${DIR}/parity`;
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], look)) as [Page, Page];
  ana.on('pageerror', (e) => console.log(JSON.stringify({ pageerror: String(e) })));
  ana.on('console', (m) => {
    if (m.type() === 'error') console.log(JSON.stringify({ console: m.text() }));
  });
  await settings(ana);
  await ana.getByTestId('set-modules').selectOption('11');
  await ana.getByTestId('set-needy').click();
  await ana.getByTestId('start').click();
  await ready(ana);
  await ana.waitForTimeout(6500);
  const shot = async (name: string, wait = 0) => {
    if (wait) await ana.waitForTimeout(wait);
    await ana.screenshot({ path: `${out}/${name}.png` });
    const b = await call(ana, 'bomb');
    console.log(JSON.stringify({ shot: name, end: b?.end ?? null, info: await call(ana, 'info') }));
  };
  const kinds = (await call(ana, 'bomb')).modules;
  const of = (kind: string, face?: number) =>
    kinds.find(
      (m) => m.kind === kind && (face === undefined || (m as { face?: number }).face === face),
    );
  await call(ana, 'pickUp');
  await ana.waitForTimeout(600);
  // The Button: the lid opening as it is looked at, then the cap held down.
  const button = of('button');
  if (button) {
    await call(ana, 'focus', button.id);
    await shot('50-lid-opening', 150);
    await shot('51-lid-open', 600);
    await call(ana, 'press', await call(ana, 'partFor', button.id, { op: 'down' }));
    await shot('52-cap-held', 200);
    await call(ana, 'release');
    await shot('53-cap-released', 300);
    await call(ana, 'back');
    await ana.waitForTimeout(400);
  }
  // A Wire Sequence page turn: the solver's cuts, then the down key, shot as the page goes.
  const seq = of('wire-sequence', 0);
  if (seq) {
    await call(ana, 'focus', seq.id);
    await ana.waitForTimeout(500);
    await shot('60-sequence-page');
    for (let i = 0; i < 6; i++) {
      // The solver on this module alone.
      const b = (await call(ana, 'bomb')) as unknown as { modules: { id: string }[] };
      const now = await ana.evaluate(() => Date.now());
      const mv = nextMove(
        { ...b, modules: b.modules.filter((m) => m.id === seq.id) } as never,
        now,
      ) as { module: string; op: Op } | 'wait' | null;
      if (!mv || mv === 'wait' || mv.module !== seq.id) break;
      if (mv.op.op !== 'next') {
        await call(ana, 'press', await call(ana, 'partFor', seq.id, mv.op));
        await call(ana, 'release');
      } else {
        // The browser's own frames (a screenshot each is slower than the 1.4 s turn).
        const cdp = await ana.context().newCDPSession(ana);
        const frames: { t: number; data: string }[] = [];
        cdp.on(
          'Page.screencastFrame',
          (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
            frames.push({ t: f.metadata.timestamp ?? 0, data: f.data });
            void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
          },
        );
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80 });
        await ana.waitForTimeout(300);
        await call(ana, 'press', await call(ana, 'partFor', seq.id, mv.op));
        await call(ana, 'release');
        await ana.waitForTimeout(2500);
        await cdp.send('Page.stopScreencast');
        const t0 = frames[0]?.t ?? 0;
        mkdirSync(`${out}/turn`, { recursive: true });
        frames.forEach((f, i) =>
          writeFileSync(
            `${out}/turn/${String(i).padStart(3, '0')}-${Math.round((f.t - t0) * 1000)}ms.jpg`,
            Buffer.from(f.data, 'base64'),
          ),
        );
        console.log(JSON.stringify({ turnFrames: frames.length }));
        break;
      }
      await ana.waitForTimeout(400);
    }
    await call(ana, 'back');
    await ana.waitForTimeout(400);
  }
  // The capacitor's lever at rest and held.
  const cap = of('capacitor');
  if (cap) {
    const face = (cap as { face?: number }).face ?? 0;
    if (face === 1) {
      await call(ana, 'turn', 'right');
      await call(ana, 'turn', 'right');
      await ana.waitForTimeout(800);
    }
    await call(ana, 'focus', cap.id);
    await shot('70-lever-rest', 600);
    await call(ana, 'press', await call(ana, 'partFor', cap.id, { op: 'down' }));
    await shot('71-lever-held', 900);
    await call(ana, 'release');
    await shot('72-lever-back', 400);
    await call(ana, 'back');
    await call(ana, 'back');
    await call(ana, 'pickUp');
    await ana.waitForTimeout(600);
  }
  // The edges: ▴ from the front shows the bottom; ▾ the top, from the front and from the back.
  if ((await call(ana, 'pose'))?.face === 1) {
    await call(ana, 'turn', 'right');
    await call(ana, 'turn', 'right');
    await ana.waitForTimeout(800);
  }
  await call(ana, 'turn', 'up');
  await shot('80-front-up-arrow-bottom', 900);
  await call(ana, 'turn', 'down');
  await call(ana, 'turn', 'down');
  await shot('81-front-down-arrow-top', 900);
  await call(ana, 'turn', 'up');
  await call(ana, 'turn', 'right');
  await call(ana, 'turn', 'right');
  await ana.waitForTimeout(800);
  await call(ana, 'turn', 'down');
  await shot('82-back-down-arrow-top', 900);
  await ben.close();
});
