import type { GameRoomInfo } from '@vt/game-sdk';
import {
  type IconName,
  ProtectedImage,
  cn,
  usePlayerColor,
  useSecondsLeft as useSecondsTo,
} from '@vt/ui';
import {
  Dim,
  Label,
  Layer,
  type LoadedRig,
  Poster,
  PosterClock,
  PosterSlate,
  RigArt,
  Scene,
  ShowTargetsProvider,
  Spotlight,
  Stamp,
  placeOf,
  symbolSource,
  useShow,
  lowOf,
  useShowSettings,
  useShowTargets,
  useTarget,
  usePosterInfo,
  useRig,
} from '@vt/ui/show';
import type { Track } from '@vt/game-sdk/show';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { encode as encodeQr } from 'uqr';
import { money } from '../logic/lines.ts';
import { BID_STEP, type GoingOnceView, OPENING_BID, type PlayerView } from '../logic/types.ts';
import { type Art, GAME_ID, type ManifestState, artFor, assetUrl, useManifest } from './assets.ts';
import { endTimes, lobbyCues } from './audio.ts';
import { HostStrip } from './Extras.tsx';
import type { GoingOnceUiProps } from './GoingOnceGame.tsx';
import { Picture } from './Picture.tsx';
import {
  BANK_PARTS,
  CALL_WORDS,
  SLIDE_RISE,
  chairsOf,
  compose,
  raiseCap,
  symbolBox,
  endTrack,
  moments,
  plateText,
  shapeKey,
  winnersShownAt,
} from './show.ts';
import { type NameOf, unquote } from './text.ts';
import { FULL_VOLUMES } from '@vt/ui/sound';
import { useSound } from './useSound.ts';

// The table screen: the whole auction house on a laptop or TV, from the spectator view. The room
// is the original's vector parts (the rig, from the private manifest's `show` keys) on a
// 1280 × 720 stage; moments (`show.ts`) move them on the server clock while the sound plays the
// same beats. Nothing here is secret: the view is the one every watcher gets.

/** The manifest's file groups (`show.stage.phases`) for the stage the game is in. */
function phaseOf(view: GoingOnceView): string {
  const g = view.game;
  if (view.phase === 'lobby' || !g) return 'lobby';
  switch (g.stage) {
    case 'countdown':
      return 'lobby';
    case 'intro':
    case 'draw':
      return 'draw';
    case 'done':
      return 'end';
    default:
      return 'auction';
  }
}
const NEXT: Record<string, string> = {
  lobby: 'draw',
  draw: 'auction',
  auction: 'end',
};

/** Each game colour as a paint for the silhouettes (the room is dark, so the bright shades). */
const PAINT: Record<string, string> = {
  red: '#ef4444', // vt-palette
  orange: '#f97316', // vt-palette
  yellow: '#facc15', // vt-palette
  green: '#22c55e', // vt-palette
  blue: '#3b82f6', // vt-palette
  purple: '#a855f7', // vt-palette
  grey: '#a8a29e',
};

/** Where a part waits before its first moment: the first frame of the track that brings it on. */
const startOf = (t: Track | undefined): CSSProperties | undefined => {
  const f = t?.frames[0];
  return f && { transform: `matrix(${f.slice(0, 6).join(',')})`, opacity: f[6] };
};
const restOf = (t: Track | undefined): CSSProperties | undefined => {
  const f = t?.frames.at(-1);
  return f && { transform: `matrix(${f.slice(0, 6).join(',')})`, opacity: f[6] };
};

/**
 * Where things stand in the room: the original's own places (the rig's `<part>.at`), so the lot
 * reads as it did: the camera closed in on the wall, a small framed painting at the top left, the
 * label, the huge amount and the grey next ask to its right, the leader's silhouette with TOP,
 * and the chairs along the bottom with the paddles parked behind them.
 */
const AT = {
  /** The end's art layouts (their pictures slide in relative to this; the rig's `art1.at`). */
  art: [1, 0, 0, 1, 635.05, 233.3],
  /**
   * A buyer's paddle and total, where the values fly to: on the finale row's line (the rig's
   * `finaleRow.at` + its row, 570), less the paddle's settled rise.
   */
  total: [1, 0, 0, 1, 640, 538],
};

/** The lot's canvas in the painting (the original's 240 × 320 at 1.1875). */
const CANVAS: CSSProperties = { left: 0, top: 0, width: 285, height: 380, borderRadius: 3 };
/** The sold lot's title, under the painting (our addition, DECIDED A4), clear of the chairs. */
const TITLE: CSSProperties = {
  left: 243,
  top: 492,
  width: 300,
  fontSize: 26,
  lineHeight: 1.15,
  color: '#1c1917',
  textAlign: 'left',
};
/** Text on the gallery wall. */
const INK = '#1c1917';
/** The grey of the next ask and the calls under the amount. */
const ASK_GREY = '#6b645b';
/** The amount the auctioneer asks for next. */
const nextAsk = (top: number | undefined) => (top ? top + BID_STEP : OPENING_BID);

/**
 * The original's three faces (private fonts from the manifest, loaded on the table screen only),
 * with fallbacks for a manifest without them: the amounts, the labels and names, the headlines.
 */
const FONT = {
  amount: "'go-amount', ui-sans-serif, system-ui, sans-serif",
  label: "'go-label', 'Arial Narrow', 'Roboto Condensed', ui-sans-serif, sans-serif",
  name: "'go-name', ui-sans-serif, system-ui, sans-serif",
};
/** A text field the original anchors at its top left (amounts, the next ask). */
const FIELD: CSSProperties = { transform: 'none', left: 2, top: 2, lineHeight: 1 };

/**
 * The subtitles' band: kept clear in every scene so the words never cover the painting, the
 * amounts, the names, the paddles, the stamp or the winner. Along the top during the game (the
 * painting, the disc, the sign and the hourglass all hang below it), along the bottom at the end
 * (the art and its titles fill the top). Two lines fit; longer lines are clipped to two.
 */
const BAND: CSSProperties = { left: 40, top: 6, width: 1200, height: 86 };
const BAND_END: CSSProperties = { ...BAND, top: 628 };

/** A part not on show. */
const HIDDEN: CSSProperties = { opacity: 0 };

/**
 * The original's stamp text over the shared stamp's (whose label sizes are inline, hence
 * `!important`): SOLD! 62; the value 52, its middle 11 above the slab's, over the PROFIT or LOSS
 * line (18) at the rig's `stamp.profit`.
 */
const STAMP_FACES =
  '.go-stamp .vt-stamp-word{font-size:62px !important}' +
  '.go-stamp [data-face=value] .vt-stamp-word{font-size:52px !important;top:-11px !important}' +
  '.go-stamp .vt-stamp-line{font-size:18px !important}';

const SLAB_BOX: CSSProperties = { position: 'absolute', left: 0, top: 0 };

/** The widest the value may be on the slab: the original's value box (253 at 0.8), less a margin. */
const VALUE_WIDTH = 196;

/**
 * Keeps the slab's word inside the original's value box: a longer amount ("$12,500") shrinks
 * to fit instead of running off the slab or into the line under it.
 */
function SlabStamp({ rig }: { rig: LoadedRig }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    const word = root?.querySelector<HTMLElement>('.vt-stamp-word');
    if (!root || !word) return;
    const fit = () => {
      word.style.removeProperty('font-size');
      if (word.closest('[data-face=value]') === null) return;
      const w = word.offsetWidth;
      if (w > VALUE_WIDTH) {
        const size = parseFloat(getComputedStyle(word).fontSize);
        word.style.setProperty(
          'font-size',
          `${Math.floor((size * VALUE_WIDTH) / w)}px`,
          'important',
        );
      }
    };
    const watch = new MutationObserver(fit);
    watch.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-face'],
    });
    return () => {
      watch.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className="go-stamp" style={{ ...SLAB_BOX, fontFamily: FONT.amount }}>
      <style>{STAMP_FACES}</style>
      <Stamp rig={rig} line="inside" />
    </div>
  );
}

/** The room's size in stage units. */
const ROOM: CSSProperties = { width: 1280, height: 720 };

