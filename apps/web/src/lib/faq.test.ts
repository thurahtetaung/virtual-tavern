import { describe, expect, it } from 'vitest';
import faqSource from '../../../../docs/faq.md?raw';
import { boldRuns, parseFaq } from './faq.ts';

describe('parseFaq', () => {
  it('reads sections, questions, paragraphs and lists', () => {
    const md = [
      '# Title',
      'Intro to skip.',
      '',
      '## First',
      '',
      '**Why?**',
      'Because',
      'it is.',
      '',
      '**What?**',
      'Two kinds:',
      '',
      '- **One:** this',
      '- **Two:** that',
      '',
      '## Second',
      '',
      '**Who?**',
      'Us.',
    ].join('\n');
    expect(parseFaq(md)).toEqual([
      {
        title: 'First',
        items: [
          { question: 'Why?', answer: [{ kind: 'p', text: 'Because it is.' }] },
          {
            question: 'What?',
            answer: [
              { kind: 'p', text: 'Two kinds:' },
              { kind: 'ul', items: ['**One:** this', '**Two:** that'] },
            ],
          },
        ],
      },
      { title: 'Second', items: [{ question: 'Who?', answer: [{ kind: 'p', text: 'Us.' }] }] },
    ]);
  });

  it('splits bold runs', () => {
    expect(boldRuns('Tap **Create a room**, then share.')).toEqual([
      'Tap ',
      'Create a room',
      ', then share.',
    ]);
  });

  it('parses the real FAQ: every question has an answer', () => {
    const sections = parseFaq(faqSource);
    expect(sections.length).toBeGreaterThanOrEqual(4);
    for (const s of sections) {
      expect(s.items.length).toBeGreaterThan(0);
      for (const item of s.items) expect(item.answer.length, item.question).toBeGreaterThan(0);
    }
  });
});
