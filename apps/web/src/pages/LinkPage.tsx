import {
  LINK_CODE_LENGTH,
  type LinkCheck,
  type LinkPreview,
  type LinkRedeemed,
} from '@vt/protocol';
import { Button, Field, Icon, Input, Panel, PlayerDot, cn } from '@vt/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Layout } from '../components/Layout.tsx';
import { findGame } from '../games/registry.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { playerToken } from '../lib/identity.ts';
import { allLinkKeys, codeFromHash, saveLinkKey } from '../lib/links.ts';
import { usePageTitle } from '../lib/title.ts';

type Step =
  | { kind: 'type'; problem?: 'expired' | 'wrong' }
  | { kind: 'confirm'; preview: LinkPreview }
  /** The code is for an admin playtest: this phone signs in as the admin first. */
  | { kind: 'admin' }
  | { kind: 'other-seat'; roomId: string; seat: string; host: string; name: string };

/** The code a QR code opened this page with (`/link#KXRT`), taken off the address bar at once. */
function codeFromFragment(): string {
  const { hash } = window.location;
  if (hash) history.replaceState(history.state, '', window.location.pathname);
  return codeFromHash(hash);
}

const offline = "We couldn't reach the tavern. Check your connection and try again.";

/**
 * `/link`: a phone becomes a second key of the player on a PC. It types the four letters the PC
 * shows (or opens this page from its QR code), confirms who it will play as, and lands in the
 * room as them. Works on a phone that has never been here (the back room comes with the code).
 */
