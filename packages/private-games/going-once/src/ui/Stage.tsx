import type { GameRoomInfo } from '@vt/game-sdk';
import { ProtectedImage, usePlayerColor } from '@vt/ui';
import {
  Label,
  Layer,
  type LoadedRig,
  RigArt,
  Scene,
  ShowTargetsProvider,
  Spotlight,
  Stamp,
  placeOf,
  useShow,
  useShowSettings,
  useShowTargets,
  useTarget,
  useRig,
} from '@vt/ui/show';
import type { Track } from '@vt/game-sdk/show';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { money } from '../logic/lines.ts';
import { BID_STEP, type GoingOnceView, OPENING_BID, type PlayerView } from '../logic/types.ts';
import { type Art, GAME_ID, artFor, useManifest } from './assets.ts';
import { endTimes } from './audio.ts';
import { HostStrip } from './Extras.tsx';
import type { GoingOnceUiProps } from './GoingOnceGame.tsx';
import { Picture } from './Picture.tsx';
import {
  BANK_PARTS,
  type RowWhere,
  endTrack,
  moments,
  rowOf,
  shapeKey,
  winnersShownAt,
} from './show.ts';
import type { NameOf } from './text.ts';
import { useDeviceSound, useSound } from './useSound.ts';

// The table screen: the whole auction house on a laptop or TV, from the spectator view. The room
// is the original's vector parts (the rig, from the private manifest's `show` keys) on a
// 1280 × 720 stage; moments (`show.ts`) move them on the server clock while the sound plays the
// same beats. Nothing here is secret: the view is the one every watcher gets.

