import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PEEK_START, Peek, SLIDE_TO_OPEN_PX, peekReducer } from './peek.tsx';

const SECRET = 'SECRET-ROLE-MERLIN';
const html = (props: Partial<Parameters<typeof Peek>[0]> = {}) =>
  renderToStaticMarkup(
    <Peek what="your role" cover={<span>CARD-BACK</span>} {...props}>
      <p>{SECRET}</p>
    </Peek>,
  );

describe('Peek', () => {
  it('never renders the hidden content while covered', () => {
    const page = html();
    expect(page).not.toContain(SECRET);
    expect(page).toContain('CARD-BACK');
  });

  it('labels both ways in: hold the cover, or Show (for keyboards and screen readers)', () => {
    const page = html();
    expect(page).toContain('aria-label="Hold to see your role"');
    expect(page).toMatch(/<button[^>]*aria-expanded="false"[^>]*>👁️ Show your role<\/button>/);
    expect(page).toContain('aria-live="polite"');
  });

  it('shows the content, and only Hide, when open', () => {
    const page = html({ open: true });
    expect(page).toContain(SECRET);
    expect(page).not.toContain('CARD-BACK');
    expect(page).not.toContain('Hold to see');
    expect(page).toMatch(/aria-expanded="true"[^>]*>🙈 Hide your role</);
  });

  it('stays covered while blocked, and says why', () => {
    const page = html({ open: true, blocked: 'Hidden while your phone lies flat.' });
    expect(page).not.toContain(SECRET);
    expect(page).toContain('Hidden while your phone lies flat.');
  });

  it('inline, keeps the toggle short on screen but named in full', () => {
    const page = html({ inline: true });
    expect(page).toMatch(/<button[^>]*aria-label="Show your role"[^>]*>👁️ Show<\/button>/);
    expect(page).toContain('whitespace-nowrap');
    expect(html({ inline: true, open: true })).toMatch(
      /<button[^>]*aria-label="Hide your role"[^>]*>🙈 Hide<\/button>/,
    );
  });

  it('has a default cover that says how to look', () => {
    expect(html({ cover: undefined })).toContain('Hold to see your role');
    expect(html({ cover: undefined, slide: true })).toContain(
      'Slide up, or hold, to see your role',
    );
  });
});

describe('peekReducer', () => {
  it('shows only while held', () => {
    const held = peekReducer(PEEK_START, { type: 'press', y: 300 });
    expect(held.held).toBe(true);
    expect(peekReducer(held, { type: 'release', slide: false })).toEqual(PEEK_START);
  });

  it('keeps showing after a long enough slide up, when sliding is on', () => {
    let s = peekReducer(PEEK_START, { type: 'press', y: 300 });
    s = peekReducer(s, { type: 'move', y: 300 - SLIDE_TO_OPEN_PX - 1 });
    expect(peekReducer(s, { type: 'release', slide: true }).open).toBe(true);
    expect(peekReducer(s, { type: 'release', slide: false }).open).toBe(false);
    const short = peekReducer(peekReducer(PEEK_START, { type: 'press', y: 300 }), {
      type: 'move',
      y: 290,
    });
    expect(peekReducer(short, { type: 'release', slide: true }).open).toBe(false);
  });

  it('never slides downwards, and ignores moves without a press', () => {
    const s = peekReducer(PEEK_START, { type: 'press', y: 300 });
    expect(peekReducer(s, { type: 'move', y: 400 }).drag).toBe(0);
    expect(peekReducer(PEEK_START, { type: 'move', y: 0 })).toBe(PEEK_START);
  });

  it('toggles and sets the Show state', () => {
    const open = peekReducer(PEEK_START, { type: 'toggle' });
    expect(open.open).toBe(true);
    expect(peekReducer(open, { type: 'toggle' }).open).toBe(false);
    expect(peekReducer(open, { type: 'set', open: true })).toBe(open);
    expect(peekReducer(open, { type: 'set', open: false }).open).toBe(false);
  });

  it('a release without a press changes nothing', () => {
    expect(peekReducer(PEEK_START, { type: 'release', slide: true })).toBe(PEEK_START);
  });
});
