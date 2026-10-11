import {
  tally,
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  bool,
  count,
  type GameEvents,
  ph,
  leaders,
  mostBy,
  type NuggetRule,
  num,
  type RecapEvent,
  seconds,
  str,
  strs,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Nightfall, read from its `insights` events (`player`, `look`,
 * `outcome`, all reported at the reveal). Roles are only ever ids here: copy uses `{role}`, which
 * the browser names from the private manifest. Nightfall games are short and many a night, so
 * most tallies are night-level (`computeNight`) and each game's strip is two lines.
 */

const players = (g: GameEvents) => g.of('player');
const flag = (key: string) => (e: RecapEvent) => bool(e, key) === true;

/** Every flagged player shares the award, up to three (more single nobody out). */
const flagged = (events: RecapEvent[], value = 1): AwardCandidate[] => {
  const ids = [...new Set(events.flatMap((e) => (e.playerId ? [e.playerId] : [])))].sort();
  return ids.length && ids.length <= 3 ? [{ players: ids, value }] : [];
};

/** The player events of every game in the night. */
const nightPlayers = (games: readonly GameEvents[]) => games.flatMap(players);

/** A count prop summed per player: the leader with at least `min`. */
const mostSum = (events: RecapEvent[], key: string, min = 1) =>
  leaders(
    tally(
      events,
      (e) => e.playerId,
      (e) => num(e, key) ?? 0,
    ),
    { min },
  );

const rules: AwardRule[] = [
  {
    id: 'nf.lone-wolf',
    emoji: '🐺',
    title: 'Lone Wolf',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'wolf',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} survived as the only {role}', '{who} ran the whole pack alone, and lived'],
      wholesome: ['{who} held their nerve alone', '{who} was a brave solo {role} and made it'],
    },
    compute: (g) =>
      flagged(players(g).filter(flag('loneWolf'))).map((c) => ({
        ...c,
        params: { role: 'werewolf' },
      })),
  },
  {
    id: 'nf.living-the-dream',
    emoji: '🪦',
    title: 'Living the Dream',
    valence: 'glory',
    weight: 5,
    kind: 'award',
    family: 'tanner',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} got voted out and loved it', '{who} begged for the vote and got it'],
      wholesome: [
        '{who} achieved their life’s goal as {role}',
        '{who} won exactly the way they wanted',
      ],
    },
    compute: (g) =>
      flagged(players(g).filter(flag('tannerDream'))).map((c) => ({
        ...c,
        params: { role: 'tanner' },
      })),
  },
  {
    id: 'nf.identity-crisis',
    emoji: '🌀',
    title: 'Identity Crisis',
    valence: 'gentle',
    weight: 3,
    kind: 'award',
    family: 'swap',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} woke up on a different team', '{who} went to bed one thing, woke up another'],
      wholesome: ['{who} adapted to a whole new life', '{who} took a new side in their stride'],
    },
    compute: (g) => flagged(players(g).filter(flag('identityCrisis'))),
  },
  {
    id: 'nf.didnt-see-that-coming',
    emoji: '😵',
    title: 'Didn’t See That Coming',
    wholesomeTitle: 'In the Dark',
    valence: 'chaos',
    weight: 4,
    kind: 'award',
    family: 'swap',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} voted against their own new teammate',
        '{who} switched sides, then voted out a new friend',
      ],
      wholesome: [
        '{who} was in the dark, through no fault of their own',
        '{who} played honestly for a side they had left',
      ],
    },
    compute: (g) => flagged(players(g).filter(flag('blindsided'))),
  },
  {
    id: 'nf.parting-shot',
    emoji: '🏹',
    title: 'Parting Shot',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'death',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} took {n} down with them', '{who} went out with a bang: {n} more fell'],
      wholesome: ['{who} made sure justice was done', '{who} had the last word, taking {n} along'],
    },
    compute: (g) => mostSum(players(g), 'hunterShots'),
  },
  {
    id: 'nf.bodyguard-hero',
    emoji: '🛡️',
    title: 'Bodyguard Hero',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'save',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} blocked the vote that would have killed someone',
        '{who} stood in front of the mob',
      ],
      wholesome: ['{who} saved a life', '{who} kept a friend alive with one vote'],
    },
    compute: (g) => flagged(players(g).filter(flag('bodyguardSave'))),
  },
  {
    id: 'nf.wolf-whisperer',
    emoji: '🔍',
    title: 'Wolf Whisperer',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'vote',
    minPlayers: 3,
    nightOnly: true,
    copy: {
      cheeky: [
        '{who} voted for a real wolf {n} times',
        '{who} sniffed out a wolf {n} times tonight',
      ],
      wholesome: ['{who} trusted their instincts, {n|time}', '{who} found the wolves {n|time}'],
    },
    computeNight: (games) =>
      mostBy(nightPlayers(games).filter(flag('votedWolf')), undefined, { min: 2 }),
  },
  {
    id: 'nf.most-paranoid',
    emoji: '😬',
    title: 'Most Paranoid',
    wholesomeTitle: 'Extra Careful',
    valence: 'chaos',
    weight: 1,
    kind: 'award',
    family: 'vote',
    minPlayers: 3,
    nightOnly: true,
    copy: {
      cheeky: ['{who} voted villagers out {n} times', '{who} suspected {n} innocent villagers'],
      wholesome: [
        '{who} was very, very careful, {n} times',
        '{who} kept the village on its toes, {n|time}',
      ],
    },
    computeNight: (games) =>
      mostBy(nightPlayers(games).filter(flag('votedVillager')), undefined, { min: 2 }),
  },
  {
    id: 'nf.wrong-place-wrong-time',
    emoji: '🪤',
    title: 'Wrong Place, Wrong Time',
    wholesomeTitle: 'Village Martyr',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'death',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} was voted out as a villager', '{who} was innocent, and voted out anyway'],
      wholesome: ['{who} was a martyr for the village', '{who} gave their all for the village'],
    },
    compute: (g) => flagged(players(g).filter(flag('villageDeath'))),
  },
  {
    id: 'nf.light-fingers',
    emoji: '🧤',
    title: 'Light Fingers',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'swap',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} moved {n} cards in the dark', '{who} shuffled {n} cards while we slept'],
      wholesome: ['{who} rearranged the night: {n} cards', '{who} quietly moved {n} cards'],
    },
    compute: (g) => mostSum(players(g), 'cardsMoved', 2),
  },
  {
    id: 'nf.fang-fan',
    emoji: '🧛',
    title: 'Fang Fan',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'vampire',
    minPlayers: 3,
    nightOnly: true,
    copy: {
      cheeky: ['{who} ended {n} games as a vampire', '{who} was a vampire {n} times. Suspicious'],
      wholesome: ['{who} embraced the night, {n} games', '{who} joined the vampires {n} times'],
    },
    computeNight: (games) =>
      mostBy(nightPlayers(games).filter(flag('vampire')), undefined, { min: 2 }),
  },
  {
    id: 'nf.heartbreaker',
    emoji: '💔',
    title: 'Heartbreaker',
    valence: 'gentle',
    weight: 4,
    kind: 'award',
    family: 'death',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} dragged their lover down too', '{who} fell, and their sweetheart followed'],
      wholesome: ['{who}’s love was eternal', '{who} and their love left together'],
    },
    compute: (g) => mostSum(players(g), 'heartbreaks'),
  },
  {
    id: 'nf.plague-bearer',
    emoji: '🦠',
    title: 'Plague Bearer',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'disease',
    minPlayers: 3,
    copy: {
      cheeky: ['{n} voters caught {who}’s disease', '{who} infected {n} voters. Wash hands'],
      wholesome: [
        '{who} was surprisingly contagious: {n}',
        '{who} passed the disease to {n} voters',
      ],
    },
    compute: (g) => mostSum(players(g), 'plague'),
  },
  {
    id: 'nf.hitman',
    emoji: '🗡️',
    title: 'Hitman',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'assassin',
    minPlayers: 3,
    copy: {
      cheeky: ['{who}’s target fell. Clean work', '{who} picked a mark and the village obliged'],
      wholesome: ['{who} completed the mission', '{who} saw their mark fall, as planned'],
    },
    compute: (g) => flagged(players(g).filter(flag('hitman'))),
  },
  {
    id: 'nf.eagle-eye',
    emoji: '👁️',
    title: 'Eagle Eye',
    valence: 'glory',
    weight: 2,
    kind: 'award',
    family: 'look',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} saw it right, and it stayed put', '{who} looked once and knew. Annoying'],
      wholesome: ['{who} saw true', '{who} looked and saw exactly right'],
    },
    compute: (g) => mostBy(g.of('look').filter(flag('right'))),
  },
  {
    id: 'nf.moved-since',
    emoji: '🙈',
    title: 'Moved Since',
    wholesomeTitle: 'Cleverly Misled',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'look',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} saw it, and then it moved', '{who} peeked, then someone swapped it'],
      wholesome: ['{who} was cleverly misled', '{who} saw true, before a sneaky swap'],
    },
    compute: (g) => mostBy(g.of('look').filter((e) => bool(e, 'right') === false)),
  },
  {
    id: 'nf.suspicion-magnet',
    emoji: '🧲',
    title: 'Suspicion Magnet',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'attention',
    minPlayers: 4,
    nightOnly: true,
    copy: {
      cheeky: ['{who} drew {n} votes tonight', '{who} collected {n} votes. Shifty eyes'],
      wholesome: [
        'Everyone had their eye on {who}: {n} votes',
        '{who} was the talk of the village',
      ],
    },
    computeNight: (games) => mostSum(nightPlayers(games), 'votesReceived', 3),
  },
  {
    id: 'nf.team-hopper',
    emoji: '🔄',
    title: 'Team Hopper',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'swap',
    minPlayers: 3,
    nightOnly: true,
    copy: {
      cheeky: [
        '{who} played on {n} different teams tonight',
        '{who} switched sides {n} ways tonight',
      ],
      wholesome: ['{who} saw every side of the story: {n}', '{who} played for {n} different teams'],
    },
    computeNight: (games) => {
      const teams = new Map<string, Set<string>>();
      for (const e of nightPlayers(games)) {
        const team = str(e, 'team');
        if (!e.playerId || !team) continue;
        const set = teams.get(e.playerId) ?? new Set();
        set.add(team);
        teams.set(e.playerId, set);
      }
      return leaders(new Map([...teams].map(([id, s]) => [id, s.size])), { min: 3 });
    },
  },
  {
    id: 'nf.survivor',
    emoji: '🏆',
    title: 'Survivor',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'wins',
    minPlayers: 3,
    nightOnly: true,
    copy: {
      cheeky: [
        '{who} won {n} of {m} games. Smug',
        '{who} was on the winning side {n} of {m} times',
      ],
      wholesome: ['{who} won {n} games tonight', '{who} came out on top {n} of {m} times'],
    },
    computeNight: (games) =>
      mostBy(nightPlayers(games).filter(flag('won')), undefined, { min: 2 }).map((c) => ({
        ...c,
        params: {
          m: games.filter((g) => c.players.every((p) => g.players.includes(p))).length,
        },
      })),
  },
  {
    id: 'nf.sleepwalker',
    emoji: '😴',
    title: 'Sleepwalker',
    wholesomeTitle: 'Deep Sleeper',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'time',
    minPlayers: 3,
    stripOnly: true,
    copy: {
      cheeky: ['{who} took their time: the night acted {n|time}', '{who} took their time at night'],
      wholesome: ['{who} thought deeply, {n|time}', '{who} slept peacefully through {n} actions'],
    },
    compute: (g) => mostSum(players(g), 'autoActions'),
  },
  // ---- The Alien set ----
  {
    id: 'nf.first-contact',
    emoji: '👽',
    title: 'First Contact',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'alien',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} came in peace, and won', '{who} phoned home a winner as {role}'],
      wholesome: ['{who} made first contact and won', '{who} was out of this world tonight'],
    },
    compute: (g) =>
      flagged(players(g).filter((e) => bool(e, 'alien') === true && bool(e, 'won') === true)).map(
        (c) => ({ ...c, params: { role: 'alien' } }),
      ),
  },
  {
    id: 'nf.abducted',
    emoji: '🛸',
    title: 'Abducted',
    wholesomeTitle: 'Welcomed Aboard',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'alien',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} was taken by the aliens', '{who} went to sleep human. Mostly'],
      wholesome: ['{who} was welcomed aboard the ship', '{who} made some new friends from afar'],
    },
    compute: (g) => flagged(players(g).filter(flag('abducted'))),
  },
  {
    id: 'nf.moo-tiny',
    emoji: '🐄',
    title: 'Moo-tiny',
    wholesomeTitle: 'Gentle Giant',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'alien',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} got tipped by an alien', '{who} was the {role}. The aliens noticed'],
      wholesome: ['{who} was a very good {role}', '{who} felt a friendly tap in the dark'],
    },
    compute: (g) =>
      flagged(players(g).filter(flag('cowTipped'))).map((c) => ({ ...c, params: { role: 'cow' } })),
  },
  {
    id: 'nf.blob-squad',
    emoji: '🫧',
    title: 'Blob Squad',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'alien',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} kept the whole Blob alive', '{who} absorbed friends and kept them'],
      wholesome: ['{who} looked after the whole Blob', '{who} kept every Blob member safe'],
    },
    compute: (g) => flagged(players(g).filter(flag('blobSquad'))),
  },
  {
    id: 'nf.undertaker',
    emoji: '⚱️',
    title: 'Undertaker',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'death',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} got a neighbour for business', '{who} measured the neighbours early'],
      wholesome: ['{who} won as the {role}', '{who} saw a neighbour off with care'],
    },
    compute: (g) =>
      flagged(players(g).filter(flag('undertaker'))).map((c) => ({
        ...c,
        params: { role: 'mortician' },
      })),
  },
  {
    id: 'nf.seen-the-future',
    emoji: '🔭',
    title: 'Seen the Future',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'look',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} saw it coming. Of course', '{who} picked the right side in advance'],
      wholesome: ['{who} foresaw the winning side', '{who} read the future right as {role}'],
    },
    compute: (g) =>
      flagged(players(g).filter(flag('foresaw'))).map((c) => ({
        ...c,
        params: { role: 'nostradamus' },
      })),
  },
  // ---- Moments ----
  {
    id: 'nf.epic-battle',
    emoji: '⚔️',
    title: 'Epic Battle',
    valence: 'glory',
    weight: 4,
    kind: 'moment',
    family: 'ending',
    minPlayers: 3,
    copy: {
      cheeky: ['Three sides, one vote, total chaos', 'An epic battle: {n} sides at one table'],
      wholesome: ['An epic battle between {n} sides', 'Three sides or more, and a thrilling vote'],
    },
    compute: (g) => {
      const o = g.of('outcome').at(-1);
      return bool(o, 'epic') ? [{ players: [], value: strs(o, 'teams').length || 3 }] : [];
    },
  },
  {
    id: 'nf.nobody-died',
    emoji: '🕊️',
    title: 'Nobody Died',
    valence: 'gentle',
    weight: 3,
    kind: 'moment',
    family: 'ending',
    minPlayers: 3,
    copy: {
      cheeky: ['Nobody died. Everyone looked very relieved', 'The vote spread so thin nobody died'],
      wholesome: ['A peaceful night: nobody died', 'Everyone made it to morning'],
    },
    compute: (g) =>
      str(g.of('outcome').at(-1), 'ending') === 'nobody-died' ? [{ players: [], value: 1 }] : [],
  },
  {
    id: 'nf.card-chain',
    emoji: '⛓️',
    title: 'Chain Reaction',
    valence: 'gentle',
    weight: 3,
    kind: 'moment',
    family: 'swap',
    minPlayers: 3,
    copy: {
      cheeky: [
        'One card moved {n} times in a single night',
        'A card went on a {n}-stop tour tonight',
      ],
      wholesome: ['One card travelled {n} times in the dark', 'A card changed hands {n} times'],
    },
    compute: (g) => {
      const chain = num(g.of('outcome').at(-1), 'chain') ?? 0;
      return chain >= 3 ? [{ players: [], value: chain }] : [];
    },
  },
  {
    id: 'nf.tanner-win',
    emoji: '🎉',
    title: 'Tanner Wins',
    valence: 'glory',
    weight: 5,
    kind: 'moment',
    family: 'tanner',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} wanted out as {role}, and got their wish', '{who} won by losing. As {role}'],
      wholesome: [
        '{who} won as the {role}, just as planned',
        '{who} got their happy ending as {role}',
      ],
    },
    compute: (g) =>
      str(g.of('outcome').at(-1), 'ending') === 'tanner'
        ? flagged(players(g).filter(flag('tannerDream'))).map((c) => ({
            ...c,
            params: { role: 'tanner' },
          }))
        : [],
  },
  {
    id: 'nf.love-death',
    emoji: '💘',
    title: 'Star-Crossed',
    valence: 'gentle',
    weight: 4,
    kind: 'moment',
    family: 'death',
    minPlayers: 3,
    copy: {
      cheeky: ['Love hurt: {n} died of a broken heart', 'A broken heart took {n} down too'],
      wholesome: ['Love lasted to the end: {n} followed', 'Two hearts left together tonight'],
    },
    compute: (g) => {
      const n = num(g.of('outcome').at(-1), 'loveDeaths') ?? 0;
      return n > 0 ? [{ players: [], value: n }] : [];
    },
  },
  {
    id: 'nf.wolves-untouched',
    emoji: '🌕',
    title: 'Wolves Untouched',
    valence: 'glory',
    weight: 4,
    kind: 'moment',
    family: 'ending',
    minPlayers: 3,
    copy: {
      cheeky: ['The wolves won and nobody even voted for one', 'Not one vote on a wolf. Smooth'],
      wholesome: ['The wolves hid perfectly: not one vote', 'A flawless night for the wolves'],
    },
    compute: (g) =>
      str(g.of('outcome').at(-1), 'ending') === 'wolves-survived' &&
      players(g).length > 0 &&
      !players(g).some(flag('votedWolf'))
        ? [{ players: [], value: 1 }]
        : [],
  },
];

