import type { PlayerColor } from '@vt/game-sdk';
import { type ReactNode, useState } from 'react';
import { cn } from './cn.ts';
import {
  Badge,
  Button,
  type ButtonVariant,
  Card,
  Chip,
  Chips,
  Field,
  Fold,
  Hint,
  Input,
  Notice,
  type NoticeTone,
  Panel,
  Row,
  RowButton,
  Rows,
  Select,
  Slate,
  Stepper,
  type TagTone,
  buttonClass,
} from './components.tsx';
import { GameCard } from './game-card.tsx';
import { Icon } from './icon.tsx';
import { LobbySettings } from './lobby-settings.tsx';
import { BotNames, PlayerTag } from './people.tsx';
import { PlayerColors } from './player-colors.tsx';
import { Switch } from './switch.tsx';
import { TabBar, Tabs } from './tabs.tsx';
import { TimerSettings, type TimerValues } from './timer-settings.tsx';
import { WordListPicker } from './word-list-picker.tsx';

/*
 * The component sheet: every shared part in every state, for the unit test that measures contrast
 * and target sizes and the screenshot spec (e2e/component-sheet.spec.ts). Not part of any page a
 * player sees.
 */

/**
 * The plain forms of the classes `forceState` makes. Tailwind builds only the classes it finds
 * written in the source, so they are listed here word for word.
 */
export const FORCED_CLASSES = [
  'bg-accent-hover bg-panel bg-accent-soft border-accent shadow-vt-1 motion-safe:scale-[0.98]',
  'outline-3 outline-offset-2 outline-focus',
  'bg-[color-mix(in_oklab,var(--vt-danger)_86%,black)]',
  'bg-[color-mix(in_oklab,var(--vt-team-a)_86%,black)]',
  'bg-[color-mix(in_oklab,var(--vt-team-b)_86%,black)]',
];

/**
 * Turns a part's `hover:` (or `focus-visible:`, `active:`) classes into plain ones, so the sheet
 * can show that state without a pointer or a keyboard.
 */
export function forceState(classes: string, state: 'hover' | 'focus' | 'active') {
  const prefix = state === 'focus' ? 'focus-visible:' : `${state}:`;
  const kept = classes
    .split(/\s+/)
    .map((c) => {
      const motion = c.startsWith('motion-safe:') ? 'motion-safe:' : '';
      const rest = c.slice(motion.length);
      return rest.startsWith(prefix) ? rest.slice(prefix.length) : c;
    })
    .join(' ');
  return cn(kept);
}

export const SHEET_VARIANTS: readonly ButtonVariant[] = [
  'primary',
  'secondary',
  'tint',
  'quiet',
  'danger',
  'team-a',
  'team-b',
];
export const SHEET_TAGS: readonly TagTone[] = [
  'neutral',
  'accent',
  'info',
  'warn',
  'success',
  'danger',
  'special',
];
export const SHEET_NOTICES: readonly NoticeTone[] = ['info', 'warn', 'danger', 'success'];

const COLORS = new Map<string, PlayerColor>([
  ['Hana', 'purple'],
  ['Gil', 'teal'],
  ['Tom', 'orange'],
  ['Bot Mei', 'green'],
]);

const LABEL: Record<ButtonVariant, string> = {
  primary: 'Start game',
  secondary: 'Change setup',
  tint: 'Create a room',
  quiet: 'How to play',
  danger: 'Leave room',
  'team-a': 'Join Red',
  'team-b': 'Join Blue',
  ghost: 'Ghost',
  soft: 'Soft',
  red: 'Red',
  blue: 'Blue',
};

