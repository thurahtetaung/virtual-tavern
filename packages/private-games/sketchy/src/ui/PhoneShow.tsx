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
import type { SketchyView } from '../logic/types.ts';
import { GAME_ID, type ManifestState, manifestOf } from './assets.ts';
import { jokeFor } from './audio.ts';
import { moments, phaseOf, slotOf } from './show.ts';
import { nameOf } from './status.ts';
import { type DeviceSound, useSound } from './useSound.ts';
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
  device,
  children,
}: {
  view: SketchyView;
  you: string;
  isHost: boolean;
  clockOffset: number;
  profile: Profile;
  stagePresent: boolean;
  manifest: ManifestState;
  device: DeviceSound;
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
    device,
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
        jokeFor: (prompt) => jokeFor(m?.audio, m?.jokes, prompt, names),
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
          <Toast />
        </PhoneRig.Provider>
      </Profiled.Provider>
    </ShowTargetsProvider>
  );
}

/** A personal line ("You fooled 2! +1,000") over the page for a moment, then gone. */
function Toast() {
  const ref = useTarget('toast');
  const el = useRef<HTMLParagraphElement | null>(null);
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
      className="pointer-events-none fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-full bg-stone-900/90 px-4 py-2 text-center text-base font-bold text-white shadow-lg empty:hidden dark:bg-stone-100/95 dark:text-stone-900"
    />
  );
}

/** The phone's profile, for overlays that differ with a table screen in the room. */
export const usePhoneProfile = () => useContext(Profiled);

/** Registers a quiet phone's own element for a moment (`board:<index>`, `like:<index>`). */
export const usePhoneTarget = useTarget;

/** The balloon the original's card turns over: the answer is live text, the art scales to fit. */
const PHONE_W = 360;

/**
 * The reveal card on a phone with no table screen: the original's balloon with the answer, the
 * choosers' names and the author's, played by the same moments as the table screen, scaled to the
 * card's width. Nothing without the art (or with a table screen, or the battery saver on).
 */
export function PhoneCard() {
  const rig = useContext(PhoneRig);
  const profile = useContext(Profiled);
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(el.clientWidth / (PHONE_W + 40));
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
      className="relative h-40 w-full overflow-hidden"
      data-testid="sketchy-phone-card"
    >
      <div
        className="absolute left-1/2 top-12"
        style={{ transform: `scale(${k})`, transformOrigin: '0 0' }}
      >
        <RevealCard
          rig={rig}
          live={{
            'card-bubble': (
              <>
                <Layer m={[1, 0, 0, 1, -180, -40]}>
                  <RigArt rig={rig} symbol="balloon" />
                </Layer>
                <Label
                  name="card.text"
                  style={{
                    color: '#fff',
                    fontSize: 24,
                    fontWeight: 800,
                    whiteSpace: 'normal',
                    width: 320,
                    textAlign: 'center',
                  }}
                />
              </>
            ),
            'card-playersWhoChose': (
              <Layer m={[1, 0, 0, 1, 0, 82]}>
                <Choosers
                  rig={rig}
                  gap={95}
                  nameStyle={{ fontSize: 16, fontWeight: 800 }}
                  pointsStyle={{ fontSize: 18, fontWeight: 900, color: '#15803d' }}
                />
              </Layer>
            ),
            'card-author': (
              <Layer m={[1, 0, 0, 1, 0, -64]}>
                <Label name="author.name" style={{ fontSize: 18, fontWeight: 900 }} />
              </Layer>
            ),
          }}
        />
      </div>
    </div>
  );
}
