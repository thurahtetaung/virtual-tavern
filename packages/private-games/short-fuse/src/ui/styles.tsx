/**
 * Short Fuse's moments: the shuffle, the Nope stamp, the explosion shake, the Defuse snip and
 * the sheet sliding up. Under `prefers-reduced-motion` they become short fades, or nothing.
 */
const CSS = `
@keyframes sf-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes sf-rise { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: none } }
@keyframes sf-pop { 0% { opacity: 0; transform: scale(.6) } 70% { opacity: 1; transform: scale(1.08) } 100% { transform: scale(1) } }
@keyframes sf-stamp { 0% { opacity: 0; transform: scale(2.4) rotate(-14deg) } 55% { opacity: 1; transform: scale(.92) rotate(-8deg) } 100% { opacity: 1; transform: scale(1) rotate(-8deg) } }
@keyframes sf-shake { 0%,100% { transform: translate(0,0) } 15% { transform: translate(-7px,2px) } 30% { transform: translate(6px,-2px) } 45% { transform: translate(-5px,1px) } 60% { transform: translate(4px,-1px) } 75% { transform: translate(-2px,0) } }
@keyframes sf-shuffle { 0%,100% { transform: none } 20% { transform: translateX(-6px) rotate(-4deg) } 40% { transform: translateX(6px) rotate(4deg) } 60% { transform: translateX(-4px) rotate(-2deg) } 80% { transform: translateX(3px) rotate(1deg) } }
@keyframes sf-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.04) } }
@keyframes sf-owed { 0%,100% { transform: scale(1) } 50% { transform: scale(1.18) } }
@keyframes sf-flash { 0% { opacity: 0 } 15% { opacity: .85 } 100% { opacity: 0 } }
@keyframes sf-flip { from { opacity: 0; transform: rotateY(90deg) } to { opacity: 1; transform: none } }
@keyframes sf-gap { from { height: 0 } to { height: .75rem } }
@keyframes sf-slide { from { transform: translateY(-8px) } to { transform: translateY(0) } }
@keyframes sf-banner { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }

.sf-pop { animation: sf-pop .5s ease-out both }
.sf-stamp { animation: sf-stamp .45s cubic-bezier(.2,.8,.3,1.2) both }
.sf-shake { animation: sf-shake .7s ease-in-out both }
.sf-shuffle { animation: sf-shuffle .9s ease-in-out both }
.sf-breathe { animation: sf-breathe 1.6s ease-in-out infinite }
.sf-owed { animation: sf-owed 1.2s ease-in-out infinite }
.sf-flash { animation: sf-flash 1.1s ease-out both }
.sf-flip { animation: sf-flip .4s ease-out both }
.sf-gap { animation: sf-gap .25s ease-out both }
.sf-slide { animation: sf-slide .6s ease-in-out infinite alternate }
.sf-sheet { animation: sf-rise .25s ease-out both }
.sf-banner { animation: sf-banner .3s ease-out both }

@media (prefers-reduced-motion: reduce) {
  .sf-pop, .sf-stamp, .sf-sheet, .sf-flip, .sf-banner { animation: sf-fade .2s ease-out both }
  .sf-shake, .sf-shuffle, .sf-breathe, .sf-owed, .sf-slide, .sf-gap { animation: none }
  .sf-flash { animation: sf-fade .3s ease-out reverse both }
}
`;

export function ShortFuseStyles() {
  return <style>{CSS}</style>;
}