/** One named example on the sheet. */
function Specimen({ name, children, wide }: { name: string; children: ReactNode; wide?: boolean }) {
  return (
    <figure
      data-specimen={name}
      className={cn('grid min-w-0 content-start gap-1', wide && 'w-full')}
    >
      {children}
      <figcaption className="text-caption text-ink-muted">
        {name.split('/').slice(1).join(' · ')}
      </figcaption>
    </figure>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <h2 className="text-caption font-semibold tracking-[0.08em] text-ink-2 uppercase">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

function Buttons() {
  return (
    <Group title="Buttons">
      {SHEET_VARIANTS.map((v) => (
        <div key={v} className="flex w-full flex-wrap items-start gap-3">
          <Specimen name={`button/${v}/rest`}>
            <Button variant={v}>{LABEL[v]}</Button>
          </Specimen>
          {(['hover', 'active', 'focus'] as const).map((s) => (
            <Specimen key={s} name={`button/${v}/${s === 'active' ? 'pressed' : s}`}>
              <button
                type="button"
                data-ui="button"
                className={forceState(buttonClass({ variant: v }), s)}
              >
                {LABEL[v]}
              </button>
            </Specimen>
          ))}
          <Specimen name={`button/${v}/disabled`}>
            <Button variant={v} disabled>
              {LABEL[v]}
            </Button>
          </Specimen>
          <Specimen name={`button/${v}/sending`}>
            <Button variant={v} sending>
              {LABEL[v]}
            </Button>
          </Specimen>
        </div>
      ))}
      <Specimen name="button/size/sm">
        <Button size="sm">Small</Button>
      </Specimen>
      <Specimen name="button/size/md">
        <Button>Regular</Button>
      </Specimen>
      <Specimen name="button/size/lg">
        <Button size="lg">Large</Button>
      </Specimen>
      <Specimen name="button/size/icon">
        <Button variant="quiet" size="icon" aria-label="Close">
          <Icon name="x" />
        </Button>
      </Specimen>
      <Specimen name="button/size/short">
        <Button size="sm" variant="secondary">
          OK
        </Button>
      </Specimen>
    </Group>
  );
}

function Inputs() {
  const [count, setCount] = useState(3);
  return (
    <Group title="Inputs">
      <Specimen name="input/text/rest" wide>
        <Field label="Your name" help="Shown to everyone in the room.">
          <Input defaultValue="Hana" />
        </Field>
      </Specimen>
      <Specimen name="input/text/placeholder" wide>
        <Field label="Empty">
          <Input placeholder="Your name" />
        </Field>
      </Specimen>
      <Specimen name="input/text/focus" wide>
        <Field label="Focused">
          <Input
            defaultValue="Hana"
            className="border-focus outline-3 outline-offset-2 outline-focus"
          />
        </Field>
      </Specimen>
      <Specimen name="input/text/error" wide>
        <Field label="Your clue, one word" error="One word only.">
          <Input invalid defaultValue="ice cream" />
        </Field>
      </Specimen>
      <Specimen name="input/text/disabled" wide>
        <Field label="Disabled">
          <Input disabled defaultValue="Host chooses" />
        </Field>
      </Specimen>
      <Specimen name="input/text/read-only" wide>
        <Field label="Read-only">
          <Input readOnly defaultValue="Starter words" />
        </Field>
      </Specimen>
      <Specimen name="input/select/rest" wide>
        <Field label="Word list">
          <Select defaultValue="starter">
            <option value="starter">Starter words</option>
            <option value="more">More words</option>
          </Select>
        </Field>
      </Specimen>
      <Specimen name="input/select/disabled" wide>
        <Field label="Word list (guest)">
          <Select disabled defaultValue="starter">
            <option value="starter">Starter words</option>
          </Select>
        </Field>
      </Specimen>
      <Specimen name="input/stepper/rest">
        <Stepper label="Agents" value={count} onChange={setCount} min={1} max={9} />
      </Specimen>
      <Specimen name="input/stepper/at-min">
        <Stepper label="Clue number" value={1} onChange={() => {}} min={1} max={9} />
      </Specimen>
      <Specimen name="input/stepper/disabled">
        <Stepper label="Rounds" value={5} onChange={() => {}} disabled />
      </Specimen>
    </Group>
  );
}

function Toggles() {
  return (
    <Group title="Switches and chips">
      <Specimen name="switch/on" wide>
        <Switch
          on
          editable
          title="Turn timer"
          help="A reminder when a turn runs long."
          onChange={() => {}}
        />
      </Specimen>
      <Specimen name="switch/off" wide>
        <Switch
          on={false}
          editable
          title="Strict timer"
          help="At zero the move is made for you."
          tag="ends turns"
          onChange={() => {}}
        />
      </Specimen>
      <Specimen name="switch/locked-on" wide>
        <Switch
          on
          editable={false}
          title="Narration"
          help="Only the host can change this."
          onChange={() => {}}
        />
      </Specimen>
      <Specimen name="switch/locked-off" wide>
        <Switch
          on={false}
          editable={false}
          title="Expansion"
          help="Only the host can change this."
          tag="community"
          tagTone="special"
          onChange={() => {}}
        />
      </Specimen>
      <Specimen name="chips/strip" wide>
        <Chips label="Filter games by category">
          <Chip pressed>All</Chip>
          <Chip pressed={false}>
            <span aria-hidden>🎭</span> Bluffing
          </Chip>
          <Chip pressed={false}>
            <span aria-hidden>👥</span> Teams
          </Chip>
          <Chip pressed={false} className={forceState('hover:bg-panel', 'hover')}>
            Hover
          </Chip>
          <Chip pressed={false} disabled>
            Unavailable
          </Chip>
        </Chips>
      </Specimen>
      <Specimen name="tags/all" wide>
        <span className="flex flex-wrap gap-2">
          {SHEET_TAGS.map((t) => (
            <Badge key={t} tone={t}>
              {t}
            </Badge>
          ))}
        </span>
      </Specimen>
    </Group>
  );
}

function Messages() {
  return (
    <Group title="Notices and slates">
      {SHEET_NOTICES.map((t) => (
        <Specimen key={t} name={`notice/${t}`} wide>
          <Notice tone={t} icon>
            {
              {
                info: 'New here? Hold your notebook to read the word.',
                warn: "Time's up. Finish up when you can.",
                danger: 'That move is not allowed now.',
                success: 'Correct! Marble was a Blue agent.',
              }[t]
            }
          </Notice>
        </Specimen>
      ))}
      <Specimen name="notice/hint-neutral" wide>
        <Hint>Pick a card from your hand.</Hint>
      </Specimen>
      <Specimen name="notice/hint-action" wide>
        <Hint tone="action">Your turn: give a clue.</Hint>
      </Specimen>
      <Specimen name="slate/empty" wide>
        <Slate icon="armchair" title="Nobody here yet">
          Share the link and they'll appear.
        </Slate>
      </Specimen>
      <Specimen name="slate/error" wide>
        <Slate
          kind="error"
          icon="wifi-off"
          title="Can't reach the tavern"
          action={
            <Button variant="secondary" size="sm">
              Reload
            </Button>
          }
        >
          Retrying every few seconds.
        </Slate>
      </Specimen>
      <Specimen name="slate/loading" wide>
        <Slate kind="loading" title="Setting the table…">
          Finding your room.
        </Slate>
      </Specimen>
    </Group>
  );
}

function Navigation() {
  const [tab, setTab] = useState('scores');
  const [bar, setBar] = useState('play');
  return (
    <Group title="Tabs">
      <Specimen name="tabs/strip" wide>
        <Tabs
          id="sheet-tabs"
          label="The end"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'scores', label: '🏆 Scores' },
            { id: 'awards', label: '✨ Awards' },
            { id: 'rounds', label: 'Rounds', count: 8 },
            { id: 'hands', label: 'Hands' },
            { id: 'recap', label: 'Recap', disabled: true },
          ]}
        />
      </Specimen>
      <Specimen name="tabbar/inline" wide>
        <TabBar
          id="sheet-bar"
          label="Game"
          fixed={false}
          value={bar}
          onChange={setBar}
          items={[
            { id: 'play', label: 'Play', icon: 'layout-grid' },
            { id: 'clues', label: 'Clues', icon: 'scroll-text' },
            { id: 'chat', label: 'Chat', icon: 'message-circle' },
          ]}
        />
      </Specimen>
    </Group>
  );
}

