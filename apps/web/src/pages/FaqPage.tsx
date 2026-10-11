import { Panel } from '@vt/ui';
import { Fragment } from 'react';
import faqSource from '../../../../docs/faq.md?raw';
import { ForgetMe } from '../components/ForgetMe.tsx';
import { Layout } from '../components/Layout.tsx';
import { boldRuns, parseFaq } from '../lib/faq.ts';

const sections = parseFaq(faqSource);

function Rich({ text }: { text: string }) {
  return boldRuns(text).map((run, i) =>
    i % 2 ? <strong key={i}>{run}</strong> : <Fragment key={i}>{run}</Fragment>,
  );
}

/** Questions people ask when they stumble onto the site; the text lives in docs/faq.md. */
export function FaqPage() {
  return (
    <Layout>
      <h1 className="mb-2 text-3xl font-bold">Questions & answers</h1>
      <p className="mb-6 text-stone-600 dark:text-stone-400">
        New here? These cover what this place is and how it works.
      </p>
      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.title} aria-labelledby={`faq-${section.title}`}>
            <h2 id={`faq-${section.title}`} className="mb-2 text-xl font-bold">
              {section.title}
            </h2>
            <Panel className="divide-y divide-stone-200 p-0 dark:divide-stone-800">
              {section.items.map((item) => (
                <details key={item.question} className="group px-4 py-3">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                    {item.question}
                    <span
                      aria-hidden
                      className="text-stone-400 transition group-open:rotate-90 motion-reduce:transition-none"
                    >
                      ▸
                    </span>
                  </summary>
                  <div className="space-y-2 pt-1 pb-1 text-stone-700 dark:text-stone-300">
                    {item.answer.map((block, i) =>
                      block.kind === 'p' ? (
                        <p key={i}>
                          <Rich text={block.text} />
                        </p>
                      ) : (
                        <ul key={i} className="list-disc space-y-1 pl-5">
                          {block.items.map((li) => (
                            <li key={li}>
                              <Rich text={li} />
                            </li>
                          ))}
                        </ul>
                      ),
                    )}
                  </div>
                </details>
              ))}
            </Panel>
            {section.title === 'Accounts and privacy' && (
              <div className="mt-3">
                <ForgetMe />
              </div>
            )}
          </section>
        ))}
      </div>
    </Layout>
  );
}
