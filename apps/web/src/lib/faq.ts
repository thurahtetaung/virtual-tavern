// Parses docs/faq.md, the FAQ's single source, into sections of questions. The format is small on
// purpose: `## Section`, then `**Question?**` lines, each followed by answer paragraphs and
// `- ` bullet lists. Anything before the first section (the title and a note) is skipped.

export type FaqBlock = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };
export interface FaqItem {
  question: string;
  answer: FaqBlock[];
}
export interface FaqSection {
  title: string;
  items: FaqItem[];
}

const QUESTION = /^\*\*(.+)\*\*$/;

export function parseFaq(markdown: string): FaqSection[] {
  const sections: FaqSection[] = [];
  let item: FaqItem | null = null;
  let para: string[] = [];
  const flush = () => {
    if (item && para.length) item.answer.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      flush();
      item = null;
      sections.push({ title: line.slice(3).trim(), items: [] });
      continue;
    }
    const section = sections.at(-1);
    if (!section) continue;
    const question = QUESTION.exec(line);
    if (question) {
      flush();
      item = { question: question[1]!, answer: [] };
      section.items.push(item);
      continue;
    }
    if (!item) continue;
    if (line === '') {
      flush();
    } else if (line.startsWith('- ')) {
      flush();
      const last = item.answer.at(-1);
      if (last?.kind === 'ul') last.items.push(line.slice(2));
      else item.answer.push({ kind: 'ul', items: [line.slice(2)] });
    } else {
      para.push(line);
    }
  }
  flush();
  return sections;
}

/** Splits text on `**bold**` runs: odd indexes are bold. */
export const boldRuns = (text: string) => text.split(/\*\*(.+?)\*\*/);
