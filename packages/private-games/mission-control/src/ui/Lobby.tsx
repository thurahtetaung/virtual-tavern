import type { GameRoomInfo } from '@vt/game-sdk';
import {
  GuideLink,
  Hint,
  LobbySettings,
  Panel,
  PlayerTag,
  RefusalSlot,
  ProtectedImage,
  Switch,
  cn,
  LobbyLayout,
  LobbyPitch,
  LobbyStart,
  SeatHeading,
  SeatToggle,
} from '@vt/ui';
import type { MissionControlAction, MissionControlView, Settings } from '../logic/types.ts';
import { guide } from '../logic/guide.ts';
import { type Art, useArt } from './assets.tsx';
import { Logbook } from './Logbook.tsx';
import { type Status, missionLabel, startBlocker } from './status.ts';

export const SEAT_CONTROL_ID = 'mission-control-seat';
const ANCHOR = 'mc-lobby';

type Act = (a: MissionControlAction, o?: { anchor?: string }) => Promise<boolean>;

export function settingsSummary(view: MissionControlView, art: Art): string[] {
  const s = view.settings;
  return [
    view.voyage ? art.campaignName(view.voyage) : 'no campaign',
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
    <LobbyLayout
      pitch={
        <LobbyPitch
          title={room.gameName ?? 'Mission Control'}
          emblem="🌊"
          art={
            art.box && (
              <ProtectedImage src={art.box} alt="" className="w-full rounded-lg object-cover" />
            )
          }
        >
          {guide.tagline}
        </LobbyPitch>
      }
      rail={
        <>
          <LobbySettings
            editable={editable}
            summary={settingsSummary(view, art)}
            className="space-y-4"
          >
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
                        s.voyageKey === v.key && 'bg-accent-soft ring-2 ring-accent',
                      )}
                    >
                      {art.campaignName(v)}
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
                        s.dummyAfter === i && 'bg-accent-soft ring-2 ring-accent',
                      )}
                    >
                      After {seated[i]!.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </LobbySettings>
          <RefusalSlot anchor={ANCHOR} />
        </>
      }
      start={
        editable && (
          <LobbyStart
            label={`Start ${missionLabel(picked, view.voyage?.missions.find((x) => x.n === picked)?.label)}`}
            blocker={blocker}
            onStart={() => void act({ type: 'start' }, { anchor: ANCHOR })}
            testId="mc-start"
          />
        )
      }
    >
      {status.text && <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>}
      {view.notice && (
        <p className="rounded-xl bg-warn-soft px-4 py-2 text-center text-sm text-warn-ink ring-1 ring-warn-line">
          {view.notice}
        </p>
      )}
      <Panel className="space-y-2">
        <SeatHeading title={`${art.say('The {crew}')} (${seated.length}/5)`}>
          {view.me && (
            <SeatToggle
              id={SEAT_CONTROL_ID}
              playing={view.me.playing}
              onChange={(playing) => void act({ type: 'sit', playing }, { anchor: ANCHOR })}
            />
          )}
        </SeatHeading>
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
            <li className="text-ink-muted">
              🤖 {art.say('{dummy}')}, the helper crewmate for small crews
            </li>
          )}
        </ul>
      </Panel>
      <GuideLink title={room.gameName ?? 'Mission Control'} onClick={showGuide} />
      {/* Without a campaign, the reason under Start says so (once). */}
      {view.voyage && (
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
      )}
    </LobbyLayout>
  );
}
