import { describe, expect, it } from 'vitest';
import { containsWord, sameAnswer, sameClue } from './matching.ts';

describe('sameAnswer', () => {
  it('ignores case, accents, spacing, punctuation and plurals', () => {
    for (const [guess, answer] of [
      ['cats', 'CAT'],
      ['Café', 'cafe'],
      ['spiderman', 'Spider-Man'],
      ['MONSTERSINC', 'Monsters Inc'],
      ['monsters-inc', 'Monsters Inc'],
      ['wifi', 'Wi-Fi'],
      ['coca cola', 'Coca-Cola'],
      ['the moon', 'Moon'],
      ['ice creams', 'Ice cream'],
      ['berries', 'berry'],
      ['pixies', 'pixie'],
      ['zulus', 'Zulu'],
      ['menus', 'menu'],
      ['kiwis', 'kiwi'],
      ['viruses', 'virus'],
      ['lenses', 'lens'],
    ]) {
      expect(sameAnswer(guess!, answer!), `${guess} = ${answer}`).toBe(true);
    }
  });

  it('knows irregular plurals and US/UK spellings', () => {
    for (const [guess, answer] of [
      ['mice', 'MOUSE'],
      ['mouse', 'mice'],
      ['men', 'man'],
      ['children', 'child'],
      ['wolves', 'wolf'],
      ['color', 'COLOUR'],
      ['colours', 'color'],
      ['gray', 'grey'],
      ['mom', 'mum'],
      ['center', 'centre'],
      ['email', 'e-mail'],
      ['realize', 'realise'],
    ]) {
      expect(sameAnswer(guess!, answer!), `${guess} = ${answer}`).toBe(true);
    }
  });

  it('never stretches a guess into a longer word', () => {
    for (const [guess, answer] of [
      ['numb', 'NUMBER'],
      ['corn', 'CORNER'],
      ['box', 'BOXER'],
      ['let', 'letter'],
      ['but', 'butter'],
      ['flow', 'flower'],
      ['hat', 'hate'],
      ['run', 'running'],
      ['monsters', 'Monsters Inc'],
      ['prince', 'PRINCESS'],
      ['japan', 'JAPANESE'],
      ['new', 'NEWS'],
      ['mar', 'MARS'],
    ]) {
      expect(sameAnswer(guess!, answer!), `${guess} ≠ ${answer}`).toBe(false);
    }
  });
});

describe('sameClue', () => {
  it('matches plurals, spellings and simple verb endings', () => {
    for (const [a, b] of [
      ['Cat', 'cats'],
      ['run', 'running'],
      ['stop', 'stopped'],
      ['play', 'played'],
      ['bake', 'baking'],
      ['hate', 'hated'],
      ['carry', 'carried'],
      ['sing', 'singing'],
      ['ice-cream', 'icecream'],
      ['mice', 'mouse'],
      ['colour', 'color'],
      ['Zulu', 'zulus'],
    ]) {
      expect(sameClue(a!, b!), `${a} = ${b}`).toBe(true);
      expect(sameClue(b!, a!), `${b} = ${a}`).toBe(true);
    }
  });

  it('matches word-family endings', () => {
    for (const [a, b] of [
      ['Prince', 'Princess'],
      ['actor', 'actress'],
      ['waiter', 'waitress'],
      ['host', 'hostess'],
      ['lion', 'lionesses'],
      ['Japan', 'Japanese'],
      ['China', 'chinese'],
      ['king', 'kingdom'],
      ['free', 'freedom'],
      ['sun', 'sunny'],
      ['salt', 'salty'],
      ['smoke', 'smoky'],
      ['swim', 'swimmer'],
    ]) {
      expect(sameClue(a!, b!), `${a} = ${b}`).toBe(true);
      expect(sameClue(b!, a!), `${b} = ${a}`).toBe(true);
    }
  });

  it('never reads a word as a plural or verb form of a shorter, unrelated one', () => {
    for (const [a, b] of [
      ['news', 'new'],
      ['Mars', 'mar'],
      ['lens', 'len'],
      ['pied', 'pie'],
      ['singed', 'sing'],
      ['ran', 'random'],
      ['car', 'carry'],
      ['cook', 'cookie'],
      ['gene', 'genie'],
    ]) {
      expect(sameClue(a!, b!), `${a} ≠ ${b}`).toBe(false);
      expect(sameClue(b!, a!), `${b} ≠ ${a}`).toBe(false);
    }
  });

  it('keeps words that merely start alike apart', () => {
    for (const [a, b] of [
      ['corn', 'corner'],
      ['numb', 'number'],
      ['box', 'boxer'],
      ['hat', 'hate'],
      ['hat', 'hated'],
      ['bus', 'busy'],
      ['sing', 'song'],
      ['sing', 'singer'],
      ['cat', 'scatter'],
      ['red', 'reed'],
    ]) {
      expect(sameClue(a!, b!), `${a} ≠ ${b}`).toBe(false);
    }
  });
});

describe('containsWord', () => {
  it('refuses forms, prefixes, suffixes and compounds of the word, both ways', () => {
    for (const [clue, word] of [
      ['cats', 'CAT'],
      ['sunny', 'SUN'],
      ['sunflower', 'SUN'],
      ['sun', 'SUNFLOWER'],
      ['penguin', 'PEN'],
      ['pen', 'PENGUIN'],
      ['salty', 'salt'],
      ['player', 'PLAY'],
      ['baker', 'bake'],
      ['react', 'act'],
      ['unhappily', 'happy'],
      ['snowman', 'snow'],
      ['firework', 'fire'],
      ['children', 'CHILD'],
      ['mice', 'MOUSE'],
      ['color', 'COLOUR'],
      ['Café', 'cafe'],
      ['Prince', 'PRINCESS'],
      ['Princess', 'PRINCE'],
      ['kingdom', 'KING'],
      ['king', 'KINGDOM'],
      ['Japanese', 'JAPAN'],
      ['actress', 'ACTOR'],
      ['lioness', 'THE LION KING'],
    ]) {
      expect(containsWord(clue!, word!), `${clue} gives away ${word}`).toBe(true);
    }
  });

  it('refuses a word of a multi-word answer, or the answer run together', () => {
    for (const clue of ['Monsters', 'monster', 'Inc', 'MonstersInc', 'Monsters-Inc']) {
      expect(containsWord(clue, 'MONSTERS INC'), clue).toBe(true);
    }
    for (const clue of ['ice', 'cream', 'icecream', 'Ice-cream']) {
      expect(containsWord(clue, 'ICE CREAM'), clue).toBe(true);
    }
    expect(containsWord('the', 'THE MOON')).toBe(false);
    expect(containsWord('and', 'SALT AND PEPPER')).toBe(false);
  });

  it('allows words that only hide the word inside them', () => {
    for (const [clue, word] of [
      ['scatter', 'CAT'],
      ['police', 'ICE'],
      ['nice', 'ICE'],
      ['phone', 'ONE'],
      ['money', 'ONE'],
      ['heart', 'ART'],
      ['party', 'ART'],
      ['scar', 'CAR'],
      ['carpet', 'CAR'],
      ['planet', 'PLAN'],
      ['scatter', 'cats'],
    ]) {
      expect(containsWord(clue!, word!), `${clue} is fine for ${word}`).toBe(false);
    }
  });
});
