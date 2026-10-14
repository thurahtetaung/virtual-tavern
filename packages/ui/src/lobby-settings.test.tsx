import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LobbySettings } from './lobby-settings.tsx';

const html = (editable: boolean) =>
  renderToStaticMarkup(
    <LobbySettings editable={editable} summary="2 min turns · strict">
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
  });
});
