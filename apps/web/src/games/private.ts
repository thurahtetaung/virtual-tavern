import { guide as hogwartsGuide } from '@vt/private-hogwarts/guide';
import { guide as hoodwinkGuide } from '@vt/private-hoodwink/guide';
import { guide as hydraGuide } from '@vt/private-hydra/guide';
import { guide as inquestGuide, nameGuide as nameInquestGuide } from '@vt/private-inquest/guide';
import {
  guide as masqueradeOriginalsGuide,
  nameGuide as nameOriginalsGuide,
} from '@vt/private-masquerade-originals/guide';
import {
  guide as nightfallGuide,
  nameGuide as nameNightfallGuide,
} from '@vt/private-nightfall/guide';
import { guide as reverieGuide } from '@vt/private-reverie/guide';
import {
  guide as royalPostGuide,
  nameGuide as nameRoyalPostGuide,
} from '@vt/private-royal-post/guide';
import { guide as seanceGuide, nameGuide as nameSeanceGuide } from '@vt/private-seance/guide';
import { guide as tavernBrawlGuide } from '@vt/private-tavern-brawl/guide';
import { guide as shortFuseGuide } from '@vt/private-short-fuse/guide';
import {
  inquestLabels,
  manifestGuide,
  manifestTitle,
  nightfallLabels,
  originalsLabels,
  royalPostLabels,
  hydraGuide as hydraNamedGuide,
  hydraLabels,
  tavernBrawlGuide as tavernBrawlNamedGuide,
  tavernBrawlLabels,
  shortFuseGuide as shortFuseNamedGuide,
  shortFuseLabels,
  taggedGuide,
} from './private-labels.ts';
import { lazyUi } from './lazy-ui.ts';
import type { ClientGame } from './registry.ts';

/**
 * Back-room games. This module and the game UIs it imports are built into /backroom-assets/,
 * which the server only serves to players who have unlocked the back room, so private game
 * names and code never reach anyone else. Add new private games here.
 */
const games: ClientGame[] = [
  {
    // Hard-coded like the public games: importing the engine for its id would bundle it here.
    id: 'reverie',
    name: 'Reverie',
    guide: reverieGuide,
    namedGuide: taggedGuide('reverie', reverieGuide),
    icon: '🐇',
    Component: lazyUi(() =>
      import('@vt/private-reverie/ui').then((m) => ({ default: m.ReverieGame })),
    ),
  },
  {
    id: 'hoodwink',
    name: 'Hoodwink',
    guide: hoodwinkGuide,
    icon: '🤥',
    Component: lazyUi(() =>
      import('@vt/private-hoodwink/ui').then((m) => ({ default: m.HoodwinkGame })),
    ),
  },
  {
    id: 'royal-post',
    name: 'Royal Post',
    guide: royalPostGuide,
    namedGuide: manifestGuide('royal-post', nameRoyalPostGuide),
    icon: '✉️',
    Component: lazyUi(() =>
      import('@vt/private-royal-post/ui').then((m) => ({ default: m.RoyalPostGame })),
    ),
    labels: royalPostLabels,
  },
  {
    id: 'masquerade-originals',
    name: 'Masquerade Originals',
    guide: masqueradeOriginalsGuide,
    namedGuide: manifestGuide('masquerade-originals', nameOriginalsGuide),
    icon: '🗺️',
    Component: lazyUi(() =>
      import('@vt/private-masquerade-originals/ui').then((m) => ({
        default: m.MasqueradeOriginalsGame,
      })),
    ),
    labels: originalsLabels,
  },
  {
    id: 'nightfall',
    name: 'Nightfall',
    guide: nightfallGuide,
    namedGuide: manifestGuide('nightfall', nameNightfallGuide),
    icon: '🐺',
    Component: lazyUi(() =>
      import('@vt/private-nightfall/ui').then((m) => ({ default: m.NightfallGame })),
    ),
    labels: nightfallLabels,
  },
  {
    id: 'inquest',
    name: 'Inquest',
    guide: inquestGuide,
    namedGuide: manifestGuide('inquest', nameInquestGuide),
    icon: '🔎',
    Component: lazyUi(() =>
      import('@vt/private-inquest/ui').then((m) => ({ default: m.InquestGame })),
    ),
    labels: inquestLabels,
  },
  {
    id: 'seance',
    name: 'Séance',
    guide: seanceGuide,
    namedGuide: manifestGuide('seance', nameSeanceGuide),
    icon: '🕯️',
    Component: lazyUi(() =>
      import('@vt/private-seance/ui').then((m) => ({ default: m.SeanceGame })),
    ),
  },
  {
    id: 'hydra',
    name: 'Hydra',
    guide: hydraGuide,
    icon: '🐍',
    Component: lazyUi(() => import('@vt/private-hydra/ui').then((m) => ({ default: m.HydraGame }))),
    labels: hydraLabels('hydra'),
    namedGuide: hydraNamedGuide('hydra'),
  },
  {
    // Hydra's themed edition: every name, line, art and font comes from its private manifest.
    id: 'hogwarts',
    name: 'Hydra: Wands',
    guide: hogwartsGuide,
    icon: '🪄',
    Component: lazyUi(() =>
      import('@vt/private-hogwarts/ui').then((m) => ({ default: m.HogwartsGame })),
    ),
    labels: hydraLabels('hogwarts'),
    namedGuide: hydraNamedGuide('hogwarts'),
  },
  {
    id: 'tavern-brawl',
    name: 'Tavern Brawl',
    guide: tavernBrawlGuide,
    icon: '🥊',
    Component: lazyUi(() =>
      import('@vt/private-tavern-brawl/ui').then((m) => ({ default: m.TavernBrawlGame })),
    ),
    labels: tavernBrawlLabels,
    namedGuide: tavernBrawlNamedGuide,
  },
  {
    id: 'short-fuse',
    name: 'Short Fuse',
    guide: shortFuseGuide,
    icon: '💣',
    Component: lazyUi(() =>
      import('@vt/private-short-fuse/ui').then((m) => ({ default: m.ShortFuseGame })),
    ),
    labels: shortFuseLabels,
    namedGuide: shortFuseNamedGuide,
  },
];

export const privateGames: ClientGame[] = games.map((g) => ({
  ...g,
  manifestTitle: () => manifestTitle(g.id),
}));
