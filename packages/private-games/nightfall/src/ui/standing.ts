import { ARTIFACTS, type ArtifactId, type MarkId, type RoleId, winFor } from '../logic/roles.ts';
import type { Note, NightfallView } from '../logic/types.ts';
import { type Deck, theRole } from './assets.ts';

/**
 * "Where you stand now", for the top of Learned: what you started as, what your card is now as
 * far as your own notes tell, the Mark you last saw, and what that means for your side. Built
 * only from your own notes, so it never knows more than you do.
 */
export interface Standing {
  started: RoleId;
  /** What you are now, as far as you know; null when you can't know (the Drunk, say). */
  now: RoleId | null;
  /** The Mark you last saw, or null in a game without Marks (or before the dusk). */
  mark: { mark: MarkId; doppel: boolean } | null;
  /** The artifact on your card at daybreak. */
  artifact: ArtifactId | null;
  /** What it means for you, one line each. */
  meaning: string[];
}

/** What your card is now, from your notes (null: you can't know). */
function cardNow(started: RoleId, notes: readonly Note[], me: string): RoleId | null {
  let now: RoleId | null = started;
  for (const [i, n] of notes.entries()) {
    switch (n.kind) {
      case 'copied':
        now = n.blind ? null : n.role;
        break;
      case 'copied-centre':
      case 'became':
      case 'robbed':
      case 'saw-own':
      case 'took':
      case 'snatched':
        now = n.role;
        break;
      case 'took-center':
      case 'shuffled':
        now = null;
        break;
      case 'passed-card':
        // The aliens passed their cards round, unseen.
        if (n.to) now = null;
        break;
      case 'gave': {
        // You looked at a card and gave it to yourself, or gave your own card away.
        if (n.to === me) {
          const key = JSON.stringify(n.from);
          const saw = notes
            .slice(0, i)
            .findLast((m) => m.kind === 'saw' && JSON.stringify(m.slot) === key);
          now = saw?.kind === 'saw' ? saw.role : null;
        } else if ('player' in n.from && n.from.player === me) now = null;
        break;
      }
      case 'witched': {
        if (n.target !== me) break;
        // She gave herself the centre card she had just looked at.
        const saw = notes
          .slice(0, i)
          .findLast((m) => m.kind === 'saw' && 'center' in m.slot && m.slot.center === n.center);
        now = saw?.kind === 'saw' ? saw.role : null;
        break;
      }
      case 'swapped':
        if (('player' in n.a && n.a.player === me) || ('player' in n.b && n.b.player === me))
          now = null;
        break;
    }
  }
  return now;
}

/** The Mark you saw last: at the dusk, one you took or gave yourself, or the Pickpocket's. */
function markNow(notes: readonly Note[], me: string): Standing['mark'] {
  let mark: Standing['mark'] = null;
  for (const n of notes) {
    if (n.kind === 'mark') mark = { mark: n.mark, doppel: n.doppel === true };
    else if (n.kind === 'pickpocketed') mark = { mark: n.mark, doppel: false };
    else if (n.kind === 'saw-vampires') mark = { mark: 'bat', doppel: false };
    else if (n.kind === 'marked' && n.targets.includes(me)) mark = { mark: n.mark, doppel: false };
    else if (n.kind === 'feared') mark ??= { mark: 'fear', doppel: false };
  }
  return mark;
}

