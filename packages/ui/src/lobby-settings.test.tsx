import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LobbySettings } from './lobby-settings.tsx';
import { fitSummary, summaryText } from './summary-fit.ts';
import { summaryFits } from './summary-width.ts';
import { Switch } from './switch.tsx';
import { timersLine } from './timer-settings.tsx';
import { wordListsLine } from './word-list-picker.tsx';

const html = (editable: boolean) =>
  renderToStaticMarkup(
    <LobbySettings editable={editable} summary={['2 min turns', false, 'strict']}>
      <p>FULL-SETTINGS</p>
    </LobbySettings>,
  );

describe('LobbySettings', () => {
  it('folds for the host too where the screen is unknown (a phone), without the host-only note', () => {
    const page = html(true);
    expect(page).toMatch(/<details data-testid="host-settings" class="[^"]*">/); // no `open`
    expect(page).toMatch(/<summary[^>]*>.*Settings.*2 min turns · strict.*<\/summary>/);
    expect(page).toContain('FULL-SETTINGS');
    expect(page).not.toContain('Only the host can change these.');
  });

  it('gives guests a closed summary line that opens to the settings', () => {
    const page = html(false);
    expect(page).toMatch(/<details class="[^"]*">/); // no `open` attribute
    expect(page).toMatch(/<summary[^>]*>.*Settings.*2 min turns · strict.*<\/summary>/);
    expect(page).toContain('FULL-SETTINGS');
    expect(page).toContain('Only the host can change these.');
  });
});

describe('Switch', () => {
  const sw = (editable: boolean, on = true) =>
    renderToStaticMarkup(
      <Switch on={on} editable={editable} title="Strict" help="At zero" onChange={() => {}} />,
    );

  it('looks like a control for the host', () => {
    const page = sw(true);
    expect(page).toContain('aria-checked="true"');
    expect(page).not.toContain('aria-disabled');
    expect(page).toContain('ring-accent');
    expect(page).toContain('bg-accent');
  });

  it('is muted and marked read-only for guests, on or off', () => {
    for (const on of [true, false]) {
      const page = sw(false, on);
      expect(page).toContain(`aria-checked="${on}"`);
      expect(page).toContain('aria-disabled="true"');
      expect(page).not.toContain('disabled=""');
      expect(page).not.toMatch(/accent|hover:/);
      expect(page).toContain('cursor-default');
    }
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

  it('names a single word list and counts several', () => {
    const lists = ['Starter', 'Animals', 'Food'].map((name, i) => ({
      id: String(i),
      name,
      wordCount: 100,
    }));
    expect(wordListsLine(['0'], lists)).toBe('Starter');
    expect(wordListsLine(['1', '2'], lists)).toBe('2 word lists');
    expect(wordListsLine([], lists)).toBe('no word list');
  });

  it('shows one count on a phone, never the lists\' own next to "+N more"', () => {
    const lists = ['City', 'Animals', 'Food', 'Films', 'Sport', 'Music'].map((name, i) => ({
      id: String(i),
      name,
      wordCount: 100,
    }));
    const ids = lists.map((l) => l.id);
    const timers = timersLine({ clueSeconds: 60, guessSeconds: 90, timerMode: 'strict' });
    // Enigma's and Echo's summaries, the live check's long case at 360 and 390 px.
    for (const parts of [
      ['Simultaneous', wordListsLine(ids, lists), timers],
      ['13 cards', wordListsLine(ids, lists), timers],
    ])
      for (const width of [360, 390]) {
        const text = summaryText(
          parts,
          fitSummary(parts, (t) => summaryFits(t, 'Settings', width)),
        );
        expect(text).toContain('6 word lists');
        expect(text.match(/\+/g)?.length ?? 0).toBeLessThanOrEqual(1);
      }
  });
});
