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
import type { ReactNode } from 'react';
import { KINDS, type PackKind } from '../logic/content.ts';
import {
  ACT_ALTS,
  FILM_PRESETS,
  type FilmGoal,
  MIN_GENRES,
  MODES,
  MODE_IDS,
  STYLES,
  STYLE_IDS,
  type StyleId,
  genresOf,
  goalLine,
  modeBlurb,
  nounOf,
  presetOf,
  titlesNeeded,
} from '../logic/genres.ts';
import {
  ANSWER_SECONDS,
  type CliffhangerAction,
  type CliffhangerView,
  MAX_PLAYERS,
  TEAMS,
  TURN_SECONDS,
  type TeamId,
} from '../logic/types.ts';
import { useArt } from './assets.ts';
import { TeamChip, Who } from './parts.tsx';
import type { Status } from './status.ts';

type Act = (a: CliffhangerAction, o?: { anchor?: string }) => Promise<boolean>;

export const SEAT_CONTROL_ID = 'cliffhanger-teams';

const PRESET_LABELS: Record<FilmGoal, string> = {
  base: 'The first eight',
  all: 'All twelve',
  returns: 'Two of the extra four',
};

/** The guests' summary line. */
export function settingsSummary(view: CliffhangerView): string[] {
  const s = view.settings;
  return [
    s.deck === 'tv' ? 'TV shows' : 'Films',
    MODES[s.mode].name,
    ...(s.actAlt === 'cast' ? ['Name the Cast instead of Act It'] : []),
    goalLine(view.target).toLowerCase(),
    `${s.answerSeconds} s face-off, ${s.turnSeconds} s turns`,
    ...(s.noAdvantage ? ['no advantage'] : []),
    ...(s.comebackPick ? ['comeback pick'] : []),
    ...(s.suddenDeath ? ['sudden death'] : []),
    ...(s.openingClock ? ['opening clock'] : []),
  ];
}