const allPlayers = nightPlayers;
const outcomes = (games: readonly GameEvents[]) => games.flatMap((g) => g.of('outcome'));

const nuggets: NuggetRule[] = [
  {
    id: 'nf.games',
    emoji: '🌙',
    interest: 1,
    compute: (games) => {
      const n = outcomes(games).length;
      return n ? { value: n, text: `${n} ${n === 1 ? 'game' : 'games'} played` } : null;
    },
  },
  {
    id: 'nf.team-wins',
    emoji: '🏳️',
    interest: 2,
    compute: (games) => {
      const top = leaders(tally(outcomes(games), (e) => strs(e, 'teamsWon')))[0];
      if (!top || top.players.length !== 1) return null;
      return { value: top.value, text: `Team ${top.players[0]} won ${count(top.value, 'time')}` };
    },
  },
  {
    id: 'nf.deaths',
    emoji: '⚰️',
    interest: 2,
    compute: (games) => {
      const n = outcomes(games).reduce((s, e) => s + (num(e, 'deaths') ?? 0), 0);
      return n ? { value: n, text: `${count(n, 'player')} met their end` } : null;
    },
  },
  {
    id: 'nf.chain',
    emoji: '⛓️',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const n = Math.max(0, ...outcomes(games).map((e) => num(e, 'chain') ?? 0));
      return n >= 2 ? { value: n, text: `Longest card chain: ${n} moves` } : null;
    },
  },
  {
    id: 'nf.day-length',
    emoji: '☀️',
    interest: 2,
    compute: (games) => {
      const days = outcomes(games).flatMap((e) => (num(e, 'dayMs') ? [num(e, 'dayMs')!] : []));
      if (!days.length) return null;
      const mean = days.reduce((a, b) => a + b, 0) / days.length;
      return { value: mean, text: `Days lasted ${Math.round(seconds(mean))} s on average` };
    },
  },
  {
    id: 'nf.quickest-day',
    emoji: '⏱️',
    interest: 3,
    record: 'min',
    compute: (games) => {
      const days = outcomes(games).flatMap((e) => (num(e, 'dayMs') ? [num(e, 'dayMs')!] : []));
      if (days.length < 2) return null;
      const min = Math.min(...days);
      return { value: min, text: `Quickest day: ${Math.round(seconds(min))} s` };
    },
  },
  {
    id: 'nf.epic',
    emoji: '⚔️',
    interest: 3,
    compute: (games) => {
      const n = outcomes(games).filter((e) => bool(e, 'epic')).length;
      return n ? { value: n, text: `${n} epic ${n === 1 ? 'battle' : 'battles'}` } : null;
    },
  },
  {
    id: 'nf.most-dealt',
    emoji: '🃏',
    interest: 1,
    compute: (games) => {
      const top = leaders(tally(allPlayers(games), (e) => str(e, 'dealt') ?? null))[0];
      if (!top || top.players.length !== 1) return null;
      return { value: top.value, text: `Most dealt: ${ph.role(top.players[0]!)} ×${top.value}` };
    },
  },
];

