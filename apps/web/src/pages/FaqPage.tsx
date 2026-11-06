import { Icon, Panel } from '@vt/ui';
import { Fragment } from 'react';
import faqSource from '../../../../docs/faq.md?raw';
import { ForgetMe } from '../components/ForgetMe.tsx';
import { Layout } from '../components/Layout.tsx';
import { boldRuns, parseFaq } from '../lib/faq.ts';
import { usePageTitle } from '../lib/title.ts';

const sections = parseFaq(faqSource);

function Rich({ text }: { text: string }) {
  return boldRuns(text).map((run, i) =>
    i % 2 ? <strong key={i}>{run}</strong> : <Fragment key={i}>{run}</Fragment>,
  );
}

/** Questions people ask when they stumble onto the site; the text lives in docs/faq.md. */
export function FaqPage() {
  usePageTitle('Questions & answers');
  return (
    <Layout>
      <h1 className="text-title font-semibold">Questions & answers</h1>
      <p className="mt-1 mb-6 text-ink-2 sm:text-sub">
        New here? These cover what this place is and how it works.
      </p>
      <div className="space-y-8">
        {sections.map((section) => (
          <section key={section.title} aria-labelledby={`faq-${section.title}`}>
            <h2 id={`faq-${section.title}`} className="mb-3 text-heading font-semibold">
              {section.title}
            </h2>
            <Panel className="divide-y divide-line p-0">
              {section.items.map((item) => (
                <details key={item.question} className="group">
                  <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2 font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
                    {item.question}
                    <Icon
                      name="chevron-down"
                      className="text-ink-faint transition-transform duration-[180ms] group-open:rotate-180 motion-reduce:transition-none"
                    />
                  </summary>
                  <div className="space-y-2 px-4 pt-1 pb-4 text-ink-2">
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
