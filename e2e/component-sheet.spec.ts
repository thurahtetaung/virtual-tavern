import { readFileSync } from 'node:fs';
import { type Page, expect } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, ownLoginLimit } from './credentials.ts';
import { test } from './fixtures.ts';

/*
 * The component sheet (`/tavern-keeper/components`): every shared part in every state, on a phone
 * and a desktop, light and dark. In a real browser it checks what the unit test (packages/ui
 * src/sheet.test.tsx) works out from the classes: every text at AA against what is painted under
 * it, every control at least 44 × 44 px, nothing wider than the phone. It saves a full-page
 * screenshot of each, and `SHEET_COVER=<webp>` adds a game card with that cover.
 */

const SIZES = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 900 },
} as const;

const COVER = process.env.SHEET_COVER;

/** Measured in the page: text contrast misses and controls under 44 px, inside the sheet. */
function measure() {
  const sheet = document.querySelector('[data-testid="component-sheet"]')!;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const cx = canvas.getContext('2d', { willReadFrequently: true })!;
  const parse = (c: string): number[] | null => {
    if (!c || c === 'transparent') return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000';
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  };
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  const over = (top: number[], bottom: number[]) =>
    [0, 1, 2].map((i) => top[i]! * top[3]! + bottom[i]! * (1 - top[3]!)).concat(1);
  const bg = (el: Element) => {
    const layers: number[][] = [];
    for (let a: Element | null = el; a; a = a.parentElement) {
      const c = parse(getComputedStyle(a).backgroundColor);
      if (c && c[3]! > 0) {
        layers.push(c);
        if (c[3]! >= 1) break;
      }
    }
    let acc = [255, 255, 255, 1];
    for (const l of layers.reverse()) acc = over(l, acc);
    return acc;
  };
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 1 &&
      r.height > 1 &&
      !el.closest('[aria-hidden="true"], details:not([open]) > :not(summary)')
    );
  };

  const contrast: string[] = [];
  let texts = 0;
  for (const el of sheet.querySelectorAll('*')) {
    if (!shown(el) || el.closest('select')) continue;
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
      .trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const cs = getComputedStyle(el);
    const back = bg(el);
    let fg = parse(cs.color)!;
    if (fg[3]! < 1) fg = over(fg, back);
    const large = parseFloat(cs.fontSize) >= 24;
    const r = ratio(fg, back);
    texts++;
    if (r < (large ? 3 : 4.5)) {
      const where = el.closest('[data-specimen]')?.getAttribute('data-specimen');
      contrast.push(`${where}: "${text.slice(0, 24)}" ${r.toFixed(2)}`);
    }
  }

  const small: string[] = [];
  const controls = sheet.querySelectorAll(
    'button, a[href], input:not([type="hidden"]), select, summary, [role="switch"], [role="tab"]',
  );
  for (const el of controls) {
    if (!shown(el)) continue;
    const box =
      el.matches('input[type="checkbox"], input[type="radio"]') && el.closest('label')
        ? el.closest('label')!
        : el;
    const r = box.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) {
      const where = el.closest('[data-specimen]')?.getAttribute('data-specimen');
      small.push(
        `${where}: <${el.tagName.toLowerCase()}> ${r.width.toFixed(0)}×${r.height.toFixed(0)}`,
      );
    }
  }
  return {
    contrast,
    texts,
    small,
    controls: controls.length,
    scrollWidth: document.documentElement.scrollWidth,
  };
}

async function openSheet(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('vt.theme', t), theme);
  if (COVER) {
    const cover = readFileSync(COVER);
    await page.route('**/sheet-cover.webp', (route) =>
      route.fulfill({ body: cover, contentType: 'image/webp' }),
    );
  }
  await page.goto(`/tavern-keeper/components${COVER ? '?cover=1' : ''}`);
  await expect(page.getByTestId('component-sheet')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  if (COVER) {
    // The cover loads lazily: bring it on screen and wait until it has painted.
    const cover = page.locator('[data-specimen="game-card/cover"] img');
    await cover.scrollIntoViewIfNeeded();
    await expect
      .poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  // Still pictures: no transitions or pulses mid-capture.
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none!important;transition:none!important}',
  });
}

for (const [size, viewport] of Object.entries(SIZES))
  for (const theme of ['light', 'dark'] as const)
    test(`component sheet (${size}, ${theme})`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await ownLoginLimit(page);
      const login = await page.request.post('/api/admin/login', {
        data: { password: TEST_ADMIN_PASSWORD },
      });
      expect(login.ok()).toBe(true);
      await openSheet(page, theme);

      const m = await page.evaluate(measure);
      expect(m.texts).toBeGreaterThan(100);
      expect(m.controls).toBeGreaterThan(60);
      expect(m.contrast).toEqual([]);
      expect(m.small).toEqual([]);
      expect(m.scrollWidth).toBeLessThanOrEqual(viewport.width);

      await page.screenshot({
        path: info.outputPath(`components--${size}-${theme}.png`),
        fullPage: true,
      });
    });
