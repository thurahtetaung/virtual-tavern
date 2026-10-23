import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PILLARS } from '../logic/cards.ts';
import { seance } from '../logic/game.ts';
import { HOST, guessAll, playHour, readyAll, sendAll, startedGame } from '../logic/test-utils.ts';
import { contentFor } from './assets.ts';
import { CandidatesRow, TableOverview, missedBy } from './Candidates.tsx';

const content = contentFor('unavailable');

describe('the ghost sees every candidate on the table', () => {
  it('the ghost’s view holds the whole table, the same as everyone’s', () => {
    const h = startedGame(4);
    const ghost = seance.view(h.state, HOST).game!;
    for (const pillar of PILLARS) expect(ghost.table[pillar]).toEqual(h.game().table[pillar]);
    expect(seance.view(h.state, 'ana').game!.table).toEqual(ghost.table);
    expect(ghost.table.suspect.length).toBeGreaterThan(1);
  });

  it('a psychic’s row: every candidate, the target lit, the guess and past misses marked', () => {
    const h = startedGame(4);
    sendAll(h);
    guessAll(h, []);
    readyAll(h);
    h.act({ type: 'continue' }, HOST);
    sendAll(h);
    const ana = h.psychic('ana');
    const wrong = h.game().table.suspect.filter((n) => n !== ana.targets[0]);
    h.act({ type: 'intuition', card: wrong.at(-1)! }, 'ana');
    const g = seance.view(h.state, HOST).game!;
    const p = g.psychics.find((x) => x.id === 'ana')!;
    expect(missedBy(g, p)).toHaveLength(1);
    const page = renderToStaticMarkup(
      <CandidatesRow g={g} pillar="suspect" content={content} one={p} label="Ana’s row" />,
    );
    expect(page.match(/data-card="suspect-\d+"/g)).toHaveLength(g.table.suspect.length);
    expect(page).toContain(`aria-label="Suspect ${p.targets![0]} (Ana’s target)"`);
    expect(page).toMatch(new RegExp(`aria-label="Suspect ${wrong.at(-1)} \\(Ana’s guess`));
    expect(page).toMatch(
      new RegExp(`aria-label="Suspect ${missedBy(g, p)[0]} \\([^"]*Ana guessed it wrong before`),
    );
    // Looking only: no pick buttons on the ghost's candidates.
    expect(page).not.toContain('data-pick');
  });

  it('the desktop overview shows each pillar in use once, with every searcher marked', () => {
    const h = startedGame(5, { third: 'story' });
    playHour(h, ['ana']);
    const g = seance.view(h.state, HOST).game!;
    const page = renderToStaticMarkup(<TableOverview g={g} content={content} />);
    expect(page).toContain('Suspects on the table');
    expect(page).toContain('Places on the table');
    expect(page.match(/aria-label="Suspects on the table"/g)).toHaveLength(1);
    for (const p of g.psychics.filter((x) => x.step === 0))
      expect(page).toMatch(new RegExp(`aria-label="Suspect ${p.targets![0]} \\([^"]*${p.name}`));
  });

  it('psychics see no candidates row of the ghost kind (their table has no targets)', () => {
    const h = startedGame(4);
    const g = seance.view(h.state, 'ana').game!;
    expect(renderToStaticMarkup(<TableOverview g={g} content={content} />)).toBe('');
  });
});
