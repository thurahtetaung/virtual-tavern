import type { Profile } from '@vt/game-sdk/show';
import {
  type LoadedRig,
  LowEffectsNotice,
  ShowTargetsProvider,
  Stamp,
  useShow,
  useShowSettings,
  useShowTargets,
  useRig,
} from '@vt/ui/show';
import {
  type ReactNode,
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GoingOnceView } from '../logic/types.ts';
import { GAME_ID } from './assets.ts';
import { moments } from './show.ts';

// The phone's share of the show: its own small rig (the stamp and the LOT disc; a couple of KB),
// fetched only once the drawing starts, and the same moments as
// the table screen, which `schedule` trims to this phone's profile: with a table screen in the
// room only the short stamp and this player's own cues, without one the fuller show.

const PhoneRig = createContext<LoadedRig | null>(null);

/** The phone's rig, for overlays inside the game. */
export const usePhoneRig = () => useContext(PhoneRig);

export function PhoneShow({
  view,
  you,
  clockOffset,
  profile,
  children,
}: {
  view: GoingOnceView;
  you: string;
  clockOffset: number;
  profile: Profile;
  children: ReactNode;
}) {
  const g = view.game;
  // Nothing in the lobby; the rig comes with the drawing (the canvas frame) and stays.
  const phase =
    !g || view.phase === 'lobby'
      ? 'lobby'
      : g.stage === 'draw' || g.stage === 'intro'
        ? 'draw'
        : g.stage === 'practice'
          ? 'practice'
          : 'auction';
  const rig = useRig(GAME_ID, 'phone', phase, phase === 'draw' ? 'auction' : undefined);
  const targets = useShowTargets();
  const { reduced, low } = useShowSettings();
  const list = useMemo(
    () => (rig ? moments(view, { you, profile }) : []),
    [rig, view, you, profile],
  );
  useShow(list, {
    clock: () => Date.now() + clockOffset,
    profile,
    you,
    reduced,
    low,
    tracks: rig?.tracks ?? {},
    el: targets.el,
  });
  // The battery saver keeps the art (it is still) and only stills the motion (`schedule`).
  return (
    <ShowTargetsProvider targets={targets}>
      <PhoneRig.Provider value={rig}>
        {/* A quiet phone's lot has no room for it: the thumbnail's row carries it then. */}
        {!(profile === 'phone-quiet' && (g?.stage === 'auction' || g?.stage === 'sold')) && (
          <LowEffectsNotice className="mb-2" />
        )}
        {children}
      </PhoneRig.Provider>
    </ShowTargetsProvider>
  );
}

/** The stage's painting is 264 px wide: a picture overlay is scaled to the picture's own width. */
const PAINTING_W = 264;

/**
 * The Sold stamp over a lot's picture on the phone, hidden until the Sold moment slams it on.
 * Without the art nothing: the Sold card says it all.
 */
export function PictureStamp() {
  const rig = usePhoneRig();
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(el.clientWidth / PAINTING_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [rig]);
  if (!rig) return null;
  return (
    <div
      ref={box}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="go-picture-stamp"
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{ transform: `scale(${k})`, transformOrigin: '0 0' }}
      >
        <Stamp rig={rig} />
      </div>
    </div>
  );
}
