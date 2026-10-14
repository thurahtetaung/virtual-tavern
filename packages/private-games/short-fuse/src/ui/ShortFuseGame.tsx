import { type GameRoomInfo, type GameUiProps, namesWithPresence } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  Modal,
  RefusalSlot,
  cn,
  useRefusalWording,
  useSpectatorPrompt,
} from '@vt/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CARDS, type CardType, NAMEABLE, isCat } from '../logic/cards.ts';
import { comboOf } from '../logic/game.ts';
import {
  type CardView,
  type GameView,
  NUDGE_MS,
  type ShortFuseAction,
  type ShortFuseView,
} from '../logic/types.ts';
import { type Content, contentFor, useManifest } from './assets.ts';
import { CardFace } from './Card.tsx';
import { End } from './End.tsx';
import { playSfx, useBuzz } from './fx.ts';
import { Hand } from './Hand.tsx';
import { AdultBadge, Lobby } from './Lobby.tsx';
import { Log, MeTab } from './Log.tsx';
import { Pile } from './Pile.tsx';
import { Seats } from './Seats.tsx';
import {
  AlterSheet,
  BlindPickSheet,
  BlindSlots,
  BombStrip,
  DigSheet,
  Inspector,
  PeekSheet,
  PickSheet,
  PlaceSheet,
  SearchSheet,
  TargetSheet,
  cardHint,
  precious,
} from './Sheets.tsx';
import { useSoundSetting, useTips } from './storage.ts';
import { ShortFuseStyles } from './styles.tsx';
import { amGhost, amIn, an, logLine, playNow, statusFor, who } from './text.ts';
import { NopePanel } from './Window.tsx';

type Props = GameUiProps<ShortFuseView, ShortFuseAction>;
type Act = Props['act'];
type Tab = 'table' | 'log' | 'me';
/** Who a targeted play may pick: anyone with cards to take, anyone at all, or a special rule. */
type Need = 'steal' | 'any' | 'mark' | 'mine' | 'ghost';

/** What the selected cards would do if played now, or why they can't be. */
function selectionPlan(
  g: GameView,
  me: string,
  cards: CardView[],
): { label: string; needsTarget: Need | null; named: boolean } | { why: string } | null {
  if (!cards.length) return null;
  let types = cards.map((c) => c.t);
  // A Copy becomes the top card of the discard pile (alone, or to pair with that cat).
  if (types.includes('copy')) {
    const as = g.copyAs;
    if (!as)
      return {
        why: 'A {c:copy} becomes the top card of the discard pile, and that one can’t be copied now (not another {c:copy}, a {c:revive}, or a cat someone else played).',
      };
    const cat = isCat(as) || as === 'wild';
    if (types.length > 2) return { why: 'A {c:copy} pairs with one cat at most.' };
    if (types.length === 1 && cat)
      return { why: 'A {c:copy} of a cat does nothing alone: pick the matching cat too.' };
    if (types.length === 2 && !cat) return { why: 'A {c:copy} only makes a pair with a cat.' };
    types = types.map((t) => (t === 'copy' ? as : t));
  }
  const combo = comboOf(types, g.fiveCombo);
  if ('error' in combo) return { why: combo.error };
  const ghosts = g.players.some((p) => p.ghost);
  if (combo.kind === 'card') {
    const t = combo.t!;
    const info = CARDS[t];
    if (!info.playable)
      return {
        why:
          t === 'nope'
            ? '{c:nope} is played during the countdown after someone else’s play.'
            : t === 'defuse'
              ? '{c:defuse} is used for you when you draw a {c:bomb}.'
              : t === 'revive'
                ? '{c:revive} is used for you when you draw a {c:bomb}: keep it.'
                : t === 'seer'
                  ? '{c:seer} is played in the countdown after someone’s {c:revive}.'
                  : t === 'shelter'
                    ? 'It works from your hand: just keep it.'
                    : t === 'bomb' || t === 'void'
                      ? 'You can’t play that one.'
                      : 'A cat does nothing alone: pick two with the same name.',
      };
    if (info.ghosts && !ghosts)
      return { why: 'Nobody is a ghost yet: this card needs one at the table.' };
    if (t === 'feed') return { label: 'on…', needsTarget: 'ghost', named: false };
    if (t === 'twin')
      return cards.length === 2
        ? { label: 'twins', needsTarget: 'any', named: false }
        : { label: '', needsTarget: null, named: false };
    if (t === 'bury' && g.players.find((p) => p.id === me)?.mine)
      return { why: '{c:bury} is blocked while a {c:mine} is in front of you.' };
    if (info.targeted)
      return {
        label: 'on…',
        needsTarget:
          t === 'favor' ? 'steal' : t === 'mark' ? 'mark' : t === 'mine' ? 'mine' : 'any',
        named: false,
      };
    return { label: '', needsTarget: null, named: false };
  }
  if (combo.kind === 'pair') return { label: 'pair', needsTarget: 'steal', named: false };
  if (combo.kind === 'triple') return { label: 'triple', needsTarget: 'steal', named: true };
  void me;
  return { label: 'five', needsTarget: null, named: false };
}

