import { type RoleId, type Settings, alliesOf, finalOf, presentationsOf } from '../logic/types.ts';

/**
 * The guests' summary of the settings, the most telling first (the phone counts what doesn't fit
 * from the end): the expansion and the hidden roles in play, then the rule options. How the
 * Forensic Scientist is chosen leads when it asks something of the guests (volunteering, the
 * host's pick) and comes last when it is the default random draw.
 */
export function settingsSummary(
  s: Settings,
  fsLabel: string,
  roleName: (role: RoleId) => string,
): string[] {
  const allies = alliesOf(s);
  const fs = `Forensic Scientist: ${fsLabel.toLowerCase()}`;
  const random = s.fsMode === 'random';
  return [
    !random && fs,
    allies.on && 'Allies',
    s.accomplice && roleName('accomplice'),
    s.accomplice && s.witness && roleName('witness'),
    allies.labTech && roleName('lab-technician'),
    allies.insideMan && roleName('inside-man'),
    allies.protective && roleName('protective-detail'),
    s.events && 'events',
    finalOf(s) && 'final accusations',
    presentationsOf(s) && 'presentations',
    allies.unknownLocation && 'Unknown Location',
    random && fs,
  ].filter((p): p is string => !!p);
}
