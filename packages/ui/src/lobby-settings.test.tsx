import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LobbySettings } from './lobby-settings.tsx';
import { timersLine } from './timer-settings.tsx';
import { wordListsLine } from './word-list-picker.tsx';

const html = (editable: boolean) =>
  renderToStaticMarkup(
    <LobbySettings editable={editable} summary={['2 min turns', false, 'strict']}>
      <p>FULL-SETTINGS</p>
    </LobbySettings>,
  );

describe('LobbySettings', () => {
  it('stays open for the host', () => {
    const page = html(true);
    expect(page).toContain('FULL-SETTINGS');
    expect(page).not.toContain('<details');
    expect(page).not.toContain('2 min turns');
  });

  it('gives guests a closed summary line that opens to the settings', () => {
    const page = html(false);
    expect(page).toMatch(/<details class="[^"]*">/); // no `open` attribute
    expect(page).toMatch(/<summary[^>]*>.*Settings.*2 min turns · strict.*<\/summary>/);
    expect(page).toContain('FULL-SETTINGS');
    expect(page).toContain('Only the host can change these.');
  });
});

describe('summary lines', () => {
  it('names the timers, or says there are none', () => {
    expect(timersLine({ clueSeconds: 60, guessSeconds: 90, timerMode: 'strict' })).toBe(
      'clues 1 min, guesses 90 s, strict',
    );
    expect(timersLine({ clueSeconds: 45, guessSeconds: 90 }, { clue: 'turns', guess: null })).toBe(
      'turns 45 s, reminder only',
    );
    expect(timersLine({ clueSeconds: null, guessSeconds: null })).toBe('no time limits');
  });

  it('names the first word list and counts the rest', () => {
    const lists = ['Starter', 'Animals', 'Food'].map((name, i) => ({
      id: String(i),
      name,
      wordCount: 100,
    }));
    expect(wordListsLine(['0'], lists)).toBe('Starter');
    expect(wordListsLine(['1', '2'], lists)).toBe('Animals +1');
    expect(wordListsLine([], lists)).toBe('no word list');
  });
});
