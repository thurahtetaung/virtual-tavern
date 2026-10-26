import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  Hint,
  LobbySettings,
  Panel,
  PlayerTag,
  RefusalSlot,
  StickyBar,
  Switch,
  cn,
} from '@vt/ui';
import type { MissionControlAction, MissionControlView, Settings } from '../logic/types.ts';
import { useArt } from './assets.tsx';
import { Logbook } from './Logbook.tsx';
import { type Status, missionLabel, startBlocker } from './status.ts';

export const SEAT_CONTROL_ID = 'mission-control-seat';
const ANCHOR = 'mc-lobby';

type Act = (a: MissionControlAction, o?: { anchor?: string }) => Promise<boolean>;

export function settingsSummary(view: MissionControlView): string[] {
  const s = view.settings;
  return [
    view.voyage?.name ?? 'no campaign',
    s.playedCards ? 'all played cards shown' : 'last trick only',
    ...(s.realTime ? [] : ['no real-time clocks']),
    ...(s.openTable ? ['open table'] : []),
  ];
}

export function Lobby({
  view,
  room,
  act,
  status,
  showGuide,
}: {
  view: MissionControlView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  showGuide: () => void;
}) {
  const art = useArt();
  const editable = room.isHost;
  const s = view.settings;
  const set = (patch: Partial<Omit<Settings, 'voyageKey'>> & { voyageKey?: string }) =>
    void act({ type: 'update-settings', ...patch }, { anchor: ANCHOR });
  const seated = view.seats.filter((x) => x.playing);
  const blocker = startBlocker(view);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const next = view.campaign?.next ?? view.voyage?.missions[0]?.n ?? 1;
  const picked = view.chosen ?? next;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      {view.notice && (
        <p className="rounded-xl bg-warn-soft px-4 py-2 text-center text-sm text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30">
          {view.notice}
        </p>
      )}
      <Panel className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold">
            {art.say('The {crew}')} ({seated.length}/5)
          </h3>
          {view.me && (
            <Button
              id={SEAT_CONTROL_ID}
              size="sm"
              variant={view.me.playing ? 'secondary' : 'primary'}
              onClick={() =>
                void act({ type: 'sit', playing: !view.me!.playing }, { anchor: ANCHOR })
              }
            >
              {view.me.playing ? 'Sit out (watch)' : 'Take a seat'}
            </Button>
          )}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {seated.map((p) => (
            <li key={p.id}>
              <PlayerTag
                name={p.name}
                host={p.id === room.hostId}
                you={p.id === view.me?.id}
                offline={!online(p.id)}
              />
            </li>
          ))}
          {seated.length === 2 && (
            <li className="text-ink-muted">🤖 {art.say('{dummy}')} (best with 3–5)</li>
          )}
        </ul>
      </Panel>
      {view.voyage ? (
        <Panel>
          <Logbook
            voyage={view.voyage}
            campaign={view.campaign}
            chosen={view.chosen}
            onChoose={
              editable ? (n) => void act({ type: 'choose', mission: n }, { anchor: ANCHOR }) : null
            }
          />
        </Panel>
      ) : (
        <Panel>
          <p className="text-sm">
            No campaign is loaded yet. An admin imports it as a content pack.
          </p>
        </Panel>
      )}
      <LobbySettings editable={editable} summary={settingsSummary(view)} className="space-y-4">
        {editable && <h3 className="text-lg font-bold">Settings</h3>}
        {view.voyages.length > 1 && (
          <fieldset>
            <legend className="text-sm font-semibold">Campaign</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {view.voyages.map((v) => (
                <button
                  data-testid={`mc-voyage-${v.key}`}
                  key={v.key}
                  type="button"
                  disabled={!editable}
                  aria-pressed={s.voyageKey === v.key}
                  onClick={() => set({ voyageKey: v.key })}
                  className={cn(
                    'h-11 rounded-lg px-3 text-sm font-semibold ring-1 ring-line',
                    s.voyageKey === v.key &&
                      'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500',
                  )}
                >
                  {art.voyageTitle(v.key) ?? v.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <Switch
          on={s.playedCards}
          editable={editable}
          title="Show all played cards"
          help="Look back at every trick. Off: the last trick only."
          onChange={(playedCards) => set({ playedCards })}
          testId="mc-played-cards"
        />
        <Switch
          on={s.realTime}
          editable={editable}
          title="Real-time missions"
          help="Off: timed missions play their printed alternative."
          onChange={(realTime) => set({ realTime })}
        />
        <Switch
          on={s.openTable}
          editable={editable}
          title="Open table (house rule)"
          help="For groups who talk freely: no silence banners."
          onChange={(openTable) => set({ openTable })}
        />
        {view.voyage?.taskSet === 'cards' && (
          <Switch
            on={s.challenge}
            editable={editable && seated.length === 3}
            title="Challenge for Three"
            help="Three players only: no green cards and no trump 1, so ten cards each."
            onChange={(challenge) => set({ challenge })}
            testId="mc-challenge"
          />
        )}
        {seated.length === 2 && (
          <fieldset>
            <legend className="text-sm font-semibold">{art.say('Where {dummy} sits')}</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {([0, 1] as const).map((i) => (
                <button
                  key={i}
                  type="button"
                  disabled={!editable}
                  aria-pressed={s.dummyAfter === i}
                  onClick={() => set({ dummyAfter: i })}
                  className={cn(
                    'h-11 rounded-lg px-3 text-sm ring-1 ring-line',
                    s.dummyAfter === i &&
                      'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500',
                  )}
                >
                  After {seated[i]!.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <RefusalSlot anchor={ANCHOR} />
        {editable && (
          <StickyBar>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 dark:border-stone-800">
              <Button
                size="lg"
                disabled={blocker !== null}
                onClick={() => void act({ type: 'start' }, { anchor: ANCHOR })}
                data-testid="mc-start"
              >
                Start{' '}
                {missionLabel(picked, view.voyage?.missions.find((x) => x.n === picked)?.label)}
              </Button>
              {blocker && <span className="text-sm text-ink-muted">{blocker}</span>}
            </div>
          </StickyBar>
        )}
      </LobbySettings>
      <Button variant="secondary" size="lg" className="w-full" onClick={showGuide}>
        📖 New here? Read the guide
      </Button>
    </div>
  );
}