/** Who a targeted play may pick. */
function targetsFor(g: GameView, me: string, need: Need): string[] {
  // Feed the Ghosts goes to a ghost, the player's own ghost included.
  if (need === 'ghost') return g.players.filter((p) => p.ghost).map((p) => p.id);
  return g.players
    .filter(
      (p) =>
        p.id !== me &&
        !p.dead &&
        !p.left &&
        (need === 'any' ||
          (need === 'steal' && (p.hand > 0 || (p.stash ?? 0) > 0)) ||
          (need === 'mark' && p.hand > 0) ||
          (need === 'mine' && !p.mine)),
    )
    .map((p) => p.id);
}

/** The cards a blindfolded player has turned over and lost in the search under way. */
function searchLost(g: GameView, me: string): CardType[] {
  const out: CardType[] = [];
  for (let i = g.log.length - 1; i >= 0; i--) {
    const e = g.log[i]!;
    if (e.kind !== 'lost' || e.by !== me) break;
    if (e.cards?.[0]) out.unshift(e.cards[0]);
  }
  return out;
}

/** "Waiting on" chips: nudge whoever we wait for; the host can act for an absent player. */
function WaitingChips({
  view,
  room,
  act,
  now,
}: {
  view: ShortFuseView;
  room: GameRoomInfo;
  act: Act;
  now: number;
}) {
  const g = view.game!;
  const ids = g.waiting;
  if (!ids.length || view.phase !== 'playing' || (ids.length === 1 && ids[0] === view.me?.id))
    return null;
  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto text-xs whitespace-nowrap [scrollbar-width:none]"
      data-testid="waiting-on"
    >
      <span className="shrink-0 font-semibold text-ink-muted">Waiting on:</span>
      {ids.map((id) => {
        const online = room.players.find((p) => p.id === id)?.connected ?? false;
        const mine = id === view.me?.id;
        const recently = (g.nudges[id] ?? 0) + NUDGE_MS > now;
        const late = g.decisionEnds !== null && now >= g.decisionEnds;
        return (
          <span
            key={id}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info-soft py-0.5 pr-1 pl-2 font-semibold text-info-ink ring-1 ring-info-line"
          >
            {mine ? 'you' : namesWithPresence([id], room.players) || who(view, id)}
            {!mine && online && amIn(view) && (
              <button
                type="button"
                disabled={recently}
                className="rounded-full px-1 disabled:opacity-40"
                aria-label={`Nudge ${who(view, id)}`}
                title="Nudge: buzz their phone"
                onClick={() => void act({ type: 'nudge', player: id })}
              >
                👋
              </button>
            )}
            {room.isHost && !mine && (!online || late) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                onClick={() => {
                  if (
                    window.confirm(
                      `Act for ${who(view, id)}? The safe move is made for them (draw, hide at random, keep the order or give a random card), and everyone is told.`,
                    )
                  )
                    void act({ type: 'act-for', player: id });
                }}
              >
                Act for
              </Button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function TabBar({
  tab,
  onChange,
  memory,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  memory: number;
}) {
  const items: [Tab, string][] = [
    ['table', '🃏 Table'],
    ['log', '📜 Log'],
    ['me', `🔒 Me${memory ? ` (${memory})` : ''}`],
  ];
  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-xl bg-panel p-1 ring-1 ring-line lg:hidden"
      role="tablist"
    >
      {items.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onChange(id)}
          className={cn(
            'min-h-9 rounded-lg text-sm font-semibold',
            tab === id ? 'bg-card text-ink shadow-sm ring-1 ring-line' : 'text-ink-muted',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The latest public event, as a short banner over the table. */
function LastAction({ view, c }: { view: ShortFuseView; c: Content }) {
  const e = view.game!.log.at(-1);
  if (!e) return null;
  return (
    <p
      key={e.id}
      className="sf-banner rounded-lg bg-panel px-2 py-1 text-xs leading-snug text-ink ring-1 ring-line sm:text-sm"
      data-testid="last-action"
    >
      {logLine(view, c, e)}
    </p>
  );
}

/** The first tip the viewer hasn't seen for what's happening now. */
function tipFor(
  view: ShortFuseView,
  c: Content,
  fresh: (id: string) => boolean,
): [string, string] | null {
  const g = view.game;
  if (!g || view.phase !== 'playing') return null;
  if (amGhost(view))
    return fresh('ghost')
      ? [
          'ghost',
          c.t(
            'You’re a ghost: no turns, but you keep your hand. Play {c:nope} and NOW cards (⚡) any time, and wait for someone’s {c:revive} to bring you back.',
          ),
        ]
      : null;
  if (!amIn(view)) return null;
  const mine = g.prompt?.kind === 'turn';
  const tips: [string, boolean, string][] = [
    [
      'bombs',
      mine,
      c.t(
        '{Bombs} explode when drawn, unless you play a {c:defuse}. Then you hide the {bomb} back in the pile.',
      ),
    ],
    [
      'nope',
      view.stage === 'window',
      c.t(
        'Anyone holding a {c:nope} can stop almost any play during this countdown, even off their turn.',
      ),
    ],
    [
      'owed',
      g.turn.owed > 1,
      'Attacked: the badge on a seat shows how many turns that player owes. Each draw ends one.',
    ],
    ['pile', mine, c.t('The pile always shows how many cards and {bombs} are left.')],
    [
      'pairs',
      mine,
      'Two cards with the same name make a pair: play them together to steal a random card.',
    ],
  ];
  tips.push(
    [
      'blind',
      g.blindCount !== null,
      c.t(
        'Blindfolded: your cards are face down and shuffled. Tap one to play it blind (it might be lost), or draw: a safe draw takes the blindfold off.',
      ),
    ],
    [
      'now',
      g.canNow && !mine,
      c.t('{c:alter3now} can be played even when it isn’t your turn: look for the ⚡ button.'),
    ],
    [
      'revive',
      mine && !!g.hand?.some((x) => x.t === 'revive'),
      c.t(
        'Your {c:revive} saves you from {c:bomb} like {c:defuse}; if anyone is a ghost, it brings one back too.',
      ),
    ],
    [
      'vault',
      g.players.some((p) => p.stash !== null),
      c.t('Anything stolen from whoever wears {c:vault} comes from their face-down Stash first.'),
    ],
  );
  const tip = tips.find(([id, when]) => when && fresh(id));
  return tip ? [tip[0], tip[2]] : null;
}

export function ShortFuseGame({ view, room, act, showGuide, setYourMove, setSpectator }: Props) {
  const manifest = useManifest();
  const g = view.game;
  const art = g?.art ?? view.settings.art;
  const c = useMemo(() => contentFor(manifest, art), [manifest, art]);
  const me = view.me?.id ?? '';
  const [sound, setSound] = useSoundSetting();
  const [fresh, dismissTip] = useTips();
  const [now, setNow] = useState(() => Date.now() + room.clockOffset);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + room.clockOffset), 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [room.clockOffset]);

  // Server refusals name cards with tokens (`{c:nope}`): fill them from the manifest.
  const word = useCallback((message: string) => c.t(message), [c]);
  useRefusalWording(word);

  const status = statusFor(view, c);
  useEffect(() => {
    setYourMove?.(view.phase === 'playing' && status.yourMove);
  }, [setYourMove, view.phase, status.yourMove]);
  const inGame = !!g?.players.some((p) => p.id === me);
  useSpectatorPrompt(
    setSpectator,
    view.phase === 'lobby'
      ? view.me && !view.me.playing
        ? {
            text: 'Take a seat to play.',
            actionLabel: 'Take a seat',
            action: () => void act({ type: 'sit', playing: true }),
          }
        : null
      : !inGame
        ? { text: 'You’re watching this game. You can sit down for the next one.' }
        : null,
  );

  // Your turn (or a decision of yours) buzzes, and chimes with sound on.
  const myKey = g && status.yourMove ? `${g.turn.n}:${view.stage}` : null;
  useBuzz(myKey);
  useBuzz(g?.nudges[me] ? String(g.nudges[me]) : null);
  useEffect(() => {
    if (myKey && sound) playSfx('turn');
  }, [myKey, sound]);
  const chain = g?.window?.chain.length ?? 0;
  useEffect(() => {
    if (chain > 0 && sound) playSfx('nope');
  }, [chain, sound]);
  const beatKey = g?.beat?.until ?? null;
  useEffect(() => {
    if (beatKey && sound) playSfx('boom');
  }, [beatKey, sound]);

  // The hand selection belongs to one moment of one turn.
  const selKey = g ? `${view.gamesPlayed}:${g.turn.n}:${view.stage}:${g.hand?.length ?? 0}` : '';
  const [sel, setSel] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
  const selected = useMemo(() => new Set(sel.key === selKey ? sel.ids : []), [sel, selKey]);
  const [picking, setPicking] = useState<{ key: string; named: CardType | null } | null>(null);
  const isPicking = picking?.key === selKey;
  const [inspect, setInspect] = useState<CardView | null>(null);
  const [tab, setTab] = useState<Tab>('table');
  const [discardOpen, setDiscardOpen] = useState(false);

  // A fresh peek opens its sheet once. Memory ids restart with every game, so the one already
  // seen is kept per game (this game's number stays the same through its end screen).
  const lastPeek = g?.memory.findLast((m) => m.kind === 'peek' || m.kind === 'shared') ?? null;
  const gameNo = view.gamesPlayed + (view.phase === 'over' ? 0 : 1);
  const [seenPeek, setSeenPeek] = useState(() => ({ game: gameNo, id: lastPeek?.id ?? 0 }));
  // Foresight: once the hiding is done, what you watched opens once (kept per game the same way).
  const lastWatch = g?.memory.findLast((m) => m.kind === 'watched') ?? null;
  const [seenWatch, setSeenWatch] = useState(() => ({ game: gameNo, id: lastWatch?.id ?? 0 }));
  // A shuffle animates the pile (and hides the face-up Black Hole) for a moment.
  const pileVersion = g?.pile.version ?? 0;
  const lastKind = g?.log.at(-1)?.kind;
  const [shuffle, setShuffle] = useState({ v: pileVersion, on: false });
  if (shuffle.v !== pileVersion) setShuffle({ v: pileVersion, on: lastKind === 'shuffle' });
  const shuffling = shuffle.on;
  useEffect(() => {
    if (!shuffling) return;
    const id = window.setTimeout(() => setShuffle((s) => ({ ...s, on: false })), 950);
    return () => {
      window.clearTimeout(id);
    };
  }, [shuffling, shuffle.v]);

  // Your hand's full-size faces (and the discard's top) first, so the deal shows its art at once;
  // the rest of the deck only ahead of time as small copies, which phones can afford.
  const firstFaces =
    g && c.ready
      ? [...new Set([...(g.hand ?? []), ...g.discard.slice(-1)].map((card) => c.face(card, g.art)))]
          .filter((src): src is string => !!src)
          .join('\n')
      : '';
  useEffect(() => {
    if (!firstFaces) return;
    const imgs = firstFaces.split('\n').map((src) => {
      const img = new Image();
      img.fetchPriority = 'high';
      img.decoding = 'async';
      img.src = src;
      return img;
    });
    return () => {
      imgs.length = 0;
    };
  }, [firstFaces]);

  // Load every face in this game ahead of time, so a play (in the Nope panel) shows its art at once.
  const preloadKey = g && c.ready ? `${g.art}:${g.types.join(',')}` : '';
  useEffect(() => {
    if (!preloadKey || !g) return;
    const imgs = g.types
      .flatMap((t) => c.thumbs(t, g.art))
      .map((src) => {
        const img = new Image();
        img.fetchPriority = 'low';
        img.decoding = 'async';
        img.src = src;
        return img;
      });
    return () => {
      imgs.length = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloadKey]);
  const [blindSlot, setBlindSlot] = useState<{ key: string; slot: number } | null>(null);

  if (view.phase === 'lobby' || !g) {
    return (
      <>
        <ShortFuseStyles />
        <Lobby view={view} room={room} c={c} act={act} showGuide={showGuide} />
      </>
    );
  }

  const hand = g.hand ?? [];
  const selCards = hand.filter((x) => selected.has(x.id));
  const plan = selectionPlan(g, me, selCards);
  const myTurn = g.prompt?.kind === 'turn';
  const nowOnly = !myTurn && g.canNow;
  const toggle = (card: CardView) => {
    if (!myTurn && !(nowOnly && CARDS[card.t].now)) {
      setInspect(card);
      return;
    }
    setPicking(null);
    setSel({
      key: selKey,
      ids: selected.has(card.id)
        ? [...selected].filter((x) => x !== card.id)
        : [...selected, card.id],
    });
  };
  const play = (target?: string, named?: CardType | null) => {
    const action: ShortFuseAction = {
      type: 'play',
      cards: selCards.map((x) => x.id),
      ...(target ? { target } : {}),
      ...(named ? { named } : {}),
    };
    setPicking(null);
    setSel({ key: '', ids: [] });
    void act(action, { anchor: 'play' });
  };
  const needs = plan && 'needsTarget' in plan ? plan.needsTarget : null;
  const targets = isPicking && needs ? targetsFor(g, me, needs) : null;
  const playLabel = (() => {
    if (!plan || 'why' in plan) return 'Play';
    const one = selCards[0]!;
    if (plan.label === 'pair') return 'Steal with the pair…';
    if (plan.label === 'triple') return 'Ask with three of a kind…';
    if (plan.label === 'five') return 'Play five different';
    if (plan.label === 'twins') return `Play both ${c.name('twin')} cards…`;
    if (one.t === 'copy' && g.copyAs)
      return `Play ${c.name('copy')} as ${c.name(g.copyAs)}${plan.needsTarget ? '…' : ''}`;
    return `Play ${c.name(one.t)}${plan.needsTarget ? '…' : ''}`;
  })();
  const tip = tipFor(view, c, fresh);
  const over = view.phase === 'over';
  const strict = view.settings.strict;
  const p = g.prompt;
  const peekOpen =
    lastPeek &&
    (seenPeek.game !== gameNo || lastPeek.id > seenPeek.id) &&
    (lastPeek.kind === 'peek' || lastPeek.kind === 'shared')
      ? lastPeek
      : null;
  const blast = g.beat?.kind === 'explode' ? g.beat : null;
  const watched =
    lastWatch &&
    view.stage !== 'place' &&
    (seenWatch.game !== gameNo || lastWatch.id > seenWatch.id)
      ? g.memory.filter(
          (m) => m.kind === 'watched' && (seenWatch.game !== gameNo || m.id > seenWatch.id),
        )
      : [];

  const table = (
    <div className="space-y-2">
      <div className="grid grid-cols-2 items-start justify-items-center gap-2 rounded-2xl bg-panel p-2.5 ring-1 ring-line sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:justify-items-start sm:gap-4 sm:p-3">
        <Pile pile={g.pile} c={c} art={g.art} shuffling={shuffling} />
        <button
          type="button"
          className="flex flex-col items-center gap-1 text-xs text-ink-muted"
          onClick={() => setDiscardOpen(true)}
          aria-label={`Discard pile (${g.discard.length} cards): browse`}
          data-testid="discard"
        >
          {g.discard.length ? (
            <CardFace card={g.discard.at(-1)!} art={g.art} c={c} size="md" />
          ) : (
            <span className="block aspect-[5/7] w-[4.75rem] rounded-[0.55rem] border-2 border-dashed border-line sm:w-24" />
          )}
          <span>Discard ({g.discard.length})</span>
        </button>
        <div className="col-span-2 flex w-full min-w-0 flex-wrap items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-start">
          <LastAction view={view} c={c} />
          {g.decisionEnds !== null && !over && view.stage !== 'window' && view.stage !== 'beat' && (
            <Countdown
              deadline={g.decisionEnds}
              clockOffset={room.clockOffset}
              label="to decide"
              {...(strict
                ? { atZero: 'then the safe move is made' }
                : {
                    soft: true,
                    expiredHint:
                      'Nothing happens by itself. Nudge them, or the host can act for them.',
                  })}
            />
          )}
        </div>
      </div>
      {view.stage === 'window' && g.window && g.pending && (
        <NopePanel view={view} c={c} clockOffset={room.clockOffset} act={act} />
      )}
    </div>
  );

  const blindMe = g.blindCount !== null;
  const slotPicked = blindSlot?.key === selKey ? blindSlot.slot : null;
  const nowTargets = needs === 'ghost' ? targetsFor(g, me, 'ghost') : null;
  const nowDock = nowOnly && selCards.length > 0 && (
    <div className="space-y-2 rounded-2xl bg-panel p-2.5 ring-1 ring-line" data-testid="now-dock">
      {nowTargets ? (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-ink">
            ⚡ {c.name(selCards[0]!.t)}: pick the ghost to feed
          </p>
          <div className="flex flex-wrap gap-1.5" data-testid="targets">
            {nowTargets.map((id) => (
              <Button key={id} variant="soft" onClick={() => play(id)}>
                👻 {id === me ? 'yourself' : who(view, id)}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full"
          disabled={!plan || 'why' in plan}
          onClick={() => play()}
          data-testid="play-now"
        >
          ⚡ {playNow(c.name(selCards[0]!.t))}
        </Button>
      )}
      {plan && 'why' in plan && <p className="text-xs text-danger-ink">{c.t(plan.why)}</p>}
      <RefusalSlot anchor="play" />
    </div>
  );
  const blindDock = myTurn && blindMe && (
    <div className="space-y-2 rounded-2xl bg-panel p-2.5 ring-1 ring-line" data-testid="dock">
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          size="lg"
          disabled={slotPicked === null}
          onClick={() => {
            if (slotPicked === null) return;
            setBlindSlot(null);
            void act({ type: 'play-blind', slot: slotPicked }, { anchor: 'play' });
          }}
          data-testid="play-blind"
        >
          Play it blind
        </Button>
        <Button
          size="lg"
          onClick={() => void act({ type: 'draw' }, { anchor: 'play' })}
          data-testid="draw"
        >
          Draw{g.turn.owed > 1 ? ` (1 of ${g.turn.owed})` : ''}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        {slotPicked === null
          ? 'Pick a face-down card to play it blind, or draw.'
          : 'Whatever it is gets played; a card that can’t be played is lost.'}
      </p>
      <RefusalSlot anchor="play" />
    </div>
  );
  const dock = myTurn && !blindMe && (
    <div className="space-y-2 rounded-2xl bg-panel p-2.5 ring-1 ring-line" data-testid="dock">
      {isPicking && needs ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">
            {plan && 'label' in plan && plan.named
              ? 'Name the card you want, then pick who to ask:'
              : 'Pick who:'}
          </p>
          {plan && 'named' in plan && plan.named && (
            <select
              className="min-h-11 w-full rounded-lg bg-card px-3 text-ink ring-1 ring-line-strong"
              value={picking?.named ?? ''}
              onChange={(e) =>
                setPicking({ key: selKey, named: (e.target.value || null) as CardType | null })
              }
              aria-label="The card you ask for"
              data-testid="named"
            >
              <option value="">Choose a card…</option>
              {g.types
                .filter((t) => NAMEABLE.includes(t))
                .map((t) => (
                  <option key={t} value={t}>
                    {c.name(t)}
                  </option>
                ))}
            </select>
          )}
          <div className="flex flex-wrap gap-1.5" data-testid="targets">
            {(targets ?? []).map((id) => (
              <Button
                key={id}
                variant="soft"
                disabled={!!(plan && 'named' in plan && plan.named && !picking?.named)}
                onClick={() => play(id, picking?.named)}
              >
                {needs === 'ghost' ? '👻 ' : ''}
                {who(view, id)}{' '}
                <span className="text-xs opacity-75">
                  🂠 {g.players.find((x) => x.id === id)?.hand}
                </span>
              </Button>
            ))}
            {targets?.length === 0 && (
              <p className="text-sm text-ink-muted">Nobody can be picked right now.</p>
            )}
            <Button variant="ghost" onClick={() => setPicking(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="lg"
            disabled={!plan || 'why' in plan}
            onClick={() => {
              if (!plan || 'why' in plan) return;
              if (plan.needsTarget) setPicking({ key: selKey, named: null });
              else play();
            }}
            data-testid="play"
          >
            {playLabel}
          </Button>
          <Button
            size="lg"
            onClick={() => void act({ type: 'draw' }, { anchor: 'play' })}
            data-testid="draw"
          >
            Draw{g.turn.owed > 1 ? ` (1 of ${g.turn.owed})` : ''}
          </Button>
        </div>
      )}
      {plan && 'why' in plan && <p className="text-xs text-danger-ink">{c.t(plan.why)}</p>}
      {!plan && (
        <p className="text-xs text-ink-muted">Tap cards to play them, or draw to end your turn.</p>
      )}
      <RefusalSlot anchor="play" />
    </div>
  );

  const handBlock = blindMe ? (
    <section aria-label="Your face-down hand" className="space-y-1">
      <p className="text-xs font-semibold text-ink-muted">
        {c.glyph('blind')} Blindfolded: {g.blindCount} face-down{' '}
        {g.blindCount === 1 ? 'card' : 'cards'}
      </p>
      {g.blindCount ? (
        <BlindSlots
          count={g.blindCount}
          c={c}
          picked={slotPicked}
          onPick={(slot) => {
            if (myTurn) setBlindSlot({ key: selKey, slot });
          }}
          label="Your face-down cards"
        />
      ) : (
        <p className="text-sm text-ink-muted">Your hand is empty.</p>
      )}
    </section>
  ) : (
    g.hand && (
      <Hand
        cards={hand}
        art={g.art}
        c={c}
        selected={selected}
        onTap={toggle}
        onInspect={setInspect}
        label="Your hand"
      />
    )
  );

  return (
    <div className="space-y-2 pb-4" data-testid="short-fuse">
      <ShortFuseStyles />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
          {c.names.sets[g.core === 'party' ? 'party' : g.art === 'adult' ? 'adult' : 'classic']}
          {g.x1 && ` + ${c.names.sets.x1}`}
          {g.x2 && ` + ${c.names.sets.x2}`}
          {g.x3 && ` + ${c.names.sets.x3}`}
          {g.x4 && ` + ${c.names.sets.x4}`}
        </span>
        {g.art === 'adult' && <AdultBadge />}
        <button
          type="button"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-panel text-sm ring-1 ring-line"
          aria-label={sound ? 'Sound on (tap to mute)' : 'Sound off (tap to turn on)'}
          aria-pressed={sound}
          onClick={() => setSound(!sound)}
        >
          {sound ? '🔊' : '🔇'}
        </button>
      </div>

      <Seats
        view={view}
        room={room}
        c={c}
        targets={targets}
        onPick={(id) => play(id, picking?.named)}
      />

      {over ? (
        <End view={view} room={room} c={c} act={act} />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-4">
          <div className="space-y-2">
            <TabBar tab={tab} onChange={setTab} memory={g.memory.length} />
            <div className={cn('space-y-2', tab !== 'table' && 'max-lg:hidden')}>
              {table}
              <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
              <WaitingChips view={view} room={room} act={act} now={now} />
              {tip && (
                <p className="flex items-start gap-2 rounded-xl bg-special-soft px-3 py-2 text-sm text-special-ink ring-1 ring-special-line">
                  <span className="flex-1">💡 {tip[1]}</span>
                  <button
                    type="button"
                    className="text-xs font-semibold underline"
                    onClick={() => dismissTip(tip[0])}
                  >
                    Got it
                  </button>
                </p>
              )}
              {p?.kind === 'bomb' && (
                <BombStrip
                  key={`${g.turn.n}:${p.card.id}`}
                  prompt={p}
                  c={c}
                  art={g.art}
                  act={act}
                  name={(id) => who(view, id, false)}
                  drew={g.log.at(-1)?.kind === 'drew-bomb' && g.log.at(-1)?.by === me}
                />
              )}
              {handBlock}
              {dock}
              {blindDock}
              {nowDock}
            </div>
            <div className={cn('lg:hidden', tab !== 'log' && 'hidden')}>
              <Log view={view} c={c} />
            </div>
            <div className={cn('lg:hidden', tab !== 'me' && 'hidden')}>
              <MeTab view={view} c={c} />
            </div>
          </div>
          <aside className="hidden space-y-4 lg:block">
            <div className="rounded-2xl bg-panel p-3 ring-1 ring-line">
              <MeTab view={view} c={c} />
            </div>
            <div className="max-h-[32rem] overflow-y-auto rounded-2xl bg-panel p-3 ring-1 ring-line">
              <Log view={view} c={c} />
            </div>
          </aside>
        </div>
      )}

      {p?.kind === 'place' && (
        <PlaceSheet key={`${g.turn.n}:${p.card.id}`} prompt={p} c={c} art={g.art} act={act} />
      )}
      {p?.kind === 'alter' && (
        <AlterSheet
          key={`${g.turn.n}:${p.cards.map((x) => x.id).join()}`}
          prompt={p}
          c={c}
          art={g.art}
          act={act}
          shareWith={p.share ? who(view, p.share, false) : null}
        />
      )}
      {p?.kind === 'give' && !p.blind && (
        <PickSheet
          title={`${who(view, p.to, false)} asks you for a card`}
          intro="Pick the card to give. They take it straight into their hand."
          cards={hand}
          c={c}
          art={g.art}
          confirmLabel={(x) => `Give ${c.name(x.t)}`}
          warn={(x) => (precious(x) ? `Sure? ${c.name(x.t)} is a precious card.` : null)}
          onPick={(x) => void act({ type: 'give', card: x.id }, { anchor: 'give' })}
          anchor="give"
        />
      )}
      {p?.kind === 'salvage' && (
        <PickSheet
          title="Take a card from the discard pile"
          intro="Five different cards: take any one card back into your hand."
          cards={p.options}
          c={c}
          art={g.art}
          confirmLabel={(x) => `Take ${c.name(x.t)}`}
          onPick={(x) => void act({ type: 'salvage', card: x.id }, { anchor: 'salvage' })}
          anchor="salvage"
        />
      )}
      {p?.kind === 'dig' && (
        <DigSheet
          key={`${g.turn.n}:${p.card.id}`}
          prompt={p}
          c={c}
          art={g.art}
          act={act}
          onDone={() => lastPeek && setSeenPeek({ game: gameNo, id: lastPeek.id })}
        />
      )}
      {peekOpen && !p?.kind?.match(/place|alter|give|salvage|each|target|search|dig/) && (
        <PeekSheet
          memory={peekOpen}
          c={c}
          art={g.art}
          onClose={() => setSeenPeek({ game: gameNo, id: peekOpen.id })}
          {...(peekOpen.kind === 'shared' ? { from: who(view, peekOpen.other, false) } : {})}
        />
      )}
      {watched.length > 0 && !p?.kind?.match(/place|alter|give|salvage|each|target|search|dig/) && (
        <Modal
          open
          onClose={() => setSeenWatch({ game: gameNo, id: lastWatch!.id })}
          title={c.t('{c:seer}: what you watched')}
          footer={
            <Button
              size="lg"
              className="w-full"
              onClick={() => setSeenWatch({ game: gameNo, id: lastWatch!.id })}
              data-testid="watch-close"
            >
              Got it
            </Button>
          }
        >
          <ul className="space-y-1.5 text-sm text-ink" data-testid="watch-sheet">
            {watched.map((m) =>
              m.kind === 'watched' ? (
                <li key={m.id} className="rounded-lg bg-card px-3 py-2 ring-1 ring-line">
                  {who(view, m.other, false)} put {c.name(m.t)}{' '}
                  {m.position === 0
                    ? 'on top'
                    : m.position === m.of - 1
                      ? 'at the bottom'
                      : `${m.position + 1} of ${m.of} from the top`}
                  .
                </li>
              ) : null,
            )}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            Only the players who played {c.name('seer')} saw this. It stays under Me until the pile
            changes.
          </p>
        </Modal>
      )}
      {p?.kind === 'give' && p.blind && (
        <BlindPickSheet
          title={`${who(view, p.to, false)} asks you for a card`}
          intro="You’re blindfolded: pick a face-down card to give. You’ll see what it was afterwards."
          count={g.blindCount ?? 0}
          c={c}
          confirmLabel="Give this card"
          onPick={(slot) => void act({ type: 'give', slot }, { anchor: 'give' })}
          anchor="give"
        />
      )}
      {p?.kind === 'each' &&
        !p.done &&
        (() => {
          const titles = {
            potluck: c.t('{c:potluck}: put a card on top'),
            recycle: c.t('{c:recycle}: put a card in'),
            robber: c.t('{c:robber}: put a card in'),
            feed: c.t(`{c:feed}: give ${who(view, p.to, false)} a card`),
          };
          const intros = {
            potluck:
              'Everyone with cards puts one face down on top of the pile, in turn order (the last one ends up on top). Nobody else sees yours.',
            recycle:
              'Everyone with cards puts one into the pile, then it’s shuffled. Nobody else sees yours.',
            robber:
              'Every ghost with cards puts one into the pile, then it’s shuffled. Nobody else sees yours.',
            feed: `Every living player but the one who played it gives ${who(view, p.to, false)} a card of their choice. Never ${an(c.names.bomb)}: those stay with you.`,
          };
          const title = titles[p.what];
          return p.blind ? (
            <BlindPickSheet
              title={title}
              intro={
                p.what === 'feed'
                  ? `You’re blindfolded: pick a face-down card (if it’s ${an(c.names.bomb)}, another card goes instead). You’ll see what it was afterwards.`
                  : 'You’re blindfolded: pick a face-down card. You’ll see what it was afterwards.'
              }
              count={g.blindCount ?? 0}
              c={c}
              confirmLabel={p.what === 'feed' ? 'Give this card' : 'Put this card in'}
              onPick={(slot) => void act({ type: 'choose', slot }, { anchor: 'choose' })}
              anchor="choose"
            />
          ) : (
            <PickSheet
              key={`${g.turn.n}:${p.what}`}
              title={title}
              intro={intros[p.what]}
              cards={p.what === 'feed' ? hand.filter((x) => !CARDS[x.t].bombLike) : hand}
              c={c}
              art={g.art}
              confirmLabel={(x) =>
                p.what === 'feed' ? `Give ${c.name(x.t)}` : `Put in ${c.name(x.t)}`
              }
              warn={(x) => (precious(x) ? `Sure? ${c.name(x.t)} is a precious card.` : null)}
              onPick={(x) => void act({ type: 'choose', card: x.id }, { anchor: 'choose' })}
              anchor="choose"
            />
          );
        })()}
      {p?.kind === 'target' && (
        <TargetSheet prompt={p} c={c} art={g.art} name={(id) => who(view, id, false)} act={act} />
      )}
      {p?.kind === 'search' && (
        <SearchSheet prompt={p} c={c} art={g.art} lost={searchLost(g, me)} act={act} />
      )}
      {inspect && (
        <Inspector
          card={inspect}
          c={c}
          art={g.art}
          now={cardHint(inspect, c, myTurn)}
          onClose={() => setInspect(null)}
        />
      )}
      <Modal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title={`Discard pile (${g.discard.length})`}
      >
        <ol className="flex flex-wrap gap-1.5">
          {[...g.discard].reverse().map((x) => (
            <li key={x.id}>
              <CardFace card={x} art={g.art} c={c} size="sm" />
            </li>
          ))}
          {g.discard.length === 0 && (
            <li className="text-sm text-ink-muted">Nothing discarded yet.</li>
          )}
        </ol>
      </Modal>
      {blast && (
        <div
          key={blast.until}
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center"
          aria-live="assertive"
          data-testid="explosion"
        >
          <span className="sf-flash absolute inset-0 bg-danger" />
          <span className="sf-pop relative rounded-2xl bg-card px-6 py-4 text-center text-2xl font-black text-danger-ink shadow-2xl ring-2 ring-danger-line">
            {g.players.find((x) => x.id === blast.who)?.ghost
              ? `👻 ${blast.who === me ? 'You’re a ghost now!' : `${who(view, blast.who, false)} is a ghost now!`}`
              : `💥 ${blast.who === me ? 'You exploded!' : `${who(view, blast.who, false)} exploded!`}`}
          </span>
        </div>
      )}
    </div>
  );
}