const ENDINGS: Record<string, string> = {
  hunter: 'a parting shot',
  heartbreak: 'a broken heart',
  tanner: 'a happy tanner',
  'nobody-died': 'nobody died',
  'werewolf-caught': 'a wolf caught',
  'vampire-caught': 'a vampire caught',
  'wolves-survived': 'the wolves got away',
  'vampires-survived': 'the vampires got away',
  'wrong-player': 'the wrong player out',
  'leader-vote': 'the aliens voting for the Leader',
  synthetic: 'a happy synthetic alien',
  'alien-caught': 'an alien caught',
  'aliens-survived': 'the aliens got away',
};

/** The one round of a game: how it ended, who died as what, which team won. */
function history(g: GameEvents): string[] {
  const o = g.of('outcome').at(-1);
  if (!o) return [];
  const lines: string[] = [];
  const ending = str(o, 'ending');
  const won = strs(o, 'teamsWon');
  lines.push(
    `${ending ? `Ended with ${ENDINGS[ending] ?? ending}` : 'The vote is in'}${
      won.length ? `; ${won.join(' & ')} won` : '; nobody won'
    }`,
  );
  const ripple = str(o, 'ripple');
  if (ripple)
    lines.push(
      `A ripple: ${ripple.replace(/-/g, ' ')}${bool(o, 'timeLoop') ? ' (a time loop)' : ''}`,
    );
  const dead = players(g).filter(flag('died'));
  for (const e of dead.slice(0, 6)) {
    const final = str(e, 'final');
    if (e.playerId && final) lines.push(`${ph.p(e.playerId)} died as ${ph.role(final)}`);
  }
  return lines;
}

export const nightfallAwards: AwardModule = { rules, nuggets, stripSize: 2, history };
