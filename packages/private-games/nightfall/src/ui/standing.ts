import { ARTIFACTS, type ArtifactId, type MarkId, type RoleId, winFor } from '../logic/roles.ts';
import type { Note, NightfallView } from '../logic/types.ts';
import type { Deck } from './assets.ts';

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
        now = n.role;
        break;
      case 'took-center':
        now = null;
        break;
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

  if (becomes && artifact)
    meaning.push(
      `The ${deck.artifactName(artifact)} makes you the ${deck.name(becomes)}, whatever your card. ${win(becomes)}`,
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
  if (!becomes)
    meaning.push('Someone may have moved your card or your Mark since, without you knowing.');
  return { started, now, mark, artifact, meaning };
}
