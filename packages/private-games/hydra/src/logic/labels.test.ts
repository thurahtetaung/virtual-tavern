import { describe, expect, it } from 'vitest';
import { placeholderWord } from './labels.ts';

describe('recap and stats placeholders', () => {
  it('read in Hydra’s own words without a manifest', () => {
    const word = placeholderWord(null);
    expect(word('blue')).toBe('Loyalist');
    expect(word('red-policies')).toBe('Conspirator policies');
    expect(word('blue-policies')).toBe('Loyalist policies');
    expect(word('power-peek')).toBe('Policy peek');
    expect(word('power-execute')).toBe('Execution');
    expect(word('chancellor')).toBe('Chancellor');
    expect(word('Veto')).toBe('Veto');
    expect(word('leader')).toBe('the Usurper');
    expect(word('title')).toBeUndefined();
    expect(word('nonsense')).toBeUndefined();
  });

  it('read in an edition’s words, powers included', () => {
    const word = placeholderWord({
      names: {
        blue: 'Glow',
        blues: 'Glows',
        red: 'Dusk',
        policy: 'edict',
        policies: 'edicts',
        bluePolicy: 'Sunlit',
        redPolicy: 'Shadowed',
        veto: 'quench',
      },
      powers: { investigate: { name: 'Scry' }, execute: { name: 'Snuff' } },
    });
    expect(word('blue-policies')).toBe('Sunlit edicts');
    expect(word('red-policies')).toBe('Shadowed edicts');
    expect(word('bluePolicy')).toBe('Sunlit');
    expect(word('blue')).toBe('Glow');
    expect(word('power-investigate')).toBe('Scry');
    expect(word('power-execute')).toBe('Snuff');
    // A power the manifest leaves out keeps Hydra's name, in the edition's words.
    expect(word('power-peek')).toBe('Edict peek');
    expect(word('Veto')).toBe('Quench');
  });
});
