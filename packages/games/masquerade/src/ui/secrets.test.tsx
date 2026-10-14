import type { GameRoomInfo } from '@vt/game-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { masquerade } from '../logic/index.ts';
import { FOUR, HOST, allReady, rig, startedGame } from '../logic/test-utils.ts';
import { publicDisplay } from './display.ts';
import { MasqueradeBoard } from './MasqueradeBoard.tsx';
import { Peek } from './peek.tsx';

// Cy is the spy at the Gym; Ana opens the asking, so Ben (a local) and Cy are alike in every other way.
const table = () => rig(startedGame(FOUR), { spies: ['cy'], location: 'gym', starter: 'ana' });

const room = (you: string): GameRoomInfo => ({
  you,
  hostId: HOST,
  isHost: you === HOST,
  players: FOUR.map((id) => ({ id, name: id.toUpperCase(), connected: true })),
  clockOffset: 0,
  wordLists: [],
});

const NAMES: Record<string, string> = { ben: 'BEN', cy: 'CY' };

/** The board as `you` sees it, with their own name and "(you)" marks written the same for anyone. */
function board(h: ReturnType<typeof table>, you: string) {
  const html = renderToStaticMarkup(
    <MasqueradeBoard
      view={masquerade.view(h.state, you)}
      room={room(you)}
      act={() => Promise.resolve(true)}
      showGuide={() => {}}
      display={publicDisplay}
    />,
  );
  // The two viewers swap places in the seat lists, which is not a secret: name them alike.
  return html
    .replaceAll(NAMES.ben!, 'P')
    .replaceAll(NAMES.cy!, 'P')
    .replace(/<span[^>]*>\(you\)<\/span>/g, '')
    .replaceAll(' (you)', '');
}

/** Words that would give away the location or who the spy is. */
const SECRETS = [
  'Gym',
  'You’re the spy',
  'The location',
  'Coaching',
  'Here',
  'Safe questions',
  'Fishing questions',
  'Bluff tips',
  'For Gym',
  '🎭 Spy',
  '📍 Local',
  'spy-guess-rule',
];

describe('Masquerade keeps the card behind the peek', () => {
  it.each([
    ['talk', (h: ReturnType<typeof table>) => h],
    ['vote', (h: ReturnType<typeof table>) => allReady(h)],
  ])('renders the same page for the spy and a local while talking and voting (%s)', (_, at) => {
    const h = at(table());
    const spy = board(h, 'cy');
    const local = board(h, 'ben');
    // Gym is in the board's list of places for everyone; it must not be marked, said or ringed.
    const marked = (page: string) => page.replace(/aria-label="(Star )?Gym"/g, '');
    expect(spy).toBe(local);
    for (const s of SECRETS) {
      if (s === 'Gym') {
        expect(marked(spy).match(/>Gym</g)).toHaveLength(1); // the board's tile, unmarked
        continue;
      }
      expect(spy, s).not.toContain(s);
    }
  });

  it('has a hold and a Show button for the card and for the ideas', () => {
    const page = board(table(), 'ben');
    expect(page).toContain('aria-label="Hold to see your card"');
    expect(page).toMatch(/aria-expanded="false"[^>]*>👁️ Show your card</);
    expect(page).toContain('aria-label="Hold to see ideas for your card"');
    expect(page).toMatch(/aria-expanded="false"[^>]*>👁️ Show ideas for your card</);
  });

  it('a watcher gets no peek, and the top bar says only that they watch', () => {
    const h = table();
    const page = renderToStaticMarkup(
      <MasqueradeBoard
        view={masquerade.view(h.state, 'zed')}
        room={room('zed')}
        act={() => Promise.resolve(true)}
        showGuide={() => {}}
        display={publicDisplay}
      />,
    );
    expect(page).toContain('👀 Watching');
    expect(page).not.toContain('Hold to see');
    expect(page).not.toContain('You’re the spy');
    expect(page).not.toContain('Here');
  });
});

describe('Peek (local stand-in)', () => {
  it('never renders the content while covered, and uses the cover given', () => {
    const page = renderToStaticMarkup(
      <Peek what="your card" cover={<span>CARD-BACK</span>}>
        <p>SECRET</p>
      </Peek>,
    );
    expect(page).not.toContain('SECRET');
    expect(page).toContain('CARD-BACK');
  });
});
