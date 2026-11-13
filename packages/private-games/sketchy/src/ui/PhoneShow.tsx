import type { Profile } from '@vt/game-sdk/show';
import { revealParts } from '@vt/game-sdk/show';
import {
  Choosers,
  EdgeFlash,
  Label,
  Layer,
  type LoadedRig,
  RevealCard,
  RigArt,
  placeOf,
  ShowTargetsProvider,
  useShow,
  useShowSettings,
  useShowTargets,
  useRig,
  useTarget,
} from '@vt/ui/show';
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type SketchyView, announcerOf } from '../logic/types.ts';
import { GAME_ID, type ManifestState, manifestOf } from './assets.ts';
import { hasLine, jokeFor } from './audio.ts';
import { moments, phaseOf, slotOf } from './show.ts';
import { nameOf } from './status.ts';
import type { Volumes } from '@vt/ui/sound';
import { useSound } from './useSound.ts';
import { useSeen } from './useSeen.ts';

// The phone's share of the show: its own tiny rig (the original's talk balloon and the reveal's
// tracks; no textures), fetched only once the drawings come up, and the same moments as the table
// screen, which `schedule` trims to this phone's profile: with a table screen in the room only the
// player's own cues (a flash and a buzz when they fall for a lie or fool someone, their own
// pencil breaking, their yelp), without one also the reveal card on the board.

const PhoneRig = createContext<LoadedRig | null>(null);
const Profiled = createContext<Profile>('phone-full');

export function PhoneShow({
  view,
  you,
  isHost,
  clockOffset,
  profile,
  stagePresent,
  manifest,
  volumes,
  children,
}: {
  view: SketchyView;
  you: string;
  isHost: boolean;
  clockOffset: number;
  profile: Profile;
  stagePresent: boolean;
  manifest: ManifestState;
  volumes: Volumes;
  children: ReactNode;
}) {
  const phase = phaseOf(view);
  const rig = useRig(GAME_ID, 'phone', phase, phase === 'draw' ? 'turn' : undefined);
  const targets = useShowTargets();
  const { reduced, low } = useShowSettings();
  const seen = useSeen(view, clockOffset);
  const m = manifestOf(manifest);
  const names = useMemo(() => view.seats.map((s) => s.name), [view.seats]);
  const audio = useSound({
    view,
    manifest,
    isHost,
    isStage: false,
    stagePresent,
    clockOffset,
    volumes,
    slot: slotOf(view, you),
  });
  const list = useMemo(
    () =>
      moments(view, {
        you,
        profile,
        seen,
        parts: rig ? revealParts(rig.tracks) : { card: [], chooser: [], author: [] },
        swaps: rig?.swaps,
        jokeFor: (prompt) => jokeFor(m?.audio, m?.jokes, prompt, names, announcerOf(view.settings)),
        hasLine: (key) => hasLine(m?.audio, announcerOf(view.settings), key),
      }),
    [view, you, profile, seen, rig, m, names],
  );
  useShow(list, {
    clock: () => Date.now() + clockOffset,
    profile,
    you,
    reduced,
    low,
    tracks: rig?.tracks ?? {},
    el: targets.el,
    audio,
    words: (text) =>
      text.replace(/\{p:([^}]+)\}/g, (_, id: string) => (id === you ? 'You' : nameOf(view, id))),
  });
  return (
    <ShowTargetsProvider targets={targets}>
      <Profiled.Provider value={profile}>
        <PhoneRig.Provider value={low ? null : rig}>
          {children}
          <EdgeFlash />
        </PhoneRig.Provider>
      </Profiled.Provider>
    </ShowTargetsProvider>
  );
}

/**
 * A personal line ("You fooled 2! +1,000") for a moment, then gone: the phone's `subtitle`, which
 * the show fills and clears (and never replays to a late device). It takes its own line under the
 * status line while it shows, so it never covers the status line's names, a card or a button.
 */
export function Toast() {
  const ref = useTarget('subtitle');
  const el = useRef<HTMLParagraphElement | null>(null);
  // Cleared by itself too: a moment that is settled early never gets to clear its line.
  useEffect(() => {
    const p = el.current;
    if (!p) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = new MutationObserver(() => {
      clearTimeout(timer);
      if (p.textContent) timer = setTimeout(() => (p.textContent = ''), 2600);
    });
    watch.observe(p, { childList: true, characterData: true, subtree: true });
    return () => {
      watch.disconnect();
      clearTimeout(timer);
    };
  }, []);
  return (
    <p
      ref={(node) => {
        el.current = node;
        ref?.(node);
      }}
      role="status"
      data-testid="sketchy-toast"
      className="pointer-events-none flex min-h-10 items-center justify-center rounded-xl bg-ink px-4 py-1.5 text-center text-base font-bold text-page shadow-vt-2 empty:hidden"
    />
  );
}

/** Whether this phone shows the reveal's balloon card (no table screen, the art, no saver). */
export function useCardShown(): boolean {
  const rig = useContext(PhoneRig);
  const profile = useContext(Profiled);
  return rig !== null && profile === 'phone-full';
}

/** The phone's profile, for overlays that differ with a table screen in the room. */
export const usePhoneProfile = () => useContext(Profiled);

