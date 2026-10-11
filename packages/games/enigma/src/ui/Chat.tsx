import { Button, Panel, cn } from '@vt/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { EnigmaAction, EnigmaView } from '../logic/types.ts';
import { MAX_CHAT_LENGTH } from '../logic/types.ts';
import { chatMuted } from './status.ts';
import { TEAM_LABEL, TEAM_TEXT } from './theme.ts';

export function TeamChat({
  view,
  act,
}: {
  view: EnigmaView;
  act: (a: EnigmaAction) => Promise<boolean>;
}) {
  const team = view.me?.team;
  const [text, setText] = useState('');
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // Block body: scrollIntoView may return a Promise, which React must not treat as a cleanup.
    void end.current?.scrollIntoView({ block: 'nearest' });
  }, [view.chat.length]);
  if (!team) return null;
  const muted = chatMuted(view);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText('');
    if (!(await act({ type: 'chat', text: message }))) setText(message);
  };

  return (
    <Panel aria-label="Team chat">
      <h3 className={cn('font-bold', TEAM_TEXT[team])}>{TEAM_LABEL[team]} team chat</h3>
      <p className="mb-2 text-xs text-stone-500">
        Only your team can read this. Keep your guesses off the voice call!
      </p>
      <ol className="max-h-64 space-y-1 overflow-y-auto pr-1 text-sm lg:max-h-80">
        {view.chat.map((m, i) => (
          <li key={i}>
            <b>{view.seats.find((s) => s.id === m.by)?.name ?? 'Someone who left'}:</b> {m.text}
          </li>
        ))}
        {view.chat.length === 0 && <li className="text-stone-500 italic">No messages yet.</li>}
        <li ref={end} aria-hidden />
      </ol>
      <form onSubmit={(e) => void send(e)} className="mt-2 flex gap-2">
        <input
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          disabled={muted}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            muted ? 'Encryptors stay quiet until their team decodes' : 'Message your team…'
          }
          aria-label="Message your team"
          className="h-10 min-w-0 flex-1 rounded-lg bg-white px-3 ring-1 ring-stone-300 disabled:opacity-60 dark:bg-stone-800 dark:ring-stone-600"
        />
        <Button type="submit" disabled={muted || !text.trim()}>
          Send
        </Button>
      </form>
      {muted && (
        <p className="mt-1 text-xs text-stone-500">
          You know the code, so you stay quiet in chat and notes until your team has decoded it.
        </p>
      )}
    </Panel>
  );
}
