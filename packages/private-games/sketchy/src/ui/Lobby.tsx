import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  type Choice,
  ChoicePicker,
  Hint,
  LobbySettings,
  Panel,
  RefusalSlot,
  StickyBar,
  Switch,
  cn,
} from '@vt/ui';
import type { Settings, SketchyView } from '../logic/types.ts';
import type { Act } from './act.ts';
import type { Status } from './status.ts';
import { Table } from './Table.tsx';

const DRAW = [90, 130, 180, null] as const;
const WRITE = [30, 40, 60, null] as const;
const VOTE = [20, 30, 45, null] as const;
const LOBBY_ANCHOR = 'sketchy-lobby';

const secs = (v: number | null) => (v === null ? 'No limit' : `${v} s`);

/** One line for the folded timer settings, e.g. "draw 130 s, write 40 s, pick 30 s, strict". */
export function timerSummary(s: Settings): string {
  const parts = [
    s.drawSeconds !== null && `draw ${s.drawSeconds} s`,
    s.writeSeconds !== null && `write ${s.writeSeconds} s`,
    s.voteSeconds !== null && `pick ${s.voteSeconds} s`,
  ].filter(Boolean);
  if (!parts.length) return 'no time limits';
  return [...parts, s.timerMode === 'strict' ? 'strict' : 'reminder only'].join(', ');
}

/** The guests' summary: the packs (or how many), adult prompts, then the timers. */
export function settingsSummary(view: Pick<SketchyView, 'packs' | 'settings'>): string[] {
  const names = view.packs.filter((p) => view.settings.packIds.includes(p.id)).map((p) => p.name);
  return [
    names.length > 1 ? `${names.length} prompt packs` : (names[0] ?? 'no prompt pack'),
    ...(view.settings.adult ? ['adult prompts'] : []),
    timerSummary(view.settings),
  ];
}

function Segmented<T extends number | null>({
  label,
  values,
  value,
  editable,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T;
  editable: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{label}</legend>
      {editable ? (
        <div className="mt-1 grid grid-cols-4 gap-2">
          {values.map((v) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={value === v}
              onClick={() => onChange(v)}
              className={cn(
                'h-11 rounded-lg text-sm font-semibold ring-1 transition',
                value === v
                  ? 'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500'
                  : 'ring-line hover:bg-panel dark:ring-stone-700 dark:hover:bg-stone-800',
              )}
            >
              {secs(v)}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm">{secs(value)}</p>
      )}
    </fieldset>
  );
}

const packsSummary = (chosen: Choice[], total: number) =>
  chosen.length === 0
    ? 'Pick the packs the prompts come from.'
    : `Everyone draws prompts from ${chosen.length === 1 ? 'this pack' : 'these packs'} (${total} prompts).`;

export function Lobby({
  view,
  room,
  act,
  status,
  blocker,
  online,
  showGuide,
}: {
  view: SketchyView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  blocker: string | null;
  online: (id: string) => boolean;
  showGuide: () => void;
}) {
  const editable = room.isHost;
  const s = view.settings;
  const set = (patch: Partial<Settings>) =>
    void act({ type: 'update-settings', ...patch }, { anchor: LOBBY_ANCHOR });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Panel>
        <Table view={view} online={online} act={act} hostId={room.hostId} />
      </Panel>
      <LobbySettings editable={editable} summary={settingsSummary(view)} className="space-y-4">
        {editable && <h3 className="text-lg font-bold">Game settings</h3>}
        <ChoicePicker
          selectedIds={s.packIds}
          editable={editable}
          onSave={(ids) => act({ type: 'update-settings', packIds: ids }, { anchor: LOBBY_ANCHOR })}
          choices={view.packs.map((p) => ({
            id: p.id,
            name: p.name,
            count: p.count + (s.adult ? p.adult : 0),
          }))}
          labels={{
            title: 'Prompt packs',
            unit: 'prompts',
            noun: 'pack',
            change: 'Change packs',
            summary: packsSummary,
          }}
        />
        <Switch
          on={s.adult}
          editable={editable}
          title="Adult prompts (18+)"
          help="Deals adult-only prompts and house titles too. Off by default."
          onChange={(adult) => set({ adult })}
          testId="sketchy-adult"
        />
        {/* Folded away so the Start button stays on a phone's first screen. */}
        <details className="group">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm [&::-webkit-details-marker]:hidden">
            <span>
              <span className="font-semibold">Timers</span>
              <span className="text-ink-muted"> · {timerSummary(s)}</span>
            </span>
            <span aria-hidden className="text-ink-muted transition group-open:rotate-90">
              ▸
            </span>
          </summary>
          <div className="space-y-3 pt-2">
            <Segmented
              label="Drawing"
              values={DRAW}
              value={s.drawSeconds as (typeof DRAW)[number]}
              editable={editable}
              onChange={(drawSeconds) => set({ drawSeconds })}
            />
            <Segmented
              label="Writing a fake title"
              values={WRITE}
              value={s.writeSeconds as (typeof WRITE)[number]}
              editable={editable}
              onChange={(writeSeconds) => set({ writeSeconds })}
            />
            <Segmented
              label="Picking the real title"
              values={VOTE}
              value={s.voteSeconds as (typeof VOTE)[number]}
              editable={editable}
              onChange={(voteSeconds) => set({ voteSeconds })}
            />
            <Switch
              on={s.timerMode === 'strict'}
              editable={editable}
              title="Strict timers"
              help="When time runs out, the drawing is sent as it is, picking starts without the missing titles and a missing pick scores nothing. Off: the timers are only reminders."
              onChange={(on) => set({ timerMode: on ? 'strict' : 'soft' })}
            />
          </div>
        </details>
        <RefusalSlot anchor={LOBBY_ANCHOR} />
        {editable && (
          <StickyBar>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 dark:border-stone-800">
              <Button
                size="lg"
                disabled={blocker !== null}
                onClick={() => void act({ type: 'start' })}
              >
                Start game
              </Button>
              {blocker && <span className="text-sm text-ink-muted">{blocker}</span>}
            </div>
          </StickyBar>
        )}
      </LobbySettings>
      <Button variant="secondary" size="lg" className="w-full" onClick={showGuide}>
        📖 New to {room.gameName ?? 'Sketchy'}? Read the guide
      </Button>
    </div>
  );
}
