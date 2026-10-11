import { WORD_KINDS } from '@vt/protocol';
import { describe, expect, it } from 'vitest';
import { kindsWithWords, knownWordKinds, wordKindLabel } from './word-kinds.ts';

describe('word kinds per game', () => {
  it('offers only the kinds each game reports, default first', () => {
    expect(knownWordKinds('codenames')).toEqual(['clue', 'guess', 'assassin']);
    expect(knownWordKinds('enigma')).toEqual(['clue']);
    expect(knownWordKinds('echo')).toEqual(['clue', 'guess', 'cancelled']);
    expect(knownWordKinds('reverie')).toEqual(['story']);
    expect(knownWordKinds('hoodwink')).toEqual(['guess']);
    expect(knownWordKinds('royal-post')).toEqual([]);
    expect(knownWordKinds('masquerade')).toEqual(['clue', 'guess']);
    expect(knownWordKinds('masquerade-originals')).toEqual(['clue', 'guess']);
    expect(knownWordKinds('mystery')).toBeNull();
  });

  it('labels kinds in each game’s own words', () => {
    expect(wordKindLabel('hoodwink', 'guess')).toBe('Lies');
    expect(wordKindLabel('masquerade', 'clue')).toBe('Locations');
    expect(wordKindLabel('codenames', 'guess')).toBe('Guesses');
    expect(wordKindLabel('reverie', 'story')).toBe('Story clues');
  });

  it('falls back to the kinds with data for unknown games', () => {
    expect(kindsWithWords({ clue: 0, story: 3, guess: 1 })).toEqual(['guess', 'story']);
    expect(kindsWithWords({})).toEqual(WORD_KINDS);
  });
});