function Surfaces() {
  return (
    <Group title="Surfaces, rows and people">
      <Specimen name="surface/panel" wide>
        <Panel>
          <p className="font-semibold">Settings</p>
          <p className="text-caption text-ink-muted">A panel groups; it has no shadow.</p>
        </Panel>
      </Specimen>
      <Specimen name="surface/card" wide>
        <Card>
          <p className="font-semibold">A card</p>
          <p className="text-small text-ink-2">Stands on its own, lit from above.</p>
        </Card>
      </Specimen>
      <Specimen name="surface/fold-closed" wide>
        <Fold summary={<span className="font-semibold text-ink">Sound</span>}>
          <p>Volume sliders go here.</p>
        </Fold>
      </Specimen>
      <Specimen name="surface/fold-open" wide>
        <LobbySettings editable summary={['2 min turns', 'strict', 'narration on']}>
          <p className="text-small">The settings themselves.</p>
        </LobbySettings>
      </Specimen>
      <Specimen name="rows/people" wide>
        <Card className="px-4 py-0">
          <Rows>
            <Row>
              <PlayerTag name="Hana" host className="flex-1" />
              <Badge>you</Badge>
            </Row>
            <Row me>
              <PlayerTag name="Gil" you className="flex-1" />
              <RowButton>Make host</RowButton>
              <RowButton danger>Remove</RowButton>
            </Row>
            <Row>
              <PlayerTag name="Tom" offline className="flex-1" />
              <Badge>away 2 min</Badge>
            </Row>
            <Row>
              <PlayerTag name="Bot Mei" className="flex-1" />
              <RowButton disabled>Make host</RowButton>
            </Row>
          </Rows>
        </Card>
      </Specimen>
    </Group>
  );
}