const WINNERS = ['One', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

/** The lot on the easel as the stage draws it. */
function lotView(view: GoingOnceView) {
  const g = view.game;
  if (!g) return null;
  const a = g.auction;
  if (!a || (g.stage !== 'auction' && g.stage !== 'sold')) return null;
  return {
    label: `${a.lot + 1}/${g.lotCount}`,
    bid: a.bid,
    picture: a.picture,
    close: a.close,
  };
}

/** The server clock now, from this screen's offset. */
const serverNow = (offset: number) => Date.now() + offset;

/** When this screen opened the lobby (server clock; 0 outside it): the lobby's own moment. */
function useOpenedAt(view: GoingOnceView, offset: number): number {
  const lobby = view.phase === 'lobby';
  const [seen, setSeen] = useState<{ lobby: boolean; at: number } | null>(null);
  if (!seen || seen.lobby !== lobby) setSeen({ lobby, at: lobby ? serverNow(offset) : 0 });
  return seen?.lobby === lobby ? seen.at : 0;
}

/**
 * When this screen first saw each lobby seat taken, on the server clock (0 for those taken
 * before it opened), so a newcomer's paddle pops up as they sit down.
 */
function useJoined(view: GoingOnceView, offset: number): Readonly<Record<string, number>> {
  const ids = view.seats
    .filter((s) => s.playing)
    .map((s) => s.id)
    .join('|');
  const [seen, setSeen] = useState<{ ids: string; at: Record<string, number> } | null>(null);
  if (!seen) setSeen({ ids, at: Object.fromEntries(ids.split('|').map((id) => [id, 0])) });
  else if (seen.ids !== ids) {
    const at = { ...seen.at };
    for (const id of ids.split('|')) at[id] ??= serverNow(offset);
    setSeen({ ids, at });
  }
  return seen?.at ?? {};
}

/**
 * The original's fonts, from the private manifest's `fonts` (`amount`, `label`, `name`: woff2
 * paths), added to the page for the table screen only. A manifest without them keeps the fallbacks.
 */
function useShowFonts(manifest: unknown) {
  useEffect(() => {
    const fonts = (manifest as { fonts?: Record<string, unknown> } | null)?.fonts;
    if (!fonts || typeof document === 'undefined' || typeof FontFace === 'undefined') return;
    const added: FontFace[] = [];
    for (const key of ['amount', 'label', 'name'] as const) {
      const path = fonts[key];
      if (typeof path !== 'string' || !path.trim()) continue;
      const face = new FontFace(`go-${key}`, `url(${assetUrl(path.trim())})`);
      document.fonts.add(face);
      added.push(face);
      void face.load().catch(() => undefined);
    }
    return () => {
      for (const face of added) document.fonts.delete(face);
    };
  }, [manifest]);
}

export function GoingOnceStage({ view, room }: GoingOnceUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  useShowFonts(manifest);
  const offset = room.clockOffset;
  const joined = useJoined(view, offset);
  const openedAt = useOpenedAt(view, offset);
  const extra = useMemo(() => lobbyCues(view, openedAt, joined), [view, openedAt, joined]);
  useSound({
    view,
    extra,
    manifest,
    you: null,
    isHost: false,
    clockOffset: room.clockOffset,
    // The table plays at the host's table volumes (`useSound` reads them from the view).
    volumes: FULL_VOLUMES,
    colours: room.players.flatMap((p) => (p.color ? [p.color] : [])),
    stagePresent: true,
    isStage: true,
  });
  const phase = phaseOf(view);
  const rig = useRig(GAME_ID, 'stage', phase, NEXT[phase]);
  const targets = useShowTargets();
  const { reduced, setting } = useShowSettings();
  // The battery saver goes on here only when switched on (never by itself on a table screen).
  const low = lowOf({ setting, auto: false }, true);
  const g0 = view.game;
  // Each raised paddle is held under the next ask, by its seat and silhouette (`raiseCap`).
  const caps = useMemo(() => {
    if (!rig || !g0) return undefined;
    const seats = chairsOf(rig.places, g0.order.length);
    return (id: string, track: string) => {
      const seat = seats[g0.order.indexOf(id)];
      const [part, label] = track.split('.');
      const t = rig.tracks[part ?? '']?.[label ?? ''];
      if (!seat || !t) return null;
      const key = shapeKey(manifest, rig, g0.paddles[id]);
      const src = key ? rig.symbols[key] : undefined;
      const art = src?.startsWith('@') ? rig.symbols[src.slice(1)] : src;
      const box = key ? symbolBox(art) : FALLBACK_BOX;
      return box ? raiseCap(rig.places, seat, box, t.frames, t.ms) : null;
    };
  }, [rig, g0, manifest]);
  const list = useMemo(
    () =>
      rig
        ? moments(view, {
            you: null,
            profile: 'stage',
            joined,
            openedAt,
            swaps: rig.swaps,
            caps,
          })
        : [],
    [rig, view, joined, openedAt, caps],
  );
  useShow(list, {
    clock: () => Date.now() + offset,
    profile: 'stage',
    you: null,
    reduced,
    low,
    tracks: rig?.tracks ?? {},
    el: targets.el,
  });
  const names = view.game?.players ?? view.seats;
  const name: NameOf = (id) => names.find((p) => p.id === id)?.name ?? 'Someone';
  const bg = art.ui('gallery');

  return (
    <ShowTargetsProvider targets={targets}>
      {/* The room is dark whatever the device's theme (a TV in a living room). */}
      <div
        ref={targets.ref('room')}
        className={rig ? 'h-full w-full bg-stone-950 text-white' : 'h-full w-full'}
        data-theme={rig ? 'dark' : undefined}
        data-testid="go-stage"
        data-phase={phase}
      >
        {!rig ? (
          <Plain view={view} art={art} name={name} host={offset} />
        ) : (
          <Scene
            background={
              <>
                {bg ? (
                  <ProtectedImage
                    src={bg}
                    alt=""
                    className="absolute left-0 top-0"
                    style={{ ...ROOM, maxWidth: 'none' }}
                  />
                ) : (
                  <div
                    className="absolute left-0 top-0 bg-gradient-to-b from-stone-800 to-stone-950"
                    style={ROOM}
                  />
                )}
                {/* The original darkens the wall alone (screws, the winner); the camera layer has
                    no size of its own, so the dim gets the room's. */}
                <div className="absolute left-0 top-0" style={ROOM}>
                  <Dim name="walldim" />
                </div>
              </>
            }
            overlay={
              <>
                {rig && (
                  <Lights
                    view={view}
                    rig={rig}
                    manifest={manifest}
                    name={name}
                    clockOffset={offset}
                  />
                )}
                {view.game && (
                  <div
                    className="absolute flex items-center justify-center overflow-hidden [&_p]:line-clamp-2 [&_p]:max-w-full [&_p]:text-[26px] [&_p]:leading-[1.2]"
                    style={phase === 'end' ? BAND_END : BAND}
                    data-testid="go-stage-band"
                  >
                    <HostStrip view={view} art={art} name={name} clockOffset={offset} tv />
                  </div>
                )}
              </>
            }
          >
            <Room view={view} room={room} rig={rig} art={art} manifest={manifest} name={name} />
          </Scene>
        )}
      </div>
    </ShowTargetsProvider>
  );
}

/**
 * Without the private art (dev, tests without a manifest): the room in words and the pictures,
 * on the shared table-screen poster.
 */
function Plain({
  view,
  art,
  name,
  host,
}: {
  view: GoingOnceView;
  art: Art;
  name: NameOf;
  /** The clock offset, for the auctioneer's line. */
  host: number;
}) {
  const { name: title } = usePosterInfo();
  const logo = art.ui('logo');
  const g = view.game;
  const lot = lotView(view);
  const sold = g?.stage === 'sold' ? g.results.at(-1) : undefined;
  const line = g ? <HostStrip view={view} art={art} name={name} clockOffset={host} tv /> : null;
  const recent = g?.stage === 'auction' ? [...(g.auction?.recent ?? [])].reverse().slice(0, 4) : [];
  if (!g)
    return (
      <Poster
        testId="go-stage-plain"
        eyebrow="Waiting for the host"
        headline={
          logo ? (
            <ProtectedImage src={logo} alt={title} className="mx-auto h-[220px] w-auto" />
          ) : (
            title
          )
        }
        line={view.seats
          .filter((s) => s.playing)
          .map((s) => s.name)
          .join(' · ')}
      />
    );
  if (g.stage === 'done' && g.final)
    return (
      <Poster
        testId="go-stage-plain"
        eyebrow="Game over"
        headline={
          <span data-testid="go-stage-winner">
            {g.winners.map(name).join(' & ')} {g.winners.length === 1 ? 'wins' : 'share the win'}!
          </span>
        }
        line="Final count: cash plus art, less any loans."
        // The final standings at poster size, best first.
        // The final standings at poster size, best first, each with the priciest lot they bought.
        choices={[...g.final]
          .sort((a, b) => b.score - a.score)
          .map((f, i) => {
            const best = g.results
              .filter((r) => r.buyer === f.id)
              .sort((a, b) => b.price - a.price)[0];
            return (
              <PosterSlate
                key={f.id}
                state={g.winners.includes(f.id) ? 'won' : 'open'}
                className="min-w-[300px] content-start gap-2 px-8 py-6"
              >
                {best && (best.drawing || best.house) && (
                  <div className="mx-auto mb-2 w-[220px]">
                    <Picture
                      drawing={best.drawing ?? null}
                      house={best.house}
                      art={art}
                      label={best.title}
                      tv
                    />
                  </div>
                )}
                <span className="text-[28px] text-ink-muted">{i + 1}.</span>
                <span className="block text-[40px]">{name(f.id)}</span>
                <span className="block font-display text-[64px] leading-none tabular-nums">
                  {money(f.score)}
                </span>
              </PosterSlate>
            );
          })}
        footer={{ icon: 'hand', text: 'Every lot and award is on your phone.' }}
      />
    );
  if (lot)
    return (
      <Poster
        testId="go-stage-plain"
        eyebrow={`Lot ${lot.label}`}
        headline={
          sold ? (
            <span data-testid="go-stage-sold">
              {sold.buyer
                ? `SOLD to ${name(sold.buyer)} for ${money(sold.price)}`
                : `Unsold – it was worth ${money(sold.value)}`}
            </span>
          ) : (
            <span data-testid="go-stage-bid">{money(lot.bid?.amount ?? OPENING_BID)}</span>
          )
        }
        line={sold ? undefined : lot.bid ? `Current bid · ${name(lot.bid.by)}` : 'Opening bid'}
        footer={{ icon: 'hand', text: 'Bid on your phone.' }}
      >
        {/* The lot, and beside it the auctioneer's line over the last few bids (newest first),
            so the room sees who is in the running. */}
        <div className="flex w-full items-center justify-center gap-16">
          <div className="w-[440px] shrink-0">
            <Picture
              drawing={lot.picture.drawing}
              house={lot.picture.house}
              art={art}
              label="The lot"
              tv
            />
          </div>
          {/* Hidden while it holds nothing (no line said, no bids yet), so the lot centres. */}
          {(line || !!recent.length) && (
            <div className="w-[640px] space-y-6 text-left empty:hidden [&_p]:text-[28px]">
              {line}
              {!!recent.length && (
                <ol aria-label="Last bids" className="space-y-2" data-testid="go-stage-bids">
                  {recent.map((b, i) => (
                    <li
                      key={`${recent.length - i}-${b.by}-${b.amount}`}
                      className={cn(
                        'flex items-baseline justify-between gap-6 rounded-2xl px-6 py-3 text-[32px]',
                        i === 0 ? 'bg-accent-soft font-semibold text-ink' : 'text-ink-2',
                      )}
                    >
                      <span className="truncate">
                        {b.forced && '🔩 '}
                        {name(b.by)}
                      </span>
                      <span className="font-display tabular-nums">{money(b.amount)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </Poster>
    );
  const more = STAGE_MORE[g.stage];
  return (
    <Poster
      testId="go-stage-plain"
      eyebrow={more?.eyebrow}
      headline={STAGE_WORDS[g.stage]}
      line={more?.line}
      clock={more?.clock && <StageClock view={view} offset={host} label={more.clock} />}
      footer={more?.footer}
    >
      {line && <div className="max-w-[1200px] [&_p]:text-[28px]">{line}</div>}
    </Poster>
  );
}

/** The stage's own clock, once it runs (drawing's starts after the instructions, as on phones). */
function StageClock({
  view,
  offset,
  label,
}: {
  view: GoingOnceView;
  offset: number;
  label: string;
}) {
  const g = view.game!;
  const startsIn = useSecondsTo(g.stage === 'draw' ? g.drawFrom : null, offset);
  if ((startsIn ?? 0) > 0 || !g.until) return null;
  return <PosterClock deadline={g.until} clockOffset={offset} label={label} />;
}

/** What the poster adds per stage: the moment, one sentence, its clock and what phones do. */
const STAGE_MORE: Record<
  string,
  { eyebrow: string; line: string; clock?: string; footer: { icon: IconName; text: string } }
> = {
  draw: {
    eyebrow: 'Drawing time',
    line: 'Everyone draws two pictures from secret titles. They go up for auction next.',
    clock: 'to draw',
    footer: { icon: 'hand', text: 'Draw on your phone.' },
  },
  halftime: {
    eyebrow: 'Half-time',
    line: 'Everyone has one screw for the rest of the game: force a player to bid $100 more.',
    clock: 'until the next lot',
    footer: { icon: 'hand', text: 'Press Screw on your phone during a lot.' },
  },
  bank: {
    eyebrow: 'Loans',
    line: 'Someone is low on cash, so the bank offers everyone a loan.',
    clock: 'until it closes',
    footer: { icon: 'hand', text: 'Answer the bank on your phone.' },
  },
};

const STAGE_WORDS: Record<string, string> = {
  countdown: 'Get ready…',
  intro: 'How the auction works',
  draw: 'Look at your phone and draw',
  auction: 'The next lot is coming up',
  sold: 'Sold!',
  halftime: 'Half-time: screws are on',
  bank: 'The bank is open',
  done: 'The end',
};

function Room({
  view,
  room,
  rig,
  art,
  manifest,
  name,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  rig: LoadedRig;
  art: Art;
  manifest: unknown;
  name: NameOf;
}) {
  const g = view.game;
  const players: Pick<PlayerView, 'id' | 'name'>[] = g
    ? g.order.flatMap((id) => g.players.find((p) => p.id === id) ?? [])
    : view.seats.filter((s) => s.playing);
  const a = lotView(view);
  const sold = g?.stage === 'sold' ? g.results.at(-1) : undefined;
  const lead = a?.bid?.by ?? null;
  const T = rig.tracks;
  if (!g || g.stage === 'countdown')
    return <Lobby view={view} rig={rig} manifest={manifest} countdown={g?.stage === 'countdown'} />;
  if (g.stage === 'done' && g.final)
    return (
      <EndScene
        view={view}
        rig={rig}
        art={art}
        manifest={manifest}
        name={name}
        clockOffset={room.clockOffset}
      />
    );
  const chairs = chairsOf(rig.places, players.length);
  // The chairs pop up as the drawing starts (the moment); from then on they are up.
  const chairsUp = !(g.stage === 'draw' && !g.redraw && g.since > 0);
  const painting = placeOf(rig, 'painting.at') ?? [1, 0, 0, 1, 243, 96];
  const stampAt = placeOf(rig, 'painting.stamp') ?? [1, 0, 0, 1, 148, 175];
  return (
    <>
      {a && (
        <>
          {/* The LOT disc on its strings, under the painting as the original layers them. */}
          <Layer m={placeOf(rig, 'lot.at')}>
            <Layer name="lot" moving style={a.close === 'intro' ? startOf(T.lot?.Appear) : HIDDEN}>
              <RigArt rig={rig} symbol="disc" />
              <Layer m={[1, 0, 0, 1, 0, 66]}>
                <Label
                  name="lot.num"
                  style={{
                    color: '#fff',
                    fontSize: 120,
                    lineHeight: 1,
                    fontFamily: FONT.label,
                    fontWeight: 400,
                    textShadow: '0 2px 2px rgb(0 0 0 / 0.25)',
                  }}
                >
                  {a.label}
                </Label>
              </Layer>
            </Layer>
          </Layer>
          {/* The painting on the wall (the frame under the canvas), the stamp at its middle. */}
          <Layer m={painting}>
            <Layer
              name="painting"
              moving
              style={a.close === 'intro' ? startOf(T.painting?.Appear) : undefined}
            >
              <Layer m={placeOf(rig, 'painting.frame')}>
                <RigArt rig={rig} symbol="painting.frame" />
              </Layer>
              <div
                className="absolute overflow-hidden"
                style={CANVAS}
                data-testid="go-stage-picture"
              >
                {(a.picture.drawing || a.picture.house) && (
                  <Picture
                    drawing={a.picture.drawing}
                    house={a.picture.house}
                    art={art}
                    label="The lot"
                    className="h-full w-full rounded-none"
                  />
                )}
              </div>
            </Layer>
          </Layer>
          {sold?.buyer && (
            <SoldTitle
              title={sold.title}
              artist={sold.artistKnown && sold.artist ? name(sold.artist) : null}
            />
          )}
          {/* The phone that slides in and rings while the tips go out. */}
          <Layer m={placeOf(rig, 'phone.at')}>
            <Layer name="phone" moving style={startOf(T.phone?.Appear)}>
              <Layer name="ring" moving>
                <RigArt rig={rig} symbol="ring-d7" />
              </Layer>
            </Layer>
          </Layer>
          {/* The bid: its label, the huge amount, the leader's shape with TOP, the grey next ask. */}
          <Layer m={placeOf(rig, 'bidLabel.at')}>
            <Layer
              name="bidLabel"
              moving
              style={a.close === 'intro' ? startOf(T.bidLabel?.Appear) : undefined}
            >
              <Label
                name="bidLabel.text"
                style={{
                  transform: 'translate(0, -100%)',
                  left: 4,
                  top: 30,
                  fontSize: 88,
                  lineHeight: 1,
                  color: INK,
                  fontFamily: FONT.label,
                  fontWeight: 400,
                }}
              >
                {sold ? 'Winning Bid' : a.bid ? 'Current Bid' : 'Opening Bid'}
              </Label>
            </Layer>
          </Layer>
          <Layer m={placeOf(rig, 'bidAmount.at')}>
            <Layer
              name="bidAmount"
              moving
              style={a.close === 'intro' ? startOf(T.bidAmount?.Appear) : undefined}
            >
              <Label
                name="bidAmount.text"
                style={{ ...FIELD, fontSize: 160, color: INK, fontFamily: FONT.amount }}
              >
                {money(a.bid?.amount ?? OPENING_BID)}
              </Label>
            </Layer>
          </Layer>
          <Layer m={placeOf(rig, 'bidFrom.at')}>
            <Layer name="bidFrom" moving style={lead ? undefined : HIDDEN}>
              {lead && (
                <LeaderShape
                  rig={rig}
                  manifest={manifest}
                  shape={g.paddles[lead]}
                  who={name(lead)}
                />
              )}
            </Layer>
          </Layer>
          <Layer m={placeOf(rig, 'bidPrompt.at')}>
            <Layer name="bidPrompt" moving style={a.close === 'intro' || sold ? HIDDEN : undefined}>
              <Label
                name="bidPrompt.text"
                style={{ ...FIELD, fontSize: 160, color: ASK_GREY, fontFamily: FONT.amount }}
              >
                {a.close === 'once' || a.close === 'twice'
                  ? CALL_WORDS[a.close]
                  : `${money(nextAsk(a.bid?.amount))}?`}
              </Label>
            </Layer>
          </Layer>
          <Layer m={compose(painting, stampAt)}>
            {/* The original's slab, over the bid's words: its words in the amount face, PROFIT or
                LOSS on the slab under the value (it grows with the slab). */}
            <SlabStamp rig={rig} />
          </Layer>
        </>
      )}
      {g.stage === 'draw' && <DrawingProps view={view} rig={rig} offset={room.clockOffset} />}
      {g.stage === 'draw' && !g.redraw && (
        <LobbyLeaving view={view} rig={rig} manifest={manifest} name={name} />
      )}
      {g.stage === 'intro' && <Projector view={view} rig={rig} art={art} />}
      {/* The hourglass rising away as the drawing ends (`drawEnd`); it fades once risen, since
          our hang (40 lower, under the subtitle band) leaves its foot at the top edge. */}
      {g.drawEnded > 0 && g.stage !== 'draw' && (
        <Layer name="timer.gone">
          <DrawTimer view={view} rig={rig} style={HIDDEN} offset={room.clockOffset} />
        </Layer>
      )}
      {g.stage === 'bank' && <BankSign rig={rig} />}
      {/* Half-time has no card on the table screen (the original's screws drop into the chairs
          and the auctioneer explains); phones keep theirs. */}
      {g.stage === 'halftime' && <span className="sr-only" data-testid="go-stage-halftime" />}
      {sold && !sold.buyer && (
        <p
          className="absolute left-0 text-center text-4xl font-black drop-shadow"
          style={{ top: 470, width: 1280, fontFamily: FONT.name }}
          data-testid="go-stage-unsold"
        >
          Unsold – it was worth {money(sold.value)}
        </p>
      )}
      {/* The chairs along the bottom, each paddle parked behind its chair until it is used. */}
      <Layer>
        {players.map((p, i) => (
          <Seat
            key={p.id}
            rig={rig}
            m={chairs[i]}
            id={p.id}
            who={p.name}
            shape={g.paddles[p.id]}
            manifest={manifest}
            up={chairsUp}
            lead={lead === p.id && g.stage !== 'sold'}
            screw={g.screwsOn && g.players.some((x) => x.id === p.id && x.screw)}
            gone={room.players.find((x) => x.id === p.id)?.connected === false}
          />
        ))}
      </Layer>
    </>
  );
}

function LeaderShape({
  rig,
  manifest,
  shape,
  who,
}: {
  rig: LoadedRig;
  manifest: unknown;
  shape: number | undefined;
  who: string;
}) {
  const colour = usePlayerColor(who);
  if (shape === undefined) return null;
  return (
    <Layer m={[0.6, 0, 0, 0.6, 0, 0]}>
      <PaddleHead rig={rig} manifest={manifest} shape={shape} colour={colour} />
      <Layer m={[1 / 0.6, 0, 0, 1 / 0.6, 0, 10]}>
        <Label style={{ fontSize: 36, color: '#fff', fontFamily: FONT.label, fontWeight: 400 }}>
          TOP
        </Label>
      </Layer>
    </Layer>
  );
}

/**
 * A player's seat, as the original's: the paddle parked behind the chair (it rises for a bid, the
 * winner and the artist), the chair with the name on its back (lit for the leader), the screw on
 * the chair once screws are on, and the artist's pay rising from it.
 */
function Seat({
  rig,
  m,
  id,
  who,
  shape,
  manifest,
  up,
  lead,
  screw,
  gone,
}: {
  rig: LoadedRig;
  m: number[] | undefined;
  id: string;
  who: string;
  shape: number | undefined;
  manifest: unknown;
  /** The chair is up (else it waits below for the drawing's moment to pop it up). */
  up: boolean;
  /** The top bidder: their name is lit. */
  lead: boolean;
  /** Holds a screw, screws being on. */
  screw: boolean;
  gone: boolean;
}) {
  const colour = usePlayerColor(who);
  const T = rig.tracks;
  const pose = (t: Track | undefined) => (up ? restOf(t) : startOf(t));
  return (
    <Layer m={m}>
      <Layer m={placeOf(rig, 'seat.paddle')}>
        {/* Holds a raised paddle under the next ask (the bid moment's `padcap` steps). */}
        <Layer name={`padcap:${id}`} moving>
          <Layer name={`pad:${id}`} moving style={restOf(T.paddle?.Unraise)}>
            <Layer m={placeOf(rig, 'paddle.wood')}>
              <RigArt rig={rig} symbol="wood" />
            </Layer>
            <Layer m={placeOf(rig, 'paddle.shape')}>
              <PaddleHead rig={rig} manifest={manifest} shape={shape} colour={colour} />
            </Layer>
            <Layer m={placeOf(rig, 'paddle.num')}>
              <Label
                name={`pad:${id}.num`}
                style={{
                  color: '#fff',
                  fontSize: 58,
                  fontFamily: FONT.label,
                  fontWeight: 400,
                  textShadow: '0 1px 0 rgba(0,0,0,.5)',
                }}
              />
            </Layer>
            {/* The paddle's words (WINNER, ARTIST), smaller than an amount, as the original's. */}
            <Layer m={placeOf(rig, 'paddle.num')}>
              <Label
                name={`pad:${id}.word`}
                style={{
                  color: '#fff',
                  fontSize: 40,
                  fontFamily: FONT.label,
                  fontWeight: 400,
                  textShadow: '0 1px 0 rgba(0,0,0,.5)',
                }}
              />
            </Layer>
          </Layer>
        </Layer>
      </Layer>
      <Layer name={`chair:${id}`} moving style={pose(T['seat-d7']?.Appear)}>
        <RigArt rig={rig} symbol="seat-d7" />
      </Layer>
      <Layer name={`name:${id}.seat`} moving style={pose(T['seat-playerName']?.Appear)}>
        <Layer
          name={`name:${id}`}
          moving
          style={lead ? restOf(T.name?.Bid) : restOf(T.name?.Reset)}
        >
          <Label
            style={{
              fontSize: 38,
              color: gone ? '#a8a29e' : '#fff',
              fontFamily: FONT.label,
              fontWeight: 400,
              textTransform: 'uppercase',
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {who}
          </Label>
        </Layer>
      </Layer>
      <Layer m={[1, 0, 0, 1, 0, 43.4]}>
        {/* A screw's head shows in the chair once screws are on, while its player still holds it
            (the screw itself drops in at half-time and comes out to be aimed). */}
        <Layer
          name={`screwhead:${id}`}
          moving
          style={screw ? restOf(T['screws-mc']?.Down) : HIDDEN}
        >
          <ScrewHead rig={rig} colour={PAINT[colour ?? ''] ?? '#e7e5e4'} />
        </Layer>
        <Layer name={`screws:${id}`} moving style={screw ? restOf(T['screws-d1']?.Down) : HIDDEN}>
          <RigArt rig={rig} symbol="screws-d1" />
        </Layer>
      </Layer>
      <Layer m={placeOf(rig, 'seat.artpay')}>
        <Layer name={`artpay:${id}`} moving style={{ opacity: 0 }}>
          <Label
            name={`artpay:${id}.text`}
            style={{
              fontSize: 44,
              color: '#2f7d32',
              fontFamily: FONT.amount,
              textShadow: '0 2px 0 #fff, 0 -1px 0 #fff',
            }}
          />
        </Layer>
      </Layer>
    </Layer>
  );
}

/**
 * The sign and the hourglass hang this much lower than the original's, so their tops clear the
 * subtitles' band (the voice's words stay on screen in their own band, owner).
 */
const HANG: number[] = [1, 0, 0, 1, 0, 40];

/**
 * The drawing, as the original's: the logo grown to the middle of the room, then the sign on its
 * strings with its example drawing itself and the "draw using your device" line, then the
 * hourglass with the seconds left on its top and its sand falling.
 */
function DrawingProps({
  view,
  rig,
  offset,
}: {
  view: GoingOnceView;
  rig: LoadedRig;
  offset: number;
}) {
  const g = view.game!;
  const faces = [
    'doodle-d2',
    ...Object.keys(rig.symbols).filter((k) => k.startsWith('doodle-d2~')),
  ];
  return (
    <>
      {!g.redraw && <StageLogo rig={rig} style={HIDDEN} />}
      <Layer m={HANG}>
        <Layer m={placeOf(rig, 'sign.at')}>
          <Layer name="sign" moving style={HIDDEN}>
            <Layer m={placeOf(rig, 'sign.card')}>
              <RigArt rig={rig} symbol="sign" />
            </Layer>
            {/* The example drawing itself, frame by frame (the original's), on the card. */}
            <Layer m={placeOf(rig, 'doodle.in')}>
              <Faces rig={rig} name="doodle" faces={faces} />
            </Layer>
            <Layer m={placeOf(rig, 'prompt.at')}>
              <Layer name="prompt" moving style={HIDDEN}>
                <RigArt rig={rig} symbol="prompt" />
                <Layer m={[1, 0, 0, 1, 0, 1]}>
                  <Label
                    style={{ ...WORDS, fontSize: 36, color: '#645d4d', fontFamily: FONT.amount }}
                  >
                    Draw using your device now!
                  </Label>
                </Layer>
              </Layer>
            </Layer>
          </Layer>
        </Layer>
      </Layer>
      <DrawTimer view={view} rig={rig} style={HIDDEN} offset={offset} />
    </>
  );
}

/**
 * The hourglass on its strings, as the original's: the seconds left on its top (whole seconds),
 * the sand piling up below as the drawing runs.
 */
function DrawTimer({
  view,
  rig,
  style,
  offset,
}: {
  view: GoingOnceView;
  rig: LoadedRig;
  style: CSSProperties | undefined;
  offset: number;
}) {
  const g = view.game!;
  const drawing = g.stage === 'draw';
  const total = drawing ? Math.max(1, Math.round((g.until - g.drawFrom) / 1000)) : 1;
  // The clock starts when the auctioneer calls for the drawings: until then it shows it whole.
  const left = Math.min(total, useSecondsTo(drawing ? g.until : null, offset) ?? 0);
  const done = drawing ? 1 - Math.min(1, left / total) : 1;
  return (
    <Layer m={HANG}>
      <Layer m={placeOf(rig, 'timer.at')}>
        <Layer name="timer" moving style={style}>
          <Layer m={[1, 0, 0, 1, 0, 102.6]}>
            <RigArt rig={rig} symbol="hourglass" />
          </Layer>
          {/* The sand (the original's is a morph; ours a pile that grows). */}
          <div
            className="absolute"
            style={{
              left: -62,
              top: 250 - 70 * done,
              width: 124,
              height: 70 * done,
              background: '#f5f5f4',
              borderRadius: '50% 50% 8px 8px / 100% 100% 8px 8px',
              transition: 'top 1s linear, height 1s linear',
            }}
          />
          <Layer m={[1, 0, 0, 1, 1.2, 10.8]}>
            <Label
              name="timeNum"
              style={{
                fontSize: 72,
                color: '#fff',
                fontFamily: FONT.label,
                fontWeight: 400,
                lineHeight: 1,
                textShadow: '0 1px 2px rgb(0 0 0 / 0.35)',
              }}
            >
              {drawing ? String(left) : ''}
            </Label>
          </Layer>
        </Layer>
      </Layer>
    </Layer>
  );
}

/** A part the original draws frame by frame: every face, its `data-show` says which shows. */
function Faces({ rig, name, faces }: { rig: LoadedRig; name: string; faces: string[] }) {
  const ref = useTarget(name);
  return (
    <div
      ref={ref}
      data-show={faces[0]}
      style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0' }}
    >
      <style>
        {faces
          .map(
            (f) => `[data-show="${f}"]>[data-face-key]:not([data-face-key="${f}"]){display:none}`,
          )
          .join('')}
      </style>
      {faces.map((f) => (
        <div key={f} data-face-key={f}>
          <RigArt rig={rig} symbol={f} />
        </div>
      ))}
    </div>
  );
}

/** The slide images in the manifest for each of the tutorial's 13 slides (slide 2 by lot count). */
function slideKey(n: number, lots: number) {
  if (n === 2) return `slide-02-${lots}`;
  return `slide-${String(n).padStart(2, '0')}`;
}

/**
 * The tutorial's projector, as the original's: the slides (the original's 13, from the manifest)
 * slide up through the card one after another, under the projector's dust and glow; the Skip line
 * under it.
 */
function Projector({ view, rig, art }: { view: GoingOnceView; rig: LoadedRig; art: Art }) {
  const g = view.game!;
  return (
    <>
      <span className="sr-only" data-testid="go-stage-projector" />
      <Layer m={placeOf(rig, 'tutorial.at')}>
        <Layer name="projector.slides" moving style={HIDDEN}>
          <Layer m={[1, 0, 0, 1, 0, 398]}>
            <div className="absolute overflow-hidden" style={PROJECTOR_BOX}>
              {Array.from({ length: 13 }, (_, i) => {
                const src = art.ui(slideKey(i + 1, g.lotCount));
                return (
                  <Layer
                    key={i}
                    name={`slide:${i + 1}`}
                    moving
                    style={{ transform: `translate(0px, ${i === 0 ? 0 : SLIDE_RISE}px)` }}
                  >
                    {src && (
                      <ProtectedImage
                        src={src}
                        alt=""
                        className="absolute left-0 top-0"
                        style={{ width: PROJECTOR.w, height: PROJECTOR.h, maxWidth: 'none' }}
                      />
                    )}
                  </Layer>
                );
              })}
            </div>
          </Layer>
        </Layer>
        <Layer name="projector.dust" moving style={HIDDEN}>
          <div className="absolute overflow-hidden" style={PROJECTOR_BOX}>
            <Layer m={[1, 0, 0, 1, PROJECTOR.w / 2, PROJECTOR.h / 2]}>
              <RigArt rig={rig} symbol="tutorial-d5" />
            </Layer>
          </div>
        </Layer>
        <Layer name="projector.glow" moving style={HIDDEN}>
          <RigArt rig={rig} symbol="tutorial-d1" />
        </Layer>
      </Layer>
      {/* The Skip line: under the card, so the subtitles' band at the top stays clear. */}
      <Layer m={SKIP_AT}>
        <Layer name="skip" moving style={HIDDEN}>
          <RigArt rig={rig} symbol="skip.content" />
          <Layer m={[1, 0, 0, 1, -54, -16]}>
            <Label style={{ ...WORDS, fontSize: 36, transform: 'translate(-100%, -50%)' }}>
              You can
            </Label>
          </Layer>
          <Layer m={[1, 0, 0, 1, 0, -16]}>
            <Label style={{ ...WORDS, fontSize: 36, color: '#fff', fontFamily: FONT.amount }}>
              Skip
            </Label>
          </Layer>
          <Layer m={[1, 0, 0, 1, 54, -16]}>
            <Label style={{ ...WORDS, fontSize: 36, transform: 'translate(0, -50%)' }}>
              this now
            </Label>
          </Layer>
          <Layer m={[1, 0, 0, 1, 0, 24]}>
            <Label style={{ ...WORDS, fontSize: 36 }}>using the button on your device</Label>
          </Layer>
        </Layer>
      </Layer>
    </>
  );
}

/** The Skip line under the projector's card (the original's at the top, at 0.8). */
/**
 * The projector's picture: the original's slides at their own size (500 × 386); its card and
 * dust textures (580 × 448) show through the original's mask (`tutorial-d4`, `credits-d1`), this box.
 */
const PROJECTOR = { w: 500, h: 386 } as const;
const PROJECTOR_BOX: CSSProperties = {
  left: -PROJECTOR.w / 2,
  top: -PROJECTOR.h / 2,
  width: PROJECTOR.w,
  height: PROJECTOR.h,
  borderRadius: 14,
};
const SKIP_AT = [0.8, 0, 0, 0.8, 640, 548];

/** The bank's sign: its letters and the shark, brought on by the bank moment. */
function BankSign({ rig }: { rig: LoadedRig }) {
  return (
    <Layer m={placeOf(rig, 'bank.at')}>
      {BANK_PARTS.map((p) => (
        <BankPart key={p} rig={rig} part={p} />
      ))}
    </Layer>
  );
}

function BankPart({ rig, part }: { rig: LoadedRig; part: string }) {
  const ref = useTarget(`bank-${part}`);
  const key = `bank-${part}`;
  // Art the original swaps mid-track (the shark's sign): every face, the moment says which shows.
  const faces = [key, ...Object.keys(rig.symbols).filter((k) => k.startsWith(`${key}~`))];
  return (
    <div
      ref={ref}
      data-show={key}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transformOrigin: '0 0',
        ...startOf(rig.tracks[key]?.Appear),
      }}
    >
      {faces.length > 1 && (
        <style>
          {faces
            .map(
              (f) => `[data-show="${f}"]>[data-face-key]:not([data-face-key="${f}"]){display:none}`,
            )
            .join('')}
        </style>
      )}
      {faces.map((f) => (
        <div key={f} data-face-key={f}>
          <RigArt rig={rig} symbol={f} />
        </div>
      ))}
    </div>
  );
}

/**
 * A paddle drawn from the rig: the handle and a silhouette in the player's colour (`stick={false}`:
 * the silhouette alone, where a total stands under it).
 */
function RigPaddle({
  rig,
  manifest,
  shape,
  plain = false,
  who,
  stick = true,
}: {
  rig: LoadedRig;
  manifest: unknown;
  shape: number | undefined;
  /** The original's plain round paddle (the lobby's, before paddles are dealt). */
  plain?: boolean;
  who: string;
  stick?: boolean;
}) {
  const colour = usePlayerColor(who);
  return (
    <>
      {stick && (
        <Layer m={placeOf(rig, 'paddle.wood')}>
          <RigArt rig={rig} symbol="wood" />
        </Layer>
      )}
      <Layer m={placeOf(rig, 'paddle.shape')}>
        {plain ? (
          <RigArt rig={rig} symbol="shape.Boring" tint={PAINT[colour ?? ''] ?? '#e7e5e4'} />
        ) : (
          <PaddleHead rig={rig} manifest={manifest} shape={shape} colour={colour} />
        )}
      </Layer>
    </>
  );
}

/**
 * A screw's head in a chair, as the original's: a disc in the player's colour with its black cross
 * (only the white fill takes the colour, which `RigArt`'s tint would give every path).
 */
function ScrewHead({ rig, colour }: { rig: LoadedRig; colour: string }) {
  const html = useMemo(
    () =>
      symbolSource(rig, 'screws-mc').replace(/fill="rgb\(255,255,255\)"/g, 'style="fill:var(--c)"'),
    [rig],
  );
  return (
    <svg
      width="1"
      height="1"
      aria-hidden="true"
      overflow="visible"
      className="absolute left-0 top-0"
      style={{ overflow: 'visible', '--c': colour } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** A picture paddle's box: the original's silhouettes' median size (181 × 125.5 units). */
const FALLBACK_BOX = [-90.5, 90.5, -62.75, 62.75] as const;

/**
 * A paddle's silhouette in the player's colour: the rig's, or for a shape the rig lacks (the
 * manifest's list has one the original's paddles don't), the manifest's picture as a mask in the
 * original's paddle box (`FALLBACK_BOX`), so the table screen shows the shape the phones show.
 */
function PaddleHead({
  rig,
  manifest,
  shape,
  colour,
}: {
  rig: LoadedRig;
  manifest: unknown;
  shape: number | undefined;
  colour: string | undefined | null;
}) {
  const tint = PAINT[colour ?? ''] ?? '#e7e5e4';
  const key = shapeKey(manifest, rig, shape);
  if (key) return <RigArt rig={rig} symbol={key} tint={tint} />;
  const src = shape === undefined ? null : artFor(manifest as ManifestState).paddle(shape);
  if (!src) return null;
  return (
    <div
      className="absolute"
      style={{
        left: FALLBACK_BOX[0],
        top: FALLBACK_BOX[2],
        width: FALLBACK_BOX[1] - FALLBACK_BOX[0],
        height: FALLBACK_BOX[3] - FALLBACK_BOX[2],
        background: tint,
        maskImage: `url("${src}")`,
        WebkitMaskImage: `url("${src}")`,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  );
}

/**
 * A title on its end plate in the original's label face: `plateText`'s fit, larger by how much
 * narrower the condensed face is than the one it measures for.
 */
function plateFace(title: string): CSSProperties {
  const fit = plateText(title);
  return {
    ...fit,
    fontSize: Math.round(fit.fontSize * LABEL_NARROW),
    fontFamily: FONT.label,
    fontWeight: 400,
    color: '#fff',
  };
}
const LABEL_NARROW = 1.3;

/** The original's amounts: its heavy face. */
const AMOUNT: CSSProperties = { fontFamily: FONT.amount, fontWeight: 900, lineHeight: 1 };

/** The finale row's places for `n` players (the rig's `finaleRow.<count>`). */
function finaleRow(rig: LoadedRig, n: number): (number[] | undefined)[] {
  const count = ['Three', 'Three', 'Three', 'Three', 'Four', 'Five', 'Six'][Math.min(6, n)];
  const list = rig.places[`finaleRow.${count}`] as number[][] | undefined;
  return Array.from({ length: n }, (_, i) => list?.[i]);
}

/** A player's name on their paddle, white in the original's label face. */
function PaddleName({ who }: { who: string }) {
  return (
    <Label
      style={{
        ...WORDS,
        fontSize: 40,
        color: '#fff',
        maxWidth: 150,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {who}
    </Label>
  );
}

/** A paddle with its player's name on it (the end's buyer and finale paddles, as the original's). */
function NamedPaddle({
  rig,
  manifest,
  shape,
  who,
}: {
  rig: LoadedRig;
  manifest: unknown;
  shape: number | undefined;
  who: string;
}) {
  return (
    <>
      <RigPaddle rig={rig} manifest={manifest} shape={shape} who={who} stick={false} />
      <Layer m={placeOf(rig, 'paddle.num')}>
        <PaddleName who={who} />
      </Layer>
    </>
  );
}

/** An amount in a darker shade of a player's colour (the original's end values and totals). */
function ShadeLabel({
  who,
  name,
  size = 52,
  children,
}: {
  who: string;
  name?: string;
  size?: number;
  children: ReactNode;
}) {
  const colour = usePlayerColor(who);
  const tint = who ? PAINT[colour ?? ''] : undefined;
  return (
    <Label
      name={name}
      style={{
        ...AMOUNT,
        fontSize: size,
        color: tint ? `color-mix(in srgb, ${tint} 55%, black)` : '#57534e',
      }}
    >
      {children}
    </Label>
  );
}

/** The original's words on the wall: its label face in capitals. */
const WORDS: CSSProperties = {
  fontFamily: FONT.label,
  fontWeight: 400,
  textTransform: 'uppercase',
  color: '#000',
  lineHeight: 1,
};

/** Our card on the room's easel: the original's 240 × 110 card, made room for the join QR. */
const CARD = { w: 300, h: 150, y: -62 } as const;
/** The room's join QR on the card (stage units): big enough to scan from the sofa. */
const QR_SIZE = 130;

/**
 * The lobby, as the original's: the logo settled small at the top under the join line, the six
 * paddle slots (an empty disc each until a player joins; then their paddle springs up with their
 * name on it), the room's sign on its easel (our card: the room's link as a QR, as we join by link,
 * not code), and the bar asking the host to press Start once enough have joined. After Start the
 * 3-2-1 counts down in the sign.
 */
function Lobby({
  view,
  rig,
  manifest,
  countdown,
}: {
  view: GoingOnceView;
  rig: LoadedRig;
  manifest: unknown;
  countdown: boolean;
}) {
  const seated = view.seats.filter((s) => s.playing);
  const T = rig.tracks;
  // The sign, the join line, the slots and the bar come in with the lobby's moment, once the logo
  // has settled; until it plays they wait out of sight (during the 3-2-1 they stand at rest).
  const until = (t: Track | undefined) => (countdown ? restOf(t) : { ...startOf(t), opacity: 0 });
  return (
    <>
      <StageLogo rig={rig} style={restOf(T.logo?.Shrink)} />
      <JoinLine rig={rig} style={until(T.address?.Appear)} />
      <Slots rig={rig} style={until(T.circle?.Appear)}>
        {(slot) => {
          const p = seated[slot];
          if (!p) return null;
          return (
            <Layer
              name={`login:${p.id}`}
              moving
              style={
                countdown ? restOf(T.login?.Appear) : { ...startOf(T.login?.Appear), opacity: 0 }
              }
            >
              <LoginPaddle rig={rig} manifest={manifest} who={p.name} />
            </Layer>
          );
        }}
      </Slots>
      <Easel
        rig={rig}
        countdown={countdown}
        style={until(T['easel-d1']?.Appear)}
        card={until(T['easel-content']?.Appear)}
      />
      {seated.length >= 3 && <PressBar rig={rig} style={until(T.pressToPlay?.Appear)} />}
    </>
  );
}

/** The original's logo (the rig's), or the room's title without it. */
function StageLogo({ rig, style }: { rig: LoadedRig; style: CSSProperties | undefined }) {
  const { name: title } = usePosterInfo();
  if (!rig.symbols.logo)
    return (
      <p
        className="absolute text-center text-7xl font-black tracking-tight"
        style={{ left: 0, top: 110, width: 1280, color: INK }}
        data-testid="go-stage-lobby-title"
      >
        {title}
      </p>
    );
  return (
    <div data-testid="go-stage-logo">
      <Layer m={placeOf(rig, 'logo.at')}>
        <Layer name="logo" moving style={style}>
          <RigArt rig={rig} symbol="logo" />
        </Layer>
      </Layer>
    </div>
  );
}

/** The join line over the logo, in the original's place and face (our words: we join by link). */
function JoinLine({ rig, style }: { rig: LoadedRig; style: CSSProperties | undefined }) {
  return (
    <Layer m={placeOf(rig, 'address.at')}>
      <Layer name="address" moving style={style}>
        <Layer m={[1, 0, 0, 1, 0, 2]}>
          <Label style={{ ...WORDS, fontSize: 32 }}>
            Scan the sign or open the room’s link to join
          </Label>
        </Layer>
      </Layer>
    </Layer>
  );
}

/** The six paddle slots: the empty disc behind each (`circle:<i>`), and what stands in it. */
function Slots({
  rig,
  style,
  children,
}: {
  rig: LoadedRig;
  style: CSSProperties | undefined;
  children: (slot: number) => ReactNode;
}) {
  const slots = rig.places['logins.slots'] as number[][] | undefined;
  const circles = rig.places['logins.circles'] as number[][] | undefined;
  return (
    <Layer m={placeOf(rig, 'logins.at')}>
      {circles?.map((m, i) => (
        <Layer key={`c${i}`} m={m}>
          <Layer name={`circle:${i}`} moving style={style}>
            <RigArt rig={rig} symbol="circle" />
          </Layer>
        </Layer>
      ))}
      {slots?.map((m, i) => (
        <Layer key={`p${i}`} m={m}>
          {children(i)}
        </Layer>
      ))}
    </Layer>
  );
}

/** A lobby paddle: the original's plain round one in the player's colour, their name on it. */
function LoginPaddle({ rig, manifest, who }: { rig: LoadedRig; manifest: unknown; who: string }) {
  return (
    <>
      <RigPaddle rig={rig} manifest={manifest} shape={undefined} plain who={who} />
      <Layer m={placeOf(rig, 'paddle.num')}>
        <PaddleName who={who} />
      </Layer>
    </>
  );
}

/**
 * The room's sign on its easel (the original's stand and card): our card shows the room's link as
 * a QR; after Start the 3-2-1 takes its place, as the original's code does.
 */
function Easel({
  rig,
  countdown,
  num,
  style,
  card,
}: {
  rig: LoadedRig;
  countdown: boolean;
  /** The countdown's number when no moment sets it (the sign leaving on "1"). */
  num?: string;
  style: CSSProperties | undefined;
  /** The card's own pose (it moves apart from the stand). */
  card: CSSProperties | undefined;
}) {
  const { code } = usePosterInfo();
  const link = typeof window === 'undefined' || !code ? '' : `${window.location.origin}/r/${code}`;
  return (
    <Layer m={placeOf(rig, 'easel.at')}>
      <Layer name="easel.stand" moving style={style}>
        <RigArt rig={rig} symbol="easel-d1" />
      </Layer>
      <Layer name="easel.card" moving style={card}>
        <Layer m={[1, 0, 0, 1, 0.45, CARD.y + 67]}>
          <div
            className="absolute"
            style={{
              left: -CARD.w / 2,
              top: -CARD.h / 2,
              width: CARD.w,
              height: CARD.h,
              background: '#f2f2f2',
              boxShadow: '0 2px 6px rgb(0 0 0 / 0.25)',
            }}
            data-testid="go-stage-sign"
          />
          {countdown ? (
            <Label
              name="easel.num"
              className="go-stage-countdown"
              style={{ fontSize: 110, color: '#655c51', fontFamily: FONT.amount, lineHeight: 1 }}
            >
              {num}
            </Label>
          ) : (
            <>
              {link && (
                <div
                  className="absolute"
                  style={{ left: -CARD.w / 2 + 10, top: -QR_SIZE / 2, width: QR_SIZE }}
                  data-testid="go-stage-qr"
                >
                  <JoinQr text={link} size={QR_SIZE} />
                </div>
              )}
              <Layer m={[1, 0, 0, 1, link ? 70 : 0, 0]}>
                <Label
                  style={{
                    ...WORDS,
                    fontSize: 36,
                    whiteSpace: 'normal',
                    width: link ? 140 : 280,
                    textAlign: 'center',
                  }}
                >
                  Scan to join
                </Label>
              </Layer>
            </>
          )}
        </Layer>
      </Layer>
    </Layer>
  );
}

/** A QR code for `text`, drawn as one SVG path (black modules on the card, a quiet zone of 2). */
function JoinQr({ text, size }: { text: string; size: number }) {
  const d = useMemo(() => {
    const qr = encodeQr(text, { ecc: 'M', border: 2 });
    let path = '';
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) path += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path, n: qr.size };
  }, [text]);
  return (
    <svg
      viewBox={`0 0 ${d.n} ${d.n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label="The room’s link"
    >
      <rect width={d.n} height={d.n} fill="#fff" />
      <path d={d.path} fill="#000" />
    </svg>
  );
}

/** The bar: the original's "press … to play", saying the host presses Start. */
function PressBar({ rig, style }: { rig: LoadedRig; style: CSSProperties | undefined }) {
  return (
    <Layer m={placeOf(rig, 'pressToPlay.at')}>
      <Layer name="press" moving style={style}>
        <RigArt rig={rig} symbol="pressToPlay.content" />
        <Layer m={[1, 0, 0, 1, -164, 3]}>
          <Label style={{ ...WORDS, fontSize: 36, transform: 'translate(-100%, -50%)' }}>
            The host presses
          </Label>
        </Layer>
        <Layer m={[1, 0, 0, 1, 0, 2]}>
          <Label style={{ ...WORDS, fontSize: 32, color: '#fff', fontFamily: FONT.amount }}>
            Start game
          </Label>
        </Layer>
        <Layer m={[1, 0, 0, 1, 159, 3]}>
          <Label style={{ ...WORDS, fontSize: 36, transform: 'translate(0, -50%)' }}>to play</Label>
        </Layer>
      </Layer>
    </Layer>
  );
}

/**
 * The lobby leaving as the drawing starts (its moment flies the sign, the bar and the paddles off):
 * hidden unless that moment plays.
 */
function LobbyLeaving({
  view,
  rig,
  manifest,
  name,
}: {
  view: GoingOnceView;
  rig: LoadedRig;
  manifest: unknown;
  name: NameOf;
}) {
  const order = view.game?.order ?? [];
  return (
    <>
      <JoinLine rig={rig} style={HIDDEN} />
      <Slots rig={rig} style={HIDDEN}>
        {(slot) =>
          order[slot] ? (
            <Layer name={`leave:${order[slot]}`} moving style={HIDDEN}>
              <LoginPaddle rig={rig} manifest={manifest} who={name(order[slot])} />
            </Layer>
          ) : null
        }
      </Slots>
      {/* The sign leaves on the countdown's last number, as the original's. */}
      <Easel rig={rig} countdown num="1" style={HIDDEN} card={HIDDEN} />
      <PressBar rig={rig} style={HIDDEN} />
    </>
  );
}

/**
 * The end: each buyer's art (one to three pictures, as the original lays them out) with titles
 * and values that fly into the buyer's total; then everyone's paddle and total in a row, the
 * shark's bite on debts, and the winners springing up in the light.
 */
function EndScene({
  view,
  rig,
  art,
  manifest,
  name,
  clockOffset,
}: {
  view: GoingOnceView;
  rig: LoadedRig;
  art: Art;
  manifest: unknown;
  name: NameOf;
  clockOffset: number;
}) {
  // Once the winners are on show, everyone's row has gone for good (whatever the moment did).
  const settled = useReached(winnersShownAt(view), clockOffset);
  const g = view.game!;
  const final = g.final!;
  const T = rig.tracks;
  const byItem = new Map(g.results.map((r) => [r.item, r]));
  const buyers = final.filter((f) => f.bought.length > 0);
  const groups = endTimes(view)?.groups ?? [];
  const row = finaleRow(rig, final.length);
  const hidden = (t: Track | undefined): CSSProperties => ({ ...startOf(t), opacity: 0 });
  const chairs = chairsOf(rig.places, g.order.length);
  return (
    <>
      {/* The chairs, dropping away as the end begins to show the floor (the original's). */}
      {g.order.map((id, i) => (
        <Layer key={id} m={chairs[i]}>
          <Layer name={`endchair:${id}`} moving style={HIDDEN}>
            <RigArt rig={rig} symbol="seat-d7" />
          </Layer>
          <Layer name={`endchair:${id}.name`} moving style={HIDDEN}>
            <Label
              style={{
                fontSize: 38,
                color: '#fff',
                fontFamily: FONT.label,
                fontWeight: 400,
                textTransform: 'uppercase',
              }}
            >
              {name(id)}
            </Label>
          </Layer>
        </Layer>
      ))}
      {/* The loan sign, back for the finale's bite when anyone is in debt. */}
      {final.some((f) => f.debt > 0) && <BankSign rig={rig} />}
      <Credits rig={rig} manifest={manifest} />
      {/* Each buyer's art, a group at a time (every drawing they bought, as the original). */}
      {groups.map((grp) => {
        const n = grp.items.length;
        return (
          <Layer key={grp.index} m={AT.art}>
            {grp.items.map((item, k) => {
              const r = byItem.get(item);
              return (
                <Layer
                  key={item}
                  name={`end:${grp.index}:${k}`}
                  moving
                  style={hidden(T[endTrack(n, k)]?.Appear)}
                >
                  <Layer m={placeOf(rig, 'endpic-d1')}>
                    <RigArt rig={rig} symbol="endpic-d1" />
                  </Layer>
                  <div className="absolute overflow-hidden" style={END_CANVAS}>
                    {r && (
                      <Picture
                        drawing={r.drawing}
                        house={r.house}
                        art={art}
                        label={r.title}
                        className="h-full w-full rounded-none"
                      />
                    )}
                  </div>
                  <Layer
                    name={`end:${grp.index}:${k}.name`}
                    moving
                    style={hidden(T['endpic-drawingName']?.NameOn)}
                  >
                    <TitlePlate rig={rig} artist={r?.artist ? name(r.artist) : null} />
                    <Label style={plateFace(r?.title ?? '')}>{r?.title}</Label>
                  </Layer>
                  <Layer
                    name={`end:${grp.index}:${k}.price`}
                    moving
                    style={hidden(T['endpic-price']?.ValueOn)}
                  >
                    <ShadeLabel who={r?.artist ? name(r.artist) : ''} size={34}>
                      {money(r?.value ?? 0)}
                    </ShadeLabel>
                  </Layer>
                </Layer>
              );
            })}
          </Layer>
        );
      })}
      {/* Each buyer's total: their cash, with their art racked into it. */}
      {buyers.map((f, i) => (
        <Layer key={f.id} m={AT.total}>
          <Layer name={`endtotal:${i}`} moving style={hidden(T['total-content']?.Appear)}>
            <NamedPaddle rig={rig} manifest={manifest} shape={g.paddles[f.id]} who={name(f.id)} />
          </Layer>
          <Layer name={`endtotal:${i}.thump`} moving style={hidden(T['total-score']?.Appear)}>
            <Label name={`endtotal:${i}.num`} style={{ ...AMOUNT, fontSize: 52, color: INK }}>
              {money(f.cash + f.art)}
            </Label>
          </Layer>
        </Layer>
      ))}
      {/* The paddles pop in big (the original's), so the totals and names sit above them all
          and the names never scale with them. */}
      {/* The finale row along the bottom, as the original's: each paddle with its name on it, the
          total under it in the player's colour; with a debt the shark rises in front and bites,
          the debt above. */}
      <Layer m={rig.places['finaleRow.at'] as number[] | undefined}>
        {final.map((f, i) => (
          <Layer key={f.id} m={row[i]}>
            <Layer
              name={`finale:${f.id}`}
              moving
              style={settled ? HIDDEN : hidden(T['finale-content']?.Appear)}
            >
              <RigPaddle
                rig={rig}
                manifest={manifest}
                shape={g.paddles[f.id]}
                who={name(f.id)}
                stick={false}
              />
              <Layer m={placeOf(rig, 'paddle.num')}>
                <Layer name={`finale:${f.id}.name`} style={HIDDEN}>
                  <PaddleName who={name(f.id)} />
                </Layer>
              </Layer>
            </Layer>
            <Layer
              name={`finale:${f.id}.scoreL`}
              moving
              style={settled ? HIDDEN : hidden(T['finale-score']?.Appear)}
            >
              <ShadeLabel who={name(f.id)} name={`finale:${f.id}.score`}>
                {money(f.score)}
              </ShadeLabel>
            </Layer>
            <Layer name={`finale:${f.id}.shark`} moving style={hidden(T['finale-d7']?.Debt)}>
              <RigArt rig={rig} symbol="finale-d7" />
            </Layer>
            <Layer name={`finale:${f.id}.debtL`} moving style={hidden(T['finale-debt']?.Debt)}>
              <Label style={{ ...AMOUNT, fontSize: 48, color: '#b3171c' }}>−{money(f.debt)}</Label>
            </Layer>
          </Layer>
        ))}
      </Layer>
    </>
  );
}

/**
 * The credits on the projector, as the original's (its yellow card, the logo and the credits
 * rolling up): the room's game, the manifest's credit, and that the host can play again (their
 * phone has Play again).
 */
function Credits({ rig, manifest }: { rig: LoadedRig; manifest: unknown }) {
  const { name: title } = usePosterInfo();
  const credit = (manifest as { credit?: { text?: unknown } } | null)?.credit?.text;
  return (
    <>
      <Layer m={placeOf(rig, 'credits.at')}>
        <Layer name="credits.card" moving style={HIDDEN}>
          <div className="absolute overflow-hidden" style={PROJECTOR_BOX}>
            <Layer m={[1, 0, 0, 1, PROJECTOR.w / 2, PROJECTOR.h / 2]}>
              <RigArt rig={rig} symbol="credits-d2" />
            </Layer>
          </div>
        </Layer>
        <Layer name="credits.slide" moving style={HIDDEN}>
          <Layer m={[1, 0, 0, 1, -0.5, -8]}>
            <div className="absolute overflow-hidden" style={PROJECTOR_BOX}>
              <div className="go-credits-roll absolute left-0 w-full" style={{ top: PROJECTOR.h }}>
                <style>{CREDITS_ROLL}</style>
                {rig.symbols.logo && (
                  <div className="relative mx-auto" style={{ width: 400, height: 130 }}>
                    <Layer m={[0.55, 0, 0, 0.55, 200, 65]}>
                      <RigArt rig={rig} symbol="logo" />
                    </Layer>
                  </div>
                )}
                <p
                  className="mt-6 px-10 text-center"
                  style={{ ...WORDS, fontSize: 40, textTransform: 'none', color: '#3f3a2f' }}
                >
                  Thanks for playing {title}!
                </p>
                {typeof credit === 'string' && credit && (
                  <p
                    className="mt-6 px-12 text-center"
                    style={{
                      ...WORDS,
                      fontSize: 30,
                      lineHeight: 1.25,
                      textTransform: 'none',
                      color: '#3f3a2f',
                    }}
                  >
                    {credit}
                  </p>
                )}
              </div>
            </div>
          </Layer>
        </Layer>
        <Layer name="credits.glow" moving style={HIDDEN}>
          <RigArt rig={rig} symbol="credits-d7" />
        </Layer>
      </Layer>
      <Layer m={[1, 0, 0, 1, 640, 600]}>
        <Layer name="credits.again" style={HIDDEN}>
          {/* The original's "Play again?" line, in its heavy face (our host starts the next game). */}
          <Label style={{ ...AMOUNT, fontSize: 40, color: '#000', textTransform: 'uppercase' }}>
            The host can play again
          </Label>
        </Layer>
      </Layer>
    </>
  );
}

/** The credits rolling up the card, slowly, round and round (the original's roll). */
const CREDITS_ROLL =
  '@keyframes go-credits-roll{from{transform:translateY(0)}to{transform:translateY(-100%) translateY(-386px)}}' +
  '.go-credits-roll{animation:go-credits-roll 26s linear 1s infinite}' +
  '@media (prefers-reduced-motion:reduce){.go-credits-roll{animation:none;top:40px!important}}';

/**
 * A title's plate at the end, in its artist's colour (house drawings black), as the original
 * tints them, so the end shows who drew what.
 */
function TitlePlate({ rig, artist }: { rig: LoadedRig; artist: string | null }) {
  const colour = usePlayerColor(artist ?? '');
  return (
    <RigArt
      rig={rig}
      symbol="endpic-drawingName"
      tint={artist ? (PAINT[colour ?? ''] ?? '#57534e') : '#1c1917'}
    />
  );
}

/** A picture in the end's layouts (the original's 240 × 320 canvas at 1.1875). */
const END_CANVAS: CSSProperties = { left: -142.4, top: -189.35, width: 285, height: 380 };

/**
 * What the light falls on, above the room's darkening: a spotlight over each seat (the screwer's
 * comes on while they aim) and, at the end, the winners springing up.
 */
function Lights({
  view,
  rig,
  manifest,
  name,
  clockOffset,
}: {
  view: GoingOnceView;
  rig: LoadedRig;
  manifest: unknown;
  name: NameOf;
  clockOffset: number;
}) {
  const g = view.game;
  const settled = useReached(g ? winnersShownAt(view) : null, clockOffset);
  // The winner has left (the original's `winner-out`): the light and the paddle are gone for good.
  const gone = useReached((g && endTimes(view)?.winnerOut) || null, clockOffset);
  if (!g) return null;
  const T = rig.tracks;
  const hidden = (t: Track | undefined): CSSProperties => ({ ...startOf(t), opacity: 0 });
  if (g.stage === 'done' && g.final) {
    const wins = rig.places[`winners.${WINNERS[Math.min(6, g.winners.length)]}`] as
      number[][] | undefined;
    return (
      <>
        {/* The original's round beam in the middle of the darkened room. */}
        {rig.symbols.beam && (
          <Layer
            name="beam"
            moving
            style={
              gone ? HIDDEN : settled ? restOf(T.beam?.WinnerDarken) : hidden(T.beam?.WinnerDarken)
            }
          >
            <RigArt rig={rig} symbol="beam" />
          </Layer>
        )}
        <Layer m={placeOf(rig, 'winners.at')}>
          {g.winners.map((id, i) => (
            <Layer key={id} m={wins?.[i]}>
              <Layer name={`win:${id}.out`} moving style={gone ? HIDDEN : undefined}>
                {/* The paddle with the winner's name on it, as the original's. */}
                <Layer
                  name={`win:${id}`}
                  moving
                  style={
                    settled
                      ? restOf(T['winning-content']?.Appear)
                      : hidden(T['winning-content']?.Appear)
                  }
                >
                  <RigPaddle rig={rig} manifest={manifest} shape={g.paddles[id]} who={name(id)} />
                  <Layer m={placeOf(rig, 'paddle.num')}>
                    <PaddleName who={name(id)} />
                  </Layer>
                </Layer>
                {/* The WINNER! plate on the paddle's handle, in front of it. */}
                <Layer
                  name={`win:${id}.plate`}
                  moving
                  style={
                    settled ? restOf(T['winning-d9']?.Appear) : hidden(T['winning-d9']?.Appear)
                  }
                >
                  <RigArt rig={rig} symbol="winning-d9" />
                  <Layer m={[1, 0, 0, 1, 0, 1.8]}>
                    <Label style={{ fontSize: 23, color: '#000', fontFamily: FONT.amount }}>
                      WINNER!
                    </Label>
                  </Layer>
                </Layer>
              </Layer>
            </Layer>
          ))}
        </Layer>
      </>
    );
  }
  if (g.stage === 'countdown') return null;
  const chairs = chairsOf(rig.places, g.order.length);
  return (
    <>
      {g.order.map((id, i) =>
        chairs[i] === undefined ? null : (
          <Layer key={id} m={chairs[i]}>
            <Layer m={placeOf(rig, 'seat.spot')}>
              <Spotlight rig={rig} name={`spot:${id}`} />
            </Layer>
          </Layer>
        ),
      )}
    </>
  );
}

/**
 * The sold lot's title under the painting; the artist's name waits for their paddle's flip
 * (`title.by`, shown by the Sold moment), as the auctioneer reveals the artist.
 */
function SoldTitle({ title, artist }: { title: string; artist: string | null }) {
  const by = useTarget('title.by');
  return (
    <p className="absolute font-black" style={TITLE} data-testid="go-stage-title">
      <span className="line-clamp-2">“{unquote(title)}”</span>
      {artist && (
        <span ref={by} className="block text-2xl font-bold" style={HIDDEN}>
          by {artist}
        </span>
      )}
    </p>
  );
}

/**
 * Whether the server clock has reached `at` (false while it is null), re-rendering once when it
 * does: what a moment brought on and must stay, the page then renders itself.
 */
function useReached(at: number | null, offset: number): boolean {
  const [reached, setReached] = useState<number | null>(null);
  useEffect(() => {
    if (at === null) return;
    const id = setTimeout(() => setReached(at), Math.max(0, at - (Date.now() + offset)));
    return () => clearTimeout(id);
  }, [at, offset]);
  return at !== null && reached === at;
}