/** The manifest's file groups (`show.stage.phases`) for the stage the game is in. */
function phaseOf(view: GoingOnceView): string {
  const g = view.game;
  if (view.phase === 'lobby' || !g) return 'lobby';
  switch (g.stage) {
    case 'intro':
    case 'draw':
      return 'draw';
    case 'practice':
      return 'practice';
    case 'done':
      return 'end';
    default:
      return 'auction';
  }
}
const NEXT: Record<string, string> = {
  lobby: 'draw',
  draw: 'auction',
  practice: 'auction',
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
 * Where things stand in the room. The original's own places put a small painting at the top left
 * and the paddles behind the floor's edge; on a TV across a room the lot is the point, so the
 * painting hangs large on the left (the camera is closed in on the easel), the LOT disc beside it,
 * the bidding on the right, and the paddles stand in a full row above the floor with the names on
 * it. Parts keep the original's own motion (their tracks) inside these places.
 */
const PAINTING_K = 1.3;
const AT = {
  painting: [PAINTING_K, 0, 0, PAINTING_K, 90, 40],
  /** The stamp sits on the painting's middle, outside its scale (the original's size). */
  stamp: [1, 0, 0, 1, 90 + 148 * PAINTING_K, 40 + 175 * PAINTING_K],
  lot: [1, 0, 0, 1, 690, 14],
  bidLabel: [1, 0, 0, 1, 880, 150],
  bidAmount: [1, 0, 0, 1, 876, 196],
  bidFrom: [1, 0, 0, 1, 1190, 180],
  bidPrompt: [0.42, 0, 0, 0.42, 882, 286],
  /** The end's art layouts (their pictures slide in relative to this). */
  art: [1, 0, 0, 1, 640, 160],
  /** A buyer's total, where the values fly to. */
  total: [1, 0, 0, 1, 640, 560],
};
/** The seats: the original's row, a little smaller. */
const SEAT_K = 0.8;
/** Each seat's height: a lowered paddle stands on the floor's line. */
const ROW_Y = 520;
/** A seat's place: `x` from `rowOf`. */
const seatAt = (x: number, y = ROW_Y) => [SEAT_K, 0, 0, SEAT_K, x, y];

/** A player's name, on the floor under their paddle. */
const NAME_AT = [1, 0, 0, 1, 0, 190];

/** The lot's canvas in the painting (the original's 240 × 320 at 1.1875). */
const CANVAS: CSSProperties = { left: 0, top: 0, width: 285, height: 380, borderRadius: 3 };
/** The sold lot's title, under the painting (clear of the paddles, which stand right of it). */
const TITLE: CSSProperties = {
  left: 90,
  top: 548,
  width: 380,
  fontSize: 28,
  lineHeight: 1.15,
  color: '#1c1917',
  textAlign: 'left',
};
/** Text on the gallery wall. */
const INK = '#1c1917';
/** Text that starts at its layer's origin (the original's text fields). */
const LEFT: CSSProperties = { transform: 'translate(0, -50%)' };
/** The amount the auctioneer asks for next. */
const nextAsk = (top: number | undefined) => (top ? top + BID_STEP : OPENING_BID);

/** The host's words along the top (the row of seats is along the bottom), sized for a room. */
const HOST_STRIP: CSSProperties = {
  left: 290,
  top: 8,
  width: 700,
  transform: 'scale(1.4)',
  transformOrigin: '50% 0',
};
/**
 * During a lot, the host's words over the bidding column, clear of the painting, the LOT disc and
 * the strings they hang from.
 */
const HOST_STRIP_LOT: CSSProperties = {
  left: 836,
  top: 8,
  width: 310,
  transform: 'scale(1.4)',
  transformOrigin: '0 0',
};

/** A part not on show. */
const HIDDEN: CSSProperties = { opacity: 0 };

/** The room's size in stage units. */
const ROOM: CSSProperties = { width: 1280, height: 720 };

const WINNERS = ['One', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

/** Where the row stands in this phase: right of the painting while a lot is on. */
const rowWhere = (view: GoingOnceView): RowWhere =>
  phaseOf(view) === 'auction' || phaseOf(view) === 'practice' ? 'lot' : 'room';

/** The lot on the easel as the stage draws it: an auctioned lot or the practice lot. */
function lotView(view: GoingOnceView) {
  const g = view.game;
  if (!g) return null;
  if (g.stage === 'practice' && g.practice) {
    const p = g.practice;
    if (p.step === 'hint') return null;
    return {
      label: 'Practice',
      bid: p.bid,
      picture: { item: 'practice', drawing: null, house: p.house, hidden: false },
    };
  }
  const a = g.auction;
  if (!a || (g.stage !== 'auction' && g.stage !== 'sold')) return null;
  return { label: `${a.lot + 1}/${g.lotCount}`, bid: a.bid, picture: a.picture };
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
    for (const id of ids.split('|')) at[id] ??= Date.now() + offset;
    setSeen({ ids, at });
  }
  return seen?.at ?? {};
}

export function GoingOnceStage({ view, room }: GoingOnceUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const [device] = useDeviceSound();
  useSound({
    view,
    manifest,
    you: null,
    isHost: false,
    clockOffset: room.clockOffset,
    device,
    colours: room.players.flatMap((p) => (p.color ? [p.color] : [])),
    stagePresent: true,
    isStage: true,
  });
  const phase = phaseOf(view);
  const rig = useRig(GAME_ID, 'stage', phase, NEXT[phase]);
  const targets = useShowTargets();
  const { reduced, low } = useShowSettings();
  const offset = room.clockOffset;
  const joined = useJoined(view, offset);
  const list = useMemo(
    () => (rig ? moments(view, { you: null, profile: 'stage', joined, swaps: rig.swaps }) : []),
    [rig, view, joined],
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
        className="h-full w-full bg-stone-950 text-white"
        data-theme="dark"
        data-testid="go-stage"
        data-phase={phase}
      >
        <Scene
          background={
            bg ? (
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
            )
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
              <div
                className="absolute"
                style={rowWhere(view) === 'lot' ? HOST_STRIP_LOT : HOST_STRIP}
              >
                {view.game && <HostStrip view={view} art={art} name={name} clockOffset={offset} />}
              </div>
            </>
          }
        >
          {rig ? (
            <Room view={view} room={room} rig={rig} art={art} manifest={manifest} name={name} />
          ) : (
            <Plain view={view} art={art} name={name} />
          )}
        </Scene>
      </div>
    </ShowTargetsProvider>
  );
}

/**
 * Without the private art (dev, tests without a manifest): the room in words and the pictures,
 * still big enough to read across a room.
 */
function Plain({ view, art, name }: { view: GoingOnceView; art: Art; name: NameOf }) {
  const g = view.game;
  const lot = lotView(view);
  const sold = g?.stage === 'sold' ? g.results.at(-1) : undefined;
  return (
    <div
      className="flex flex-col items-center justify-center gap-6 bg-stone-900 p-12 text-center text-white"
      style={ROOM}
      data-testid="go-stage-plain"
    >
      {!g ? (
        <>
          <p className="text-7xl font-black">Going Once</p>
          <p className="text-3xl">
            {view.seats
              .filter((s) => s.playing)
              .map((s) => s.name)
              .join(' · ')}
          </p>
        </>
      ) : g.stage === 'done' && g.final ? (
        <p className="text-6xl font-black" data-testid="go-stage-winner">
          {g.winners.map(name).join(' & ')} {g.winners.length === 1 ? 'wins' : 'share the win'}!
        </p>
      ) : lot ? (
        <div className="flex items-center gap-12">
          <div className="w-72">
            <Picture
              drawing={lot.picture.drawing}
              house={lot.picture.house}
              hidden={lot.picture.hidden}
              art={art}
              label="The lot"
            />
          </div>
          <div className="flex flex-col gap-3 text-left">
            <p className="text-3xl font-bold">Lot {lot.label}</p>
            {sold ? (
              <p className="text-5xl font-black" data-testid="go-stage-sold">
                {sold.buyer
                  ? `SOLD to ${name(sold.buyer)} for ${money(sold.price)}`
                  : `Unsold – it was worth ${money(sold.value)}`}
              </p>
            ) : (
              <p className="text-6xl font-black" data-testid="go-stage-bid">
                {money(lot.bid?.amount ?? OPENING_BID)}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-6xl font-black">{STAGE_WORDS[g.stage]}</p>
      )}
    </div>
  );
}

const STAGE_WORDS: Record<string, string> = {
  intro: 'How the auction works',
  draw: 'Look at your phone and draw',
  practice: 'The practice lot',
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
  const seats = rowOf(rig.places, players.length, rowWhere(view));
  const a = lotView(view);
  const sold = g?.stage === 'sold' ? g.results.at(-1) : undefined;
  const lead = a?.bid?.by ?? null;
  const T = rig.tracks;
  if (!g) return <Lobby view={view} rig={rig} manifest={manifest} seats={seats} />;
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
  return (
    <>
      {a && (
        <>
          {/* The LOT disc, under the painting as the original layers them. */}
          <Layer m={AT.lot}>
            <Layer name="lot" moving style={startOf(T.lot?.Appear)}>
              <RigArt rig={rig} symbol="disc" />
              <Layer m={[1, 0, 0, 1, 0, 12]}>
                <Label name="lot.num" style={{ color: '#4a2f17', fontSize: 30 }}>
                  {a.label}
                </Label>
              </Layer>
            </Layer>
          </Layer>
          {/* The painting on the easel (the frame under the canvas), the stamp at its middle. */}
          <Layer m={AT.painting}>
            <Layer name="painting" moving style={startOf(T.painting?.Appear)}>
              <Layer m={placeOf(rig, 'painting.frame')}>
                <RigArt rig={rig} symbol="painting.frame" />
              </Layer>
              <div
                className="absolute overflow-hidden"
                style={CANVAS}
                data-testid="go-stage-picture"
              >
                {(a.picture.drawing || a.picture.house || a.picture.hidden) && (
                  <Picture
                    drawing={a.picture.drawing}
                    house={a.picture.house}
                    hidden={a.picture.hidden}
                    art={art}
                    label="The lot"
                    className="h-full w-full rounded-none"
                  />
                )}
              </div>
            </Layer>
          </Layer>
          <Layer m={AT.stamp}>
            <Layer name="stampSpin">
              <Stamp rig={rig} line="below" />
            </Layer>
          </Layer>
          {sold?.buyer && (
            <SoldTitle
              title={sold.title}
              artist={sold.artistKnown && sold.artist ? name(sold.artist) : null}
            />
          )}
          {/* The phone that rings while the tips go out. */}
          <Layer m={placeOf(rig, 'phone.at')}>
            <Layer name="phone" moving style={startOf(T.phone?.Appear)}>
              <RigArt rig={rig} symbol="ring-d7" />
            </Layer>
          </Layer>
          {/* The bid: its label, the amount, the leader's shape, and the next ask. */}
          <Layer m={AT.bidLabel}>
            <Layer name="bidLabel" moving style={startOf(T.bidLabel?.Appear)}>
              <Label name="bidLabel.text" style={{ ...LEFT, fontSize: 28, color: INK }}>
                {sold ? 'Winning bid' : a.bid ? 'Current bid' : 'Opening bid'}
              </Label>
            </Layer>
          </Layer>
          <Layer m={AT.bidAmount}>
            <Layer name="bidAmount" moving style={startOf(T.bidAmount?.Appear)}>
              <Label name="bidAmount.text" style={{ ...LEFT, fontSize: 64, color: INK }}>
                {money(a.bid?.amount ?? OPENING_BID)}
              </Label>
            </Layer>
          </Layer>
          <Layer m={AT.bidFrom}>
            <Layer name="bidFrom" moving style={startOf(T.bidFrom?.Appear)}>
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
          <Layer m={AT.bidPrompt}>
            <Layer name="bidPrompt" moving style={startOf(T.bidPrompt?.Appear)}>
              <Label name="bidPrompt.text" style={{ ...LEFT, fontSize: 90, color: INK }}>
                {`${money(nextAsk(a.bid?.amount))}?`}
              </Label>
            </Layer>
          </Layer>
        </>
      )}
      {g.stage === 'draw' && <DrawingProps view={view} rig={rig} />}
      {g.stage === 'bank' && <BankSign rig={rig} />}
      {sold && !sold.buyer && (
        <p
          className="absolute left-0 text-center text-4xl font-black drop-shadow"
          style={{ top: 470, width: 1280 }}
          data-testid="go-stage-unsold"
        >
          Unsold – it was worth {money(sold.value)}
        </p>
      )}
      {/* The players' row. */}
      <Layer>
        {players.map((p, i) => (
          <Seat
            key={p.id}
            rig={rig}
            m={seats[i] === undefined ? undefined : seatAt(seats[i])}
            id={p.id}
            who={p.name}
            shape={g.paddles[p.id]}
            manifest={manifest}
            done={g.stage === 'draw' && g.players.some((x) => x.id === p.id && x.drawn)}
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
  const key = shapeKey(manifest, rig, shape);
  if (!key) return null;
  return (
    <Layer m={[0.6, 0, 0, 0.6, 0, 0]}>
      <RigArt rig={rig} symbol={key} tint={PAINT[colour ?? ''] ?? '#e7e5e4'} />
    </Layer>
  );
}

/** A player's seat: their paddle (shape in their colour, the amount on it), name, screw, light. */
function Seat({
  rig,
  m,
  id,
  who,
  shape,
  manifest,
  done,
  screw,
  gone,
}: {
  rig: LoadedRig;
  m: number[] | undefined;
  id: string;
  who: string;
  shape: number | undefined;
  manifest: unknown;
  /** Has sent both drawings (the drawing's tick). */
  done: boolean;
  /** Holds a screw, screws being on. */
  screw: boolean;
  gone: boolean;
}) {
  const colour = usePlayerColor(who);
  const key = shapeKey(manifest, rig, shape);
  const T = rig.tracks;
  return (
    <Layer m={m}>
      <Layer m={placeOf(rig, 'seat.paddle')}>
        <Layer name={`pad:${id}`} moving style={restOf(T.paddle?.Unraise)}>
          <Layer m={placeOf(rig, 'paddle.wood')}>
            <RigArt rig={rig} symbol="wood" />
          </Layer>
          {key && (
            <Layer m={placeOf(rig, 'paddle.shape')}>
              <RigArt rig={rig} symbol={key} tint={PAINT[colour ?? ''] ?? '#e7e5e4'} />
            </Layer>
          )}
          <Layer m={placeOf(rig, 'paddle.num')}>
            <Label
              name={`pad:${id}.num`}
              style={{ color: '#fff', fontSize: 22, textShadow: '0 1px 0 rgba(0,0,0,.5)' }}
            />
          </Layer>
        </Layer>
      </Layer>
      <Layer m={[1, 0, 0, 1, 0, 43.4]}>
        {/* A screw shows in the paddle once screws are on, while its player still holds it. */}
        <Layer name={`screws:${id}`} moving style={screw ? restOf(T['screws-d1']?.Down) : HIDDEN}>
          <RigArt rig={rig} symbol="screws-d1" />
        </Layer>
      </Layer>
      <Layer m={NAME_AT}>
        {done && (
          <Layer m={[1, 0, 0, 1, 0, -34]}>
            <Label style={{ fontSize: 30, color: '#4ade80', textShadow: '0 1px 2px #000' }}>
              ✓
            </Label>
          </Layer>
        )}
        <Label style={{ ...NAME, color: gone ? '#78716c' : INK }}>{who}</Label>
      </Layer>
      <Layer m={placeOf(rig, 'seat.artpay')}>
        <Layer name={`artpay:${id}`} moving style={{ opacity: 0 }}>
          <Label
            name={`artpay:${id}.text`}
            style={{ fontSize: 34, color: '#2f7d32', textShadow: '0 2px 0 #fff, 0 -1px 0 #fff' }}
          />
        </Layer>
      </Layer>
    </Layer>
  );
}

/** The drawing: the hourglass with the clock, and the sign. */
function DrawingProps({ view, rig }: { view: GoingOnceView; rig: LoadedRig }) {
  const g = view.game!;
  const left = useSecondsLeft(g.until);
  const T = rig.tracks;
  return (
    <>
      <Layer m={placeOf(rig, 'timer.at')}>
        <Layer name="timer" moving style={startOf(T.timer?.Appear)}>
          {/* Lower than the original's (which hangs from the top), so all of it shows under
              the host's words. */}
          <Layer m={[1, 0, 0, 1, -330, 68]}>
            <RigArt rig={rig} symbol="hourglass" />
          </Layer>
          <Layer m={[1, 0, 0, 1, -330, 238]}>
            <Label
              name="timeNum"
              style={{ fontSize: 44, color: '#fff', textShadow: '0 2px 4px #000' }}
            >
              {left}
            </Label>
          </Layer>
        </Layer>
      </Layer>
      {/* The sign, a little smaller than the original's so its words clear the row. */}
      <Layer m={[0.75, 0, 0, 0.75, 640, 300]}>
        <Layer name="sign" moving style={startOf(T.sign?.Appear)}>
          <RigArt rig={rig} symbol="sign" />
          <Layer m={[1, 0, 0, 1, 0, 360]}>
            <Label
              style={{
                fontSize: 34,
                color: '#1c1917',
                whiteSpace: 'normal',
                width: 360,
                textAlign: 'center',
              }}
            >
              Look at your phone and draw
            </Label>
          </Layer>
        </Layer>
      </Layer>
    </>
  );
}

function useSecondsLeft(until: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

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
  shapeKey: key,
  who,
  stick = true,
}: {
  rig: LoadedRig;
  shapeKey: string | null;
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
      {key && (
        <Layer m={placeOf(rig, 'paddle.shape')}>
          <RigArt rig={rig} symbol={key} tint={PAINT[colour ?? ''] ?? '#e7e5e4'} />
        </Layer>
      )}
    </>
  );
}

/** A name under a paddle: dark on the light wall, big enough across a room. */
const NAME: CSSProperties = { fontSize: 30, color: INK };

/**
 * The lobby: the game's name and how to join, and each player's paddle popping up into the row
 * as they sit down (the plain round paddle: shapes are dealt when the game starts).
 */
function Lobby({
  view,
  rig,
  seats,
}: {
  view: GoingOnceView;
  rig: LoadedRig;
  manifest: unknown;
  seats: number[];
}) {
  const seated = view.seats.filter((s) => s.playing);
  const T = rig.tracks;
  return (
    <>
      <div className="absolute text-center" style={{ left: 0, top: 120, width: 1280, color: INK }}>
        <p className="text-7xl font-black tracking-tight">Going Once</p>
        <p className="mt-4 text-3xl font-bold">Join on your phone: open the room’s link.</p>
        <p className="mt-2 text-2xl">
          {seated.length < 3
            ? `${3 - seated.length} more to start`
            : `${seated.length} bidders · the host starts when everyone’s in`}
        </p>
      </div>
      {seated.map((p, i) => (
        <Layer key={p.id} m={seats[i] === undefined ? undefined : seatAt(seats[i])}>
          <Layer m={placeOf(rig, 'seat.paddle')}>
            <Layer
              name={`login:${p.id}`}
              moving
              style={{ ...startOf(T.login?.Appear), opacity: 0 }}
            >
              <Layer m={[1, 0, 0, 1, 0, -130]}>
                <RigPaddle rig={rig} shapeKey="shape.Boring" who={p.name} />
              </Layer>
            </Layer>
          </Layer>
          <Layer m={NAME_AT}>
            <Label style={NAME}>{p.name}</Label>
          </Layer>
        </Layer>
      ))}
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
  const row = rowOf(rig.places, final.length, 'room');
  const hidden = (t: Track | undefined): CSSProperties => ({ ...startOf(t), opacity: 0 });
  return (
    <>
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
                        hidden={r.hidden}
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
                    <Label
                      style={{
                        fontSize: 26,
                        color: '#fff',
                        textShadow: '0 1px 3px rgba(0,0,0,.85)',
                      }}
                    >
                      {r?.title}
                    </Label>
                  </Layer>
                  <Layer
                    name={`end:${grp.index}:${k}.price`}
                    moving
                    style={hidden(T['endpic-price']?.ValueOn)}
                  >
                    <Label style={{ fontSize: 34, color: '#2f7d32', textShadow: '0 2px 0 #fff' }}>
                      {money(r?.value ?? 0)}
                    </Label>
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
          <Layer name={`endtotal:${i}`} style={{ opacity: 0 }}>
            <Layer name={`endtotal:${i}.thump`} moving>
              <Label style={{ fontSize: 30, color: INK, transform: 'translate(-50%, -110%)' }}>
                {name(f.id)}
              </Label>
              <Label
                name={`endtotal:${i}.num`}
                style={{ fontSize: 54, color: INK, transform: 'translate(-50%, 0)' }}
              >
                {money(f.cash + f.art)}
              </Label>
            </Layer>
          </Layer>
        </Layer>
      ))}
      <Layer>
        {final.map((f, i) => (
          <Layer key={f.id} m={row[i] === undefined ? undefined : seatAt(row[i], 420)}>
            <Layer
              name={`finale:${f.id}`}
              moving
              style={settled ? HIDDEN : hidden(T['finale-content']?.Appear)}
            >
              <RigPaddle
                rig={rig}
                shapeKey={shapeKey(manifest, rig, g.paddles[f.id])}
                who={name(f.id)}
                stick={false}
              />
              <Layer m={[1, 0, 0, 1, 0, 130]}>
                <Label style={NAME}>{name(f.id)}</Label>
              </Layer>
            </Layer>
            <Layer name={`finale:${f.id}.shark`} moving style={hidden(T['finale-d7']?.Debt)}>
              <RigArt rig={rig} symbol="finale-d7" />
            </Layer>
            <Layer
              name={`finale:${f.id}.scoreL`}
              moving
              style={settled ? HIDDEN : hidden(T['finale-score']?.Appear)}
            >
              <Label name={`finale:${f.id}.score`} style={{ fontSize: 40, color: INK }}>
                {money(f.score)}
              </Label>
            </Layer>
            <Layer name={`finale:${f.id}.debtL`} moving style={hidden(T['finale-debt']?.Debt)}>
              <Label style={{ fontSize: 36, color: '#b91c1c', textShadow: '0 2px 0 #fff' }}>
                −{money(f.debt)}
              </Label>
            </Layer>
          </Layer>
        ))}
      </Layer>
    </>
  );
}

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
  if (!g) return null;
  const T = rig.tracks;
  const hidden = (t: Track | undefined): CSSProperties => ({ ...startOf(t), opacity: 0 });
  if (g.stage === 'done' && g.final) {
    const final = g.final;
    const wins = rig.places[`winners.${WINNERS[Math.min(6, g.winners.length)]}`] as
      number[][] | undefined;
    return (
      <>
        <WinLine
          shown={settled}
          text={`${
            g.winners.length === 1
              ? `${name(g.winners[0])} wins`
              : `${g.winners.map(name).join(' & ')} share the win`
          } with ${money(final.find((f) => f.id === g.winners[0])?.score ?? 0)}!`}
        />
        <Layer m={placeOf(rig, 'winners.at')}>
          {g.winners.map((id, i) => (
            <Layer key={id} m={wins?.[i]}>
              <Layer
                name={`win:${id}`}
                moving
                style={
                  settled
                    ? restOf(T['winning-content']?.Appear)
                    : hidden(T['winning-content']?.Appear)
                }
              >
                <RigPaddle
                  rig={rig}
                  shapeKey={shapeKey(manifest, rig, g.paddles[id])}
                  who={name(id)}
                />
                <Layer m={[1, 0, 0, 1, 0, 100]}>
                  <Label style={{ fontSize: 22, color: '#fff', textShadow: '0 1px 3px #000' }}>
                    {name(id)}
                  </Label>
                </Layer>
              </Layer>
            </Layer>
          ))}
        </Layer>
      </>
    );
  }
  const seats = rowOf(rig.places, g.order.length, rowWhere(view));
  return (
    <>
      {g.order.map((id, i) =>
        seats[i] === undefined ? null : (
          <Layer key={id} m={seatAt(seats[i])}>
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
      <span className="line-clamp-3">“{title}”</span>
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

/** The winner's line at the end: brought on by the winner moment, then shown for good (`shown`). */
function WinLine({ text, shown }: { text: string; shown: boolean }) {
  const ref = useTarget('winline');
  return (
    <div
      ref={ref}
      className="absolute text-center font-black"
      style={{
        left: 0,
        top: 24,
        width: 1280,
        fontSize: 64,
        color: '#fff',
        textShadow: '0 3px 8px #000',
        opacity: shown ? 1 : 0,
      }}
      data-testid="go-stage-winner"
    >
      {text}
    </div>
  );
}
