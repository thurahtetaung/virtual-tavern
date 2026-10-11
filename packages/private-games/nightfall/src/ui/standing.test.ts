import { describe, expect, it } from 'vitest';
import { ARTIFACTS } from '../logic/roles.ts';
import { table } from '../logic/test-utils.ts';
import { deckFor } from './assets.ts';
import { standingOf } from './standing.ts';

const deck = deckFor(null, (id) => ARTIFACTS[id].summary);

describe('where you stand now', () => {
  it('follows the Robber to the card he took, worded for the setup', () => {
    const h = table({ players: ['robber', 'seer', 'vampire', 'villager'] });
    h.toStep('robber');
    h.night('A', { players: ['B'] });
    h.dawn();
    const st = standingOf(h.view('A'), deck)!;
    expect(st).toMatchObject({ started: 'robber', now: 'seer' });
    expect(st.meaning[0]).toMatch(/^As the Seer: Wins with the village: at least one Vampire dies/);
    expect(st.meaning.at(-1)).toMatch(/may have moved your card/);
  });

  it('knows the Drunk can’t know his card', () => {
    const h = table({ players: ['drunk', 'werewolf', 'villager'] });
    h.toStep('drunk');
    h.night('A', { center: [1] });
    h.dawn();
    expect(standingOf(h.view('A'), deck)).toMatchObject({ now: null });
  });

  it('puts the Mark of the Vampire first, whatever the card', () => {
    const h = table({ players: ['vampire', 'cupid', 'villager', 'villager'] });
    h.toStep('vampires');
    h.night('A', { players: ['C'] });
    h.dawn();
    const st = standingOf(h.view('C'), deck)!;
    expect(st.mark).toEqual({ mark: 'vampire', doppel: false });
    expect(st.meaning[0]).toMatch(/^With the Mark of the Vampire you are a Vampire/);
    // The vampire who gave it is warned it may have been replaced.
    expect(standingOf(h.view('A'), deck)!.meaning.join(' ')).toMatch(/may have been replaced/);
  });

  it('has nothing to say to someone watching', () => {
    const h = table({ players: ['villager', 'werewolf', 'villager'] });
    expect(standingOf(h.view(null), deck)).toBeNull();
  });
});