export function LinkPage() {
  usePageTitle('Link a phone');
  const navigate = useNavigate();
  const [code, setCode] = useState(codeFromFragment);
  const [step, setStep] = useState<Step>({ kind: 'type' });
  const [error, setError] = useState<string | null>(null);
  const body = () => ({ code, token: playerToken(), links: allLinkKeys() });

  const ask = () => api<LinkCheck>('/api/link/check', { method: 'POST', body: body() });
  const answered = (res: LinkCheck) => {
    if (res.status === 'ok') setStep({ kind: 'confirm', preview: res.preview });
    else if (res.status === 'other-seat') setStep({ kind: 'other-seat', ...res });
    else if (res.status === 'admin') setStep({ kind: 'admin' });
    else setStep({ kind: 'type', problem: res.status });
  };
  const failed = (err: unknown) => setError(err instanceof ApiFailure ? err.message : offline);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      answered(await ask());
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  // A QR code brought the code: it is checked straight away (busy until the answer comes).
  const [scanned] = useState(() => code.length === LINK_CODE_LENGTH);
  const [busy, setBusy] = useState(scanned);
  useEffect(() => {
    if (!scanned) return;
    ask()
      .then(answered, failed)
      .finally(() => setBusy(false));
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned]);

  const link = async (preview: LinkPreview) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<LinkRedeemed>('/api/link', { method: 'POST', body: body() });
      saveLinkKey(res.roomId, res.key);
      void navigate(`/r/${res.roomId}`, { state: { linkedAs: preview.name } });
    } catch (err) {
      if (err instanceof ApiFailure && (err.code === 'expired' || err.code === 'wrong'))
        setStep({ kind: 'type', problem: err.code });
      else if (err instanceof ApiFailure && err.code === 'admin') setStep({ kind: 'admin' });
      else setError(err instanceof ApiFailure ? err.message : offline);
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === LINK_CODE_LENGTH) void check();
  };

  let content;
  if (step.kind === 'confirm') {
    const { preview } = step;
    const icon = findGame(preview.gameId)?.icon;
    content = (
      <>
        <h1 className="font-display text-3xl font-bold">Link this phone?</h1>
        <Panel className="space-y-3" data-testid="link-confirm">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-flex size-11 items-center justify-center rounded-lg bg-sunk text-2xl"
            >
              {icon ?? <Icon name="gamepad-2" size={24} />}
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{preview.game}</p>
              <p className="text-sm text-ink-muted">
                {preview.host}’s room · {preview.players}{' '}
                {preview.players === 1 ? 'player' : 'players'}
              </p>
            </div>
          </div>
          <p className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
            You’ll play as
          </p>
          <p className="flex items-center gap-2 text-lg font-semibold">
            <PlayerDot color={preview.color} />
            {preview.name}
          </p>
          <p className="text-sm text-ink-muted">
            The same seat and score as on your PC. Your PC becomes the table screen.
          </p>
        </Panel>
        {preview.opensBackroom && (
          <p className="flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2 text-sm text-success-ink ring-1 ring-success-line">
            <Icon name="lock" size={18} className="shrink-0" />
            This also opens the back room on this phone.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-danger-ink">
            {error}
          </p>
        )}
        <div className="mt-auto space-y-2 pt-4">
          <Button
            size="lg"
            className="w-full"
            disabled={busy}
            sending={busy}
            onClick={() => void link(preview)}
          >
            Link as {preview.name}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => {
              setCode('');
              setStep({ kind: 'type' });
            }}
          >
            That’s not me
          </Button>
        </div>
      </>
    );
  } else if (step.kind === 'admin') {
    content = <AdminSignIn onDone={() => void check()} />;
  } else if (step.kind === 'other-seat') {
    content = (
      <>
        <h1 className="font-display text-3xl font-bold">This phone is already playing</h1>
        <p
          className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink ring-1 ring-danger-line"
          data-testid="link-other-seat"
        >
          <Icon name="users" size={18} className="mt-0.5 shrink-0" />
          <span>
            This phone is in {step.host}’s room as <strong>{step.seat}</strong>. A phone can be only
            one player in a room.
          </span>
        </p>
        <p className="text-sm">
          To link it as <strong>{step.name}</strong>, {step.seat} leaves the room first, or use
          another phone.
        </p>
        <div className="mt-auto pt-4">
          <Link
            to={`/r/${step.roomId}`}
            className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-sunk font-semibold ring-1 ring-line-strong hover:bg-card"
          >
            Back to {step.seat}’s seat
          </Link>
        </div>
      </>
    );
  } else {
    const { problem } = step;
    content = (
      <form onSubmit={submit} className="flex flex-1 flex-col gap-4">
        <h1 className="font-display text-3xl font-bold">Link to your PC</h1>
        {!problem && (
          <p className="text-ink-muted">
            Type the four letters your PC shows. (Or point your camera at the QR code there: it
            opens this for you.)
          </p>
        )}
        <CodeBoxes
          code={code}
          invalid={!!problem}
          onChange={(c) => {
            setCode(c);
            if (problem) setStep({ kind: 'type' });
          }}
        />
        {problem && (
          <p
            role="alert"
            data-testid={`link-${problem}`}
            className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink ring-1 ring-danger-line"
          >
            <Icon name="triangle-alert" size={18} className="mt-0.5 shrink-0" />
            {problem === 'expired' ? (
              <span>
                <strong>That code has run out.</strong> Codes last 2 minutes, and your PC shows a
                new one by itself: type that one.
              </span>
            ) : (
              <span>
                <strong>No PC is showing that code.</strong> Check the letters on your PC and type
                them again.
              </span>
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-danger-ink">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || code.length !== LINK_CODE_LENGTH}
          sending={busy}
        >
          Link this phone
        </Button>
        {!problem && (
          <p className="text-sm text-ink-muted">The code works once and lasts 2 minutes.</p>
        )}
      </form>
    );
  }

  return (
    <Layout>
      <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-md flex-col gap-4 py-4">
        {content}
      </div>
    </Layout>
  );
}

/** A playtest's phone signs in as the admin (the playtest's own door), then the code is checked again. */
function AdminSignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await api('/api/admin/login', { method: 'POST', body: { password } });
      onDone();
    } catch (err) {
      setRefusal(err instanceof ApiFailure ? err.message : offline);
      setSending(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-1 flex-col gap-4">
      <h1 className="font-display text-3xl font-bold">Sign in to link</h1>
      <p className="text-ink-muted" data-testid="link-admin">
        This is a playtest, which only the tavern keeper can enter. Sign in on this phone to link
        it.
      </p>
      <Field label="Admin password" error={refusal}>
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          invalid={refusal !== null}
          onChange={(e) => {
            setPassword(e.target.value);
            setRefusal(null);
          }}
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" sending={sending} disabled={!password}>
        Sign in and link
      </Button>
    </form>
  );
}

/** Four letter boxes over one real input (so typing, pasting and the phone's keyboard all work). */
function CodeBoxes({
  code,
  invalid,
  onChange,
}: {
  code: string;
  invalid: boolean;
  onChange: (code: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label className="relative block">
      <span className="sr-only">Code from your PC</span>
      <span aria-hidden className="grid grid-cols-4 gap-3">
        {Array.from({ length: LINK_CODE_LENGTH }, (_, i) => (
          <span
            key={i}
            className={cn(
              'flex aspect-square items-center justify-center rounded-xl border-2 bg-card font-mono text-4xl font-bold',
              invalid
                ? 'border-danger text-danger-ink'
                : focused && i === Math.min(code.length, LINK_CODE_LENGTH - 1)
                  ? 'border-accent'
                  : 'border-line-input',
            )}
          >
            {code[i] ?? ''}
          </span>
        ))}
      </span>
      <input
        value={code}
        onChange={(e) =>
          onChange(
            e.target.value
              .toUpperCase()
              .replace(/[^A-Z]/g, '')
              .slice(0, LINK_CODE_LENGTH),
          )
        }
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={LINK_CODE_LENGTH + 2}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus
        aria-invalid={invalid}
        data-testid="link-code-input"
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
    </label>
  );
}
