/**
 * Hydra's animations. Tailwind covers the layout; these are the "moments" (flips, stamps, the
 * chaos shake, the shuffle). Everything here turns into a short fade, or nothing, under
 * `prefers-reduced-motion`.
 */
const CSS = `
.hy-card3d { perspective: 900px; }
.hy-flipper { position: relative; transform-style: preserve-3d; transition: transform .55s cubic-bezier(.2,.7,.3,1); }
.hy-flipper[data-up="true"] { transform: rotateY(180deg); }
.hy-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.hy-face-front { transform: rotateY(180deg); }

@keyframes hy-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes hy-rise { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
@keyframes hy-pop { 0% { opacity: 0; transform: scale(.6) } 70% { opacity: 1; transform: scale(1.06) } 100% { transform: scale(1) } }
@keyframes hy-stamp { 0% { opacity: 0; transform: scale(2.6) rotate(-14deg) } 60% { opacity: 1; transform: scale(.94) rotate(-8deg) } 100% { opacity: 1; transform: scale(1) rotate(-8deg) } }
@keyframes hy-shake { 0%,100% { transform: translate(0,0) rotate(0) } 15% { transform: translate(-6px,2px) rotate(-3deg) } 30% { transform: translate(5px,-2px) rotate(3deg) } 45% { transform: translate(-4px,1px) rotate(-2deg) } 60% { transform: translate(4px,-1px) rotate(2deg) } 75% { transform: translate(-2px,0) rotate(-1deg) } }
@keyframes hy-glow { 0%,100% { box-shadow: 0 0 0 0 rgb(239 68 68 / 0) } 50% { box-shadow: 0 0 0 4px rgb(239 68 68 / .55), 0 0 18px 4px rgb(239 68 68 / .35) } }
@keyframes hy-ignite { 0% { filter: brightness(1) saturate(1); transform: scale(1) } 40% { filter: brightness(1.9) saturate(1.6); transform: scale(1.18) } 100% { filter: brightness(1.15); transform: scale(1) } }
@keyframes hy-drop { 0% { opacity: 0; transform: translateY(-26px) rotate(-10deg) } 70% { opacity: 1; transform: translateY(3px) rotate(2deg) } 100% { transform: none } }
@keyframes hy-swap-a { 0% { transform: translateX(0) } 35% { transform: translateX(calc(100% + .75rem)) rotate(4deg) } 65% { transform: translateX(calc(100% + .75rem)) rotate(-3deg) } 100% { transform: translateX(0) } }
@keyframes hy-swap-b { 0% { transform: translateX(0) } 35% { transform: translateX(calc(-100% - .75rem)) rotate(-4deg) } 65% { transform: translateX(calc(-100% - .75rem)) rotate(3deg) } 100% { transform: translateX(0) } }
@keyframes hy-spot { 0%,100% { box-shadow: 0 0 0 9999px rgb(0 0 0 / .72), 0 0 40px 10px rgb(251 191 36 / .35) } 50% { box-shadow: 0 0 0 9999px rgb(0 0 0 / .78), 0 0 60px 18px rgb(251 191 36 / .6) } }
@keyframes hy-flap { from { transform: rotateX(0) } to { transform: rotateX(178deg) } }
@keyframes hy-slide-out { from { transform: translateY(0) } to { transform: translateY(-58%) } }
@keyframes hy-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.035) } }
@keyframes hy-ribbon { from { opacity: 0; transform: translateX(-30%) skewX(-12deg) } to { opacity: 1; transform: skewX(-12deg) } }
@keyframes hy-lamp { 0%,100% { box-shadow: 0 0 0 0 rgb(244 63 94 / .0) } 50% { box-shadow: 0 0 10px 3px rgb(244 63 94 / .8) } }

.hy-fade { animation: hy-fade .35s ease-out both; }
.hy-rise { animation: hy-rise .45s cubic-bezier(.2,.7,.3,1) both; animation-delay: var(--d, 0ms); }
.hy-pop { animation: hy-pop .45s cubic-bezier(.2,.7,.3,1) both; animation-delay: var(--d, 0ms); }
.hy-stamp { animation: hy-stamp .5s cubic-bezier(.2,.8,.3,1.2) both; animation-delay: var(--d, 0ms); }
.hy-shake { animation: hy-shake .5s ease-in-out 4; }
.hy-glow { animation: hy-glow 1.8s ease-in-out infinite; }
.hy-ignite { animation: hy-ignite 1.1s ease-out both; animation-delay: var(--d, 0ms); }
.hy-drop { animation: hy-drop .55s cubic-bezier(.2,.7,.3,1.2) both; }
.hy-swap-a { animation: hy-swap-a .6s ease-in-out both; }
.hy-swap-b { animation: hy-swap-b .6s ease-in-out both; }
.hy-spot { animation: hy-spot 1.4s ease-in-out infinite; }
.hy-flap { transform-origin: top; animation: hy-flap .7s ease-in both; }
.hy-slide-out { animation: hy-slide-out .6s .55s cubic-bezier(.2,.7,.3,1) both; }
.hy-breathe { animation: hy-breathe 2.4s ease-in-out infinite; }
.hy-ribbon { animation: hy-ribbon .5s ease-out both; }
.hy-lamp { animation: hy-lamp 1.4s ease-in-out infinite; }
.hy-art { image-rendering: auto; }
.hy-display { font-family: var(--hy-display, inherit); }

@media (prefers-reduced-motion: reduce) {
  .hy-flipper { transition: none; }
  .hy-rise, .hy-pop, .hy-stamp, .hy-drop, .hy-ignite, .hy-ribbon { animation: hy-fade .25s ease-out both; }
  .hy-shake, .hy-glow, .hy-swap-a, .hy-swap-b, .hy-breathe, .hy-lamp, .hy-flap, .hy-slide-out { animation: none; }
  .hy-slide-out { transform: translateY(-58%); }
  .hy-flap { transform: rotateX(178deg); }
  .hy-spot { animation: none; box-shadow: 0 0 0 9999px rgb(0 0 0 / .75); }
}
`;

export function HydraStyles() {
  return <style>{CSS}</style>;
}
