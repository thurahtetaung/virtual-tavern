import { Button, Input, NameDot, Panel, Row, Rows, cn } from '@vt/ui';
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
  const end = useRef<HTMLDivElement>(null);
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
      <p className="mb-2 text-caption text-ink-muted">
        Only your team can read this. Keep your guesses off the voice call!
      </p>
      <div className="max-h-64 overflow-y-auto pr-1 text-small lg:max-h-80">
        <Rows>
          {view.chat.map((m, i) => (
            <Row key={i} className="block min-h-9 py-1.5">
              <Author name={view.seats.find((s) => s.id === m.by)?.name} /> {m.text}
            </Row>
          ))}
          {view.chat.length === 0 && (
            <Row className="min-h-9 text-ink-muted italic">No messages yet.</Row>
          )}
        </Rows>
        <div ref={end} aria-hidden />
      </div>
      <form onSubmit={(e) => void send(e)} className="mt-2 flex gap-2">
        <Input
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          disabled={muted}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            muted ? 'Encryptors stay quiet until the codes are revealed' : 'Message your team…'
          }
          aria-label="Message your team"
          className="flex-1"
        />
        <Button type="submit" variant="secondary" disabled={muted || !text.trim()}>
          Send
        </Button>
      </form>
      {muted && (
        <p className="mt-1 text-caption text-ink-muted">
          You know the code, so you stay quiet in chat and notes until it is revealed.
        </p>
      )}
    </Panel>
  );
}

/** A message's author in bold, after their colour's dot. */
function Author({ name }: { name: string | undefined }) {
  if (!name) return <b>Someone who left:</b>;
  return (
    <b className="inline-flex items-center gap-1">
      {name}:
      <NameDot name={name} className="order-first" />
    </b>
  );
}