/** What the night made you, whatever your card says (a tapped fist, the Oracle's answer…). */
function sideNow(notes: readonly Note[]): string | null {
  let side: string | null = null;
  for (const n of notes) {
    if (n.kind === 'fist' && n.tapped)
      side = n.helper
        ? 'The aliens tapped your fist: you play for them, though you aren’t an alien. You win only if they do.'
        : 'The aliens tapped your fist: you are an alien now, whatever your card. You win with the aliens.';
    if (n.kind === 'snatched')
      side = 'The card you took is an Alien card: you are an alien, and win with the aliens.';
    if (n.kind === 'oracle') {
      const joined: Record<string, string> = {
        'werewolf-team:yes': 'Your card is a werewolf card: you win with the werewolves.',
        'vampire-team:yes': 'Your card is a vampire card: you win with the vampires.',
        'alien-team:yes': 'Your card is an alien card: you win with the aliens.',
        'alien-team:yes-helper': 'You win only if the aliens win, though you aren’t one.',
        'number:wrong':
          'You failed the number: you win only if you survive, and everyone else wins if you die.',
      };
      if (joined[n.outcome]) side = joined[n.outcome]!;
    }
  }
  return side;
}

export function standingOf(view: NightfallView, deck: Deck): Standing | null {
  const me = view.me?.id;
  const started = view.myRole;
  if (!me || !started) return null;
  const notes = view.notes;
  const art = notes.findLast((n) => n.kind === 'artifact');
  const artifact = art?.kind === 'artifact' ? art.artifact : null;
  const becomes = artifact ? ARTIFACTS[artifact].becomes : undefined;
  const now = becomes ?? cardNow(started, notes, me);
  const mark = markNow(notes, me);
  const roles = view.settings.roles;
  const win = (role: RoleId) => winFor(role, roles, view.settings.artifacts);
  const meaning: string[] = [];

  const side = becomes ? null : sideNow(notes);
  const foretold = notes.findLast((n) => n.kind === 'foretold');
  if (side) meaning.push(side);
  if (foretold?.kind === 'foretold' && !becomes)
    meaning.push(
      `${deck.name('nostradamus')}: you win only if you live and the side you were announced on wins.`,
    );
  if (becomes && artifact)
    meaning.push(
      `The ${deck.artifactName(artifact)} makes you ${theRole(deck, becomes)}, whatever your card. ${win(becomes)}`,
    );
  else if (mark?.mark === 'vampire')
    meaning.push(
      `With the ${deck.markName('vampire')} you are a Vampire, whatever your card. ${win('vampire')}`,
    );
  else if (now) meaning.push(`As the ${deck.name(now)}: ${win(now)}`);
  else
    meaning.push(
      'You can’t be sure what your card is now: you play for whichever card ends up in front of you.',
    );

  const traitor = mark?.mark === 'traitor' || (artifact && ARTIFACTS[artifact].traitor);
  if (traitor) meaning.push('You are a traitor: you win only if someone else on your side dies.');
  if (mark?.mark === 'love') meaning.push('You are in love: if another lover dies, you die too.');
  if (mark?.mark === 'disease') meaning.push('Anyone who votes for you can’t win.');
  if (mark?.mark === 'assassin') meaning.push(`If you die, the ${deck.name('assassin')} wins.`);
  if (notes.some((n) => n.kind === 'marked' && n.targets.some((t) => t !== me)))
    meaning.push('A Mark you gave may have been replaced since, by another Mark given later.');
  // Rules that came with what the narrator said out loud for everyone.
  if (
    view.announcements.some((a) => a.kind === 'oracle-number' && !a.right) &&
    !notes.some((n) => n.kind === 'oracle')
  )
    meaning.push(
      `The ${deck.name('oracle')} failed the number: you win only if the ${deck.name('oracle')} dies.`,
    );
  for (const r of view.day?.rules?.restrictions ?? []) {
    if (!r.players.includes(me)) continue;
    meaning.push(
      r.kind === 'i-am-alien'
        ? 'Until the vote you may only say “I am an alien.”'
        : r.kind === 'face-away'
          ? 'Face away from the table until after the vote.'
          : 'You may not speak until after the vote.',
    );
  }
  if (view.day?.rules?.twoVotes?.includes(me)) meaning.push('You vote with both hands: two votes.');
  if (!becomes)
    meaning.push('Someone may have moved your card or your Mark since, without you knowing.');
  return { started, now, mark, artifact, meaning };
}