function Pills<T extends string | number>({
  options,
  value,
  editable,
  onPick,
  label,
  testId,
}: {
  options: readonly { id: T; name: ReactNode; help?: string }[];
  value: T;
  editable: boolean;
  onPick: (v: T) => void;
  label: string;
  testId?: string;
}) {
  return (
    <fieldset data-testid={testId}>
      <legend className="text-sm font-semibold">{label}</legend>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            disabled={!editable && value !== o.id}
            onClick={() => editable && onPick(o.id)}
            className={cn(
              'min-h-11 rounded-lg px-2 py-1 text-left text-sm ring-1 transition',
              value === o.id
                ? 'bg-accent-soft font-semibold ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500'
                : 'ring-line hover:bg-card disabled:opacity-50 dark:ring-stone-700 dark:hover:bg-stone-800',
              !editable && 'cursor-default',
            )}
          >
            <span className="block">{o.name}</span>
            {o.help && <span className="block text-xs font-normal text-ink-muted">{o.help}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The genres to collect: quick picks (films), a chip per genre in its tape colour, 1 or 2 of each,
 * and the goal in a line. A genre the chosen packs have too few titles of is flagged; Start is
 * refused until it has more or is turned off.
 */
function GenrePicker({
  view,
  editable,
  act,
}: {
  view: CliffhangerView;
  editable: boolean;
  act: Act;
}) {
  const { names } = useArt();
  const s = view.settings;
  const goal = view.target;
  const need = titlesNeeded(goal.each);
  const counts = view.genreCounts;
  const short = (id: string) => counts !== null && (counts[id] ?? 0) < need;
  const send = (patch: Omit<Extract<CliffhangerAction, { type: 'update-settings' }>, 'type'>) =>
    void act({ type: 'update-settings', ...patch }, { anchor: 'cl-genres' });
  const toggle = (id: string) => {
    const on = goal.genres.includes(id);
    send({ genres: on ? goal.genres.filter((g) => g !== id) : [...goal.genres, id] });
  };
  const preset = s.deck === 'films' ? presetOf(goal) : null;
  const shortOn = goal.genres.filter(short);
  const genreName = (id: string) => names.genres[s.deck][id] ?? id;
  return (
    <fieldset className="space-y-2" data-testid="setting-genres">
      <legend className="text-sm font-semibold">Genres to collect</legend>
      {s.deck === 'films' && editable && (
        <div className="flex flex-wrap gap-2">
          {FILM_PRESETS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={preset === id}
              onClick={() => send({ goal: id })}
              data-testid={`preset-${id}`}
              className={cn(
                'min-h-9 rounded-full px-3 text-xs ring-1',
                preset === id
                  ? 'bg-accent-soft font-semibold ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500'
                  : 'ring-line hover:bg-card dark:ring-stone-700 dark:hover:bg-stone-800',
              )}
            >
              {PRESET_LABELS[id]}
            </button>
          ))}
        </div>
      )}
      <ul className="flex flex-wrap gap-2" aria-label="Genres">
        {genresOf(s.deck).map((g) => {
          const on = goal.genres.includes(g.id);
          const low = on && short(g.id);
          return (
            <li key={g.id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!editable}
                onClick={() => toggle(g.id)}
                data-testid={`genre-${g.id}`}
                title={
                  low
                    ? `Only ${counts?.[g.id] ?? 0} in the chosen packs (needs ${need})`
                    : undefined
                }
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-sm ring-1 transition',
                  on
                    ? 'bg-card font-semibold ring-2 ring-ink/30 dark:bg-stone-800 dark:ring-stone-400'
                    : 'text-ink-muted ring-line hover:bg-card dark:ring-stone-700 dark:hover:bg-stone-800',
                  low && 'ring-warn-line dark:ring-amber-500',
                  !editable && 'cursor-default',
                )}
              >
                <span
                  aria-hidden
                  className={cn('h-5 w-3 shrink-0 rounded-sm', !on && 'opacity-35')}
                  style={{ background: g.colour }}
                />
                <span>{genreName(g.id)}</span>
                {low && (
                  <span className="rounded bg-warn-soft px-1 text-[11px] font-bold text-warn-ink dark:bg-amber-500/20 dark:text-amber-100">
                    ⚠ {counts?.[g.id] ?? 0}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {editable && (
        <Pills
          label="How many of each"
          value={goal.each}
          editable
          onPick={(each) => send({ each: each as 1 | 2 })}
          options={[
            { id: 1, name: '1 of each' },
            { id: 2, name: '2 of each', help: 'A longer game' },
          ]}
          testId="setting-each"
        />
      )}
      <p className="text-sm font-semibold" data-testid="goal-line">
        {goalLine(goal)}
      </p>
      {shortOn.length > 0 && (
        <p
          role="status"
          data-testid="genre-short"
          className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/40"
        >
          Too few {nounOf(s.deck, true)} in {shortOn.map(genreName).join(', ')}: each genre needs{' '}
          {need} in the chosen packs. Add packs or turn {shortOn.length > 1 ? 'those genres' : 'it'}{' '}
          off to start.
        </p>
      )}
      {editable && goal.genres.length <= MIN_GENRES && (
        <p className="text-xs text-ink-muted">At least {MIN_GENRES} genres stay on.</p>
      )}
      <RefusalSlot anchor="cl-genres" />
    </fieldset>
  );
}

/** The two teams, with join buttons and the host's shuffle. */
export function Teams({
  view,
  room,
  act,
  online,
}: {
  view: CliffhangerView;
  room: GameRoomInfo;
  act: Act;
  online: (id: string) => boolean;
}) {
  const { names } = useArt();
  const lobby = view.phase !== 'playing';
  const seated = view.seats.filter((s) => s.team).length;
  const watching = view.seats.filter((s) => !s.team);
  const mine = view.myTeam;
  const join = (team: TeamId | null) => void act({ type: 'team', team }, { anchor: 'cl-team' });
  return (
    <section id={SEAT_CONTROL_ID} tabIndex={-1} aria-label="Teams" className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {TEAMS.map((t) => {
          const members = view.seats.filter((s) => s.team === t);
          return (
            <div key={t} data-testid={`team-${t}`} className="min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-1">
                <TeamChip team={t} />
                <span className="text-xs text-ink-muted tabular-nums">{members.length}</span>
              </div>
              <ul className="space-y-1 text-sm">
                {members.map((m) => (
                  <li key={m.id} className="flex min-w-0 items-center gap-1">
                    <Who view={view} id={m.id} hostId={room.hostId} online={online} />
                    {m.onCall && (
                      <span title="On a call" aria-label="on a call">
                        🎧
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {mine !== t && (lobby || mine === null) && (
                <Button
                  size="sm"
                  variant={mine ? 'secondary' : 'primary'}
                  className="w-full"
                  disabled={!mine && seated >= MAX_PLAYERS}
                  data-testid={`join-${t}`}
                  onClick={() => join(t)}
                >
                  {mine ? 'Switch' : 'Join'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <RefusalSlot anchor="cl-team" />
      {watching.length > 0 && (
        <p className="text-sm text-ink-muted">
          Watching:{' '}
          {watching.map((w, i) => (
            <span key={w.id}>
              {i > 0 && ', '}
              <Who view={view} id={w.id} hostId={room.hostId} online={online} />
            </span>
          ))}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {mine && lobby && (
          <Button size="sm" variant="ghost" onClick={() => join(null)}>
            Just watch
          </Button>
        )}
        {room.isHost && lobby && (
          <Button size="sm" variant="secondary" onClick={() => void act({ type: 'shuffle-teams' })}>
            🔀 Shuffle teams
          </Button>
        )}
      </div>
      {view.me && (
        <Switch
          on={view.me.onCall}
          editable
          title="I’m on a call"
          help={`Can’t be seen? Your Act It squares become ${names.styles[view.settings.actAlt ?? 'describe-badly']}.`}
          onChange={(v) => void act({ type: 'on-call', onCall: v })}
          testId="on-call"
        />
      )}
    </section>
  );
}

export function Lobby({
  view,
  room,
  act,
  status,
  blocker,
  online,
  showGuide,
  sound,
}: {
  view: CliffhangerView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  blocker: string | null;
  online: (id: string) => boolean;
  showGuide: () => void;
  sound: ReactNode;
}) {
  const { names } = useArt();
  const title = room.gameName ?? names.title;
  const editable = room.isHost;
  const s = view.settings;
  const set = (patch: Omit<Extract<CliffhangerAction, { type: 'update-settings' }>, 'type'>) =>
    void act({ type: 'update-settings', ...patch });
  const kinds = KINDS[s.deck];
  const noun = nounOf(s.deck, true);
  const picker = (kind: PackKind, label: string, unit: string) => {
    const packs = view.packs.filter((p) => p.kind === kind);
    return (
      <ChoicePicker
        selectedIds={s.packIds.filter((id) => packs.some((p) => p.id === id))}
        editable={editable}
        onSave={(ids) =>
          act({
            type: 'update-settings',
            packIds: [...s.packIds.filter((id) => !packs.some((p) => p.id === id)), ...ids],
          })
        }
        choices={packs.map((p): Choice => ({ id: p.id, name: p.name, count: p.count }))}
        labels={{
          title: label,
          unit,
          noun: 'pack',
          change: `Change ${label.toLowerCase()}`,
          summary: (chosen, total) =>
            packs.length === 0
              ? 'None yet. Ask an admin to add a pack.'
              : chosen.length === 0
                ? 'Pick at least one pack.'
                : `${total} ${unit} from ${chosen.length === 1 ? 'one pack' : `${chosen.length} packs`}.`,
        }}
      />
    );
  };
  const toggleStyle = (id: StyleId) => {
    const on = s.mixStyles.includes(id);
    set({ mixStyles: on ? s.mixStyles.filter((x) => x !== id) : [...s.mixStyles, id] });
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Panel>
        <Teams view={view} room={room} act={act} online={online} />
      </Panel>
      <LobbySettings editable={editable} summary={settingsSummary(view)} className="space-y-4">
        {editable && <h3 className="text-lg font-bold">Game settings</h3>}
        <Pills
          label="Deck"
          value={s.deck}
          editable={editable}
          onPick={(deck) => set({ deck })}
          options={[
            { id: 'films', name: '🎬 Films' },
            { id: 'tv', name: '📺 TV shows', help: 'One of each of 8 genres' },
          ]}
          testId="setting-deck"
        />
        <Pills
          label="How are you playing?"
          value={s.mode}
          editable={editable}
          onPick={(mode) => set({ mode })}
          options={MODE_IDS.map((id) => ({
            id,
            name: MODES[id].name,
            help: modeBlurb(id, s.actAlt),
          }))}
          testId="setting-mode"
        />
        {(s.mode !== 'mix' || s.mixStyles.includes('act')) && (
          <Pills
            label={
              s.mode === 'voice'
                ? 'Instead of Act It (the third square)'
                : 'Instead of Act It, for anyone on a call'
            }
            value={s.actAlt ?? 'describe-badly'}
            editable={editable}
            onPick={(actAlt) => set({ actAlt })}
            options={ACT_ALTS.map((id) => ({
              id,
              name: `${STYLES[id].emoji} ${names.styles[id]}`,
              help: id === 'cast' ? 'Name actors who are in it' : 'A terrible but true plot',
            }))}
            testId="setting-act-alt"
          />
        )}
        {s.mode === 'mix' && (
          <fieldset>
            <legend className="text-sm font-semibold">Styles in the mix</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {STYLE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={s.mixStyles.includes(id)}
                  disabled={!editable}
                  onClick={() => toggleStyle(id)}
                  className={cn(
                    'min-h-11 rounded-lg px-3 text-sm ring-1',
                    s.mixStyles.includes(id)
                      ? 'bg-accent-soft font-semibold ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500'
                      : 'ring-line dark:ring-stone-700',
                  )}
                >
                  {STYLES[id].emoji} {names.styles[id]}
                </button>
              ))}
            </div>
            <Switch
              on={s.mixFresh}
              editable={editable}
              title="Fresh styles each round"
              help="Deal three of the ticked styles anew every round."
              onChange={(v) => set({ mixFresh: v })}
            />
          </fieldset>
        )}
        <GenrePicker view={view} editable={editable} act={act} />
        {picker(kinds.cards, s.deck === 'tv' ? 'Shows' : 'Films', noun)}
        {picker(kinds.categories, 'Face-off categories', 'categories')}
        <details className="group">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm [&::-webkit-details-marker]:hidden">
            <span>
              <span className="font-semibold">Clocks and extra rules</span>
              <span className="text-ink-muted">
                {' '}
                · {s.answerSeconds} s / {s.turnSeconds} s
              </span>
            </span>
            <span aria-hidden className="text-ink-muted transition group-open:rotate-90">
              ▸
            </span>
          </summary>
          <div className="space-y-3 pt-2">
            <Pills
              label="Face-off answer clock"
              value={s.answerSeconds}
              editable={editable}
              onPick={(answerSeconds) => set({ answerSeconds })}
              options={ANSWER_SECONDS.map((n) => ({ id: n, name: `${n} s` }))}
            />
            <Pills
              label="Describing turn"
              value={s.turnSeconds}
              editable={editable}
              onPick={(turnSeconds) => set({ turnSeconds })}
              options={TURN_SECONDS.map((n) => ({ id: n, name: `${n} s` }))}
            />
            <Switch
              on={s.noSequels}
              editable={editable}
              title="No sequels"
              help="In the face-off, once a film from a series is said, the rest of that series is off the table."
              tag="extra rule"
              tagTone="special"
              onChange={(v) => set({ noSequels: v })}
              testId="setting-no-sequels"
            />
            <Switch
              on={s.newWordsOnly}
              editable={editable}
              title="New words only"
              help="In One Word and Quote It, no word from the title."
              tag="extra rule"
              tagTone="special"
              onChange={(v) => set({ newWordsOnly: v })}
              testId="setting-new-words"
            />
            <Switch
              on={s.noAdvantage}
              editable={editable}
              title="No advantage"
              help="Both face-off players get five and keep three."
              tag="house rule"
              tagTone="special"
              onChange={(v) => set({ noAdvantage: v })}
            />
            <Switch
              on={s.comebackPick}
              editable={editable}
              title="Comeback pick"
              help="The team with fewer genres picks the face-off category from two."
              tag="house rule"
              tagTone="special"
              onChange={(v) => set({ comebackPick: v })}
            />
            <Switch
              on={s.suddenDeath}
              editable={editable}
              title="Sudden death"
              help="Both teams one genre away: the next face-off wins the game."
              tag="house rule"
              tagTone="special"
              onChange={(v) => set({ suddenDeath: v })}
            />
            <Switch
              on={s.openingClock}
              editable={editable}
              title="Opening clock"
              help="Someone must answer within 15 s of the flip, or a new category comes up."
              tag="house rule"
              tagTone="special"
              onChange={(v) => set({ openingClock: v })}
            />
            <Switch
              on={s.timerMode === 'strict'}
              editable={editable}
              title="Strict decisions"
              help="The category pick and the 3-for-1 steal decide by themselves when their clock ends."
              onChange={(v) => set({ timerMode: v ? 'strict' : 'soft' })}
            />
          </div>
        </details>
      </LobbySettings>
      {sound}
      {editable && (
        <StickyBar>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="lg"
              disabled={blocker !== null}
              data-testid="start"
              onClick={() => void act({ type: 'start' }, { anchor: 'cl-start' })}
            >
              Start game
            </Button>
            {blocker && <span className="text-sm text-ink-muted">{blocker}</span>}
          </div>
          <RefusalSlot anchor="cl-start" />
        </StickyBar>
      )}
      <Button variant="secondary" size="lg" className="w-full" onClick={showGuide}>
        📖 New to {title}? Read the guide
      </Button>
    </div>
  );
}