/** Registers a quiet phone's own element for a moment (`board:<index>`, `like:<index>`). */
export const usePhoneTarget = useTarget;

/** A lie's words turn white on the balloon, as the table screen's. */
const PHONE_CARD_CSS =
  '.vt-card[data-face=lie] .vt-card-text,.vt-card[data-face=house] .vt-card-text{color:#fff!important}';

/** The balloon the original's card turns over: the answer is live text, the art scales to fit. */
const PHONE_W = 360;
/**
 * The original puts the choosers' names along the balloon's top edge, where a lie's black balloon
 * swallows our dark names: on a phone they sit this far higher (rig units), clear of it.
 */
const CHIPS_LIFT = 32;
/** A crowd's sixth and seventh choosers, which the original puts beside the balloon: a row above. */
const CHIPS_ROW = 30;
/** A light halo round the choosers' names and points, so they read as they fly over the balloon. */
const HALO = '0 0 6px #fbf8f1, 0 0 6px #fbf8f1, 0 0 10px #fbf8f1, 0 0 10px #fbf8f1';
/** Rig units from the card's top to its origin (one row of names), and from the origin to its foot. */
const CARD_TOP = 76;
const CARD_FOOT = 150;

/**
 * The choosers' spots on a phone: the rig's top row as it is, and any spot it puts lower (beside
 * the balloon) in a row above it, between the top row's names, so no name is ever on the balloon.
 */
function phoneSpots(rig: LoadedRig): number[][] | undefined {
  const spots = rig.places['chips.initial'] as number[][] | undefined;
  if (!spots) return undefined;
  const top = spots.filter((m) => (m[5] ?? 0) < 60);
  const y = Math.min(...top.map((m) => m[5] ?? 0)) - CHIPS_ROW;
  const xs = top.map((m) => m[4] ?? 0).sort((a, b) => a - b);
  let gap = 0;
  return spots.map((m) => {
    if ((m[5] ?? 0) < 60) return m;
    // Between two neighbours of the top row, from the outside in.
    const i = gap++ % 2 === 0 ? 0 : xs.length - 2;
    const x = ((xs[i] ?? 0) + (xs[i + 1] ?? 0)) / 2;
    return [m[0]!, m[1]!, m[2]!, m[3]!, x, y];
  });
}

/**
 * The reveal card on a phone with no table screen: the original's balloon with the answer, the
 * choosers' names and the author's, played by the same moments as the table screen, scaled to the
 * card's width. Nothing without the art (or with a table screen, or the battery saver on).
 */
export function PhoneCard({ shown, crowd = false }: { shown: boolean; crowd?: boolean }) {
  const rig = useContext(PhoneRig);
  // A room big enough for six choosers of one title gets the second row of names its room.
  const top = CARD_TOP + (crowd ? CHIPS_ROW : 0);
  const profile = useContext(Profiled);
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(el.clientWidth / (PHONE_W + 160));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [rig]);
  if (!rig || profile !== 'phone-full') return null;
  return (
    <div
      ref={box}
      aria-hidden
      hidden={!shown}
      // As tall as the names above the balloon and the author's tag under it need at this width.
      className="relative w-full overflow-hidden rounded-2xl bg-[#f6f2ea] ring-1 ring-line"
      style={{ height: Math.round((top + CARD_FOOT) * k) || 160 }}
      data-testid="sketchy-phone-card"
    >
      <div
        className="absolute"
        style={{ left: 120 * k, top: top * k, transform: `scale(${k})`, transformOrigin: '0 0' }}
      >
        <style>{PHONE_CARD_CSS}</style>
        <RevealCard
          rig={rig}
          className="vt-card"
          live={{
            'card-bubble': <RigArt rig={rig} symbol="balloon" />,
            'card-titlename': (
              <Layer m={[1, 0, 0, 1, 104, 48]}>
                <Label
                  name="card.text"
                  className="vt-card-text"
                  style={{
                    color: '#1c1917',
                    fontSize: 34,
                    fontWeight: 800,
                    whiteSpace: 'normal',
                    width: 330,
                    textAlign: 'center',
                    lineHeight: 1.05,
                  }}
                />
              </Layer>
            ),
            'card-playersWhoChose': (
              <Layer m={[1, 0, 0, 1, 0, -CHIPS_LIFT]}>
                <Choosers
                  rig={rig}
                  spots={phoneSpots(rig)}
                  nameStyle={{ color: '#1c1917', fontSize: 46, fontWeight: 900, textShadow: HALO }}
                  pointsStyle={{
                    fontSize: 50,
                    fontWeight: 900,
                    color: '#15803d',
                    textShadow: HALO,
                  }}
                />
              </Layer>
            ),
            'card-author': (
              <Layer m={placeOf(rig, 'author.right')}>
                <Label
                  name="author.name"
                  style={{
                    color: '#1c1917',
                    fontSize: 32,
                    fontWeight: 900,
                    background: '#fbf8f1',
                    padding: '2px 14px',
                    borderRadius: 999,
                    boxShadow: '0 0 0 2px #1c1917',
                  }}
                />
              </Layer>
            ),
          }}
        />
      </div>
    </div>
  );
}