function Games({ cover }: { cover?: string }) {
  return (
    <Group title="Game cards">
      <Specimen name="game-card/emblem">
        <GameCard
          className="max-w-sm"
          emblem="🕵️"
          name="Codenames"
          meta="4 or more · 15–20 minutes"
          tagline="Two teams race to find their secret agents using one-word clues."
          onCreate={() => {}}
          howToPlay={
            <a href="#how" className={buttonClass({ variant: 'quiet' })}>
              How to play
            </a>
          }
        />
      </Specimen>
      <Specimen name="game-card/creating">
        <GameCard
          className="max-w-sm"
          emblem="🔔"
          name="Echo"
          meta="3 to 7 · 15–30 minutes"
          tagline="Everyone gives a one-word clue; matching clues vanish."
          creating
          onCreate={() => {}}
        />
      </Specimen>
      {cover && (
        <Specimen name="game-card/cover">
          <GameCard
            className="max-w-sm"
            emblem="💎"
            name="Jeweller"
            meta="2 to 4 · 30 minutes"
            tagline="Take gems, buy cards and win the nobles over."
            cover={{ src: cover, dimInDark: true }}
            onCreate={() => {}}
          />
        </Specimen>
      )}
    </Group>
  );
}

function Settings() {
  const [timers, setTimers] = useState<TimerValues>({
    clueSeconds: 60,
    guessSeconds: null,
    timerMode: 'soft',
  });
  return (
    <Group title="Shared settings">
      <Specimen name="settings/timers" wide>
        <TimerSettings
          values={timers}
          editable
          onChange={(p) => setTimers((t) => ({ ...t, ...p }))}
          clueHelp="How long the Spymaster has."
          guessHelp="How long the team has."
          strictHelp="the turn passes"
        />
      </Specimen>
      <Specimen name="settings/word-lists" wide>
        <WordListPicker
          editable
          selectedIds={['starter']}
          wordLists={[
            {
              id: 'starter',
              name: 'Starter words',
              wordCount: 400,
              description: 'Everyday words.',
            },
            { id: 'more', name: 'More words', wordCount: 250 },
          ]}
          onSave={() => Promise.resolve(true)}
        />
      </Specimen>
    </Group>
  );
}

/** Every part in every state, in one column on phones. */
export function ComponentSheet({ cover }: { cover?: string }) {
  return (
    <PlayerColors.Provider value={COLORS}>
      <BotNames.Provider value={new Set(['Bot Mei'])}>
        <div data-testid="component-sheet" className="grid gap-8">
          <Buttons />
          <Inputs />
          <Toggles />
          <Messages />
          <Navigation />
          <Surfaces />
          <Games cover={cover} />
          <Settings />
        </div>
      </BotNames.Provider>
    </PlayerColors.Provider>
  );
}
