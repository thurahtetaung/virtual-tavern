/**
 * Starting the show takes one tap (browsers' autoplay rule): it unlocks sound for the page and
 * goes full screen. Remembered for the page, so moving from the pairing page into the room needs
 * no second tap; a reload asks again.
 */
let started = false;

export const showStarted = () => started;

export function startShow(): void {
  started = true;
  // Full screen where the browser allows it (a TV browser may not).
  void document.documentElement.requestFullscreen?.().catch(() => {});
  // A silent sound inside the tap counts as the page's user gesture for sound from now on.
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22_050);
    source.connect(ctx.destination);
    source.start();
    void ctx.resume().then(() => setTimeout(() => void ctx.close(), 500));
  } catch {
    // No sound on this device: the show still plays.
  }
}
