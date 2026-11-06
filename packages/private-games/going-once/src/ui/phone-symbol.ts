import { type LoadedRig, symbolSource } from '@vt/ui/show';
import DOMPurify from 'dompurify';

/** Private rig art is still markup: remove active content before inserting it into the phone. */
export function phoneSymbol(rig: LoadedRig, symbol: string): string {
  return DOMPurify.sanitize(symbolSource(rig, symbol), {
    NAMESPACE: 'http://www.w3.org/2000/svg',
    USE_PROFILES: { svg: true, svgFilters: true },
    // Loaded textures use blob URLs; keep those, local paths and HTTP(S), but no script schemes.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|blob):|[^a-z]|[a-z+.\-]+(?:[^-a-z+.:]|$))/i,
  });
}
