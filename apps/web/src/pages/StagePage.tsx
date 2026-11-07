import { STAGE_CODE_LENGTH, type StagePaired, type StageStatus } from '@vt/protocol';
import { Button, Icon, cn, usePhone } from '@vt/ui';
import { Poster, PosterInfoProvider } from '@vt/ui/show';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiFailure, api } from '../lib/api.ts';
import { type ResolvedTheme, useStageTheme } from '../lib/theme.ts';
import { usePageTitle } from '../lib/title.ts';
import { ShellScene } from '../stage/StageFrame.tsx';
import { startShow } from '../stage/start.ts';

/**
 * `/stage`: a TV or laptop becomes a room's table screen. The host's phone shows a code; typed
 * here it pairs this screen with that room, and the big start button (which also unlocks sound)
 * opens the show.
 */
export function StagePage() {
  usePageTitle('Table screen');
  const { theme, setTheme } = useStageTheme();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The room this screen is paired with (just now, or before a reload). */
  const [roomId, setRoomId] = useState<string | null>(null);
  // A phone opening this page gets a phone-sized page: the TV's poster scaled down is unreadable.
  const phone = usePhone();

  useEffect(() => {
    let stale = false;
    api<StageStatus>('/api/stage')
      .then((p) => {
        if (!stale && p.roomId) setRoomId(p.roomId);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);

  const pair = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api<StagePaired>('/api/stage/pair', { method: 'POST', body: { code } });
      setRoomId(p.roomId);
    } catch (err) {
      setError(
        err instanceof ApiFailure
          ? err.message
          : "We couldn't reach the tavern. Check the connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const headline = roomId ? 'Ready when you are' : 'Pair this screen';
  const line = roomId
    ? 'This screen is paired with the room. Start the show when everyone can see it.'
    : "The host taps the 👥 button in the room's header, then 📺 Table screen, and reads you a code. Type it here.";
  const footer =
    'A table screen shows the table to everyone but never takes a seat, and the phones keep their own secrets.';
  const controls = (big: boolean) =>
    roomId ? (
      <>
        <Button
          size="lg"
          className={big ? 'h-28 w-full text-[40px]' : 'w-full'}
          autoFocus
          onClick={() => {
            startShow();
            void navigate(`/stage/${roomId}`);
          }}
        >
          ▶ Start the show
        </Button>
        <button
          type="button"
          className={cn(big ? 'text-[28px]' : 'text-small', 'text-accent-text underline')}
          onClick={() => {
            setRoomId(null);
            setCode('');
          }}
        >
          Pair with another room
        </button>
      </>
    ) : (
      <form onSubmit={(e) => void pair(e)} className={big ? 'space-y-6' : 'space-y-3'}>
        <label className="block">
          <span className="sr-only">Pairing code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={STAGE_CODE_LENGTH + 2}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            placeholder="ABC123"
            aria-invalid={error !== null}
            className={cn(
              'w-full border-2 border-line-input bg-card text-center font-mono font-bold tracking-[0.3em] uppercase placeholder:text-ink-faint focus:border-accent focus:outline-none',
              big ? 'h-32 rounded-3xl text-[80px]' : 'h-16 rounded-2xl text-[32px]',
            )}
          />
        </label>
        {error && (
          <p
            role="alert"
            className={cn(big ? 'text-[28px]' : 'text-small', 'font-medium text-danger-ink')}
          >
            {error}
          </p>
        )}
        <Button
          size="lg"
          type="submit"
          className={big ? 'h-24 w-full text-[36px]' : 'w-full'}
          disabled={busy || code.replace(/[\s-]/g, '').length !== STAGE_CODE_LENGTH}
        >
          Pair this screen
        </Button>
      </form>
    );

  if (phone)
    return (
      <ShellScene>
        <div className="h-full overflow-y-auto px-4 py-6">
          <div className="mx-auto flex max-w-md flex-col gap-4">
            <p className="font-display font-semibold">📺 Table screen</p>
            <h1 className="font-display text-title font-semibold">{headline}</h1>
            <p className="text-ink-2">{line}</p>
            {controls(false)}
            <p className="flex items-start gap-2 text-small text-ink-muted">
              <Icon name="tv" className="mt-0.5 shrink-0" />
              {footer}
            </p>
            <ThemeSwitch theme={theme} setTheme={setTheme} small />
          </div>
        </div>
      </ShellScene>
    );

  return (
    <ShellScene>
      <PosterInfoProvider value={{ emblem: '📺', name: 'Table screen' }}>
        <Poster
          headline={headline}
          line={line}
          footer={{ icon: 'tv', text: footer }}
          footerEnd={<ThemeSwitch theme={theme} setTheme={setTheme} />}
        >
          <div className="mt-4 w-[880px] space-y-6">{controls(true)}</div>
        </Poster>
      </PosterInfoProvider>
    </ShellScene>
  );
}

/**
 * This screen's own Light / Dark switch: the table screen runs dark, and a bright room can turn
 * it light. Only here, before the show starts; the show itself has nothing to press.
 */
function ThemeSwitch({
  theme,
  setTheme,
  small,
}: {
  theme: ResolvedTheme;
  setTheme: (t: ResolvedTheme) => void;
  small?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="This screen’s colours"
      className="inline-flex self-start rounded-full border border-line bg-panel p-1"
    >
      {(['dark', 'light'] as const).map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={theme === t}
          onClick={() => setTheme(t)}
          className={cn(
            'inline-flex items-center rounded-full font-semibold',
            small ? 'min-h-11 gap-2 px-4 text-small' : 'gap-3 px-6 py-2 text-[28px]',
            theme === t ? 'bg-accent text-accent-fg' : 'text-ink-2',
          )}
        >
          <Icon name={t === 'dark' ? 'moon' : 'sun'} size={small ? 18 : 28} />
          {t === 'dark' ? 'Dark' : 'Light'}
        </button>
      ))}
    </div>
  );
}
