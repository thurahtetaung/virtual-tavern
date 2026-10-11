import { MAX_NAME_LENGTH } from '@vt/protocol';

/** Names compare without case or surrounding/inner extra spaces: "ana" and " Ana " clash. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

/** Whether `name` is already used by one of `others`. */
export const nameTaken = (name: string, others: readonly string[]) =>
  others.some((o) => nameKey(o) === nameKey(name));

/**
 * Names are unique within a room. Someone joining with a name that's taken gets the first free
 * number after it ("Ana" → "Ana 2"), so an invite never bounces; renames are refused instead
 * (see `RoomManager.rename`). The base is shortened when needed to stay within the length limit.
 */
export function uniqueName(name: string, others: readonly string[]): string {
  if (!nameTaken(name, others)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = name.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd() + suffix;
    if (!nameTaken(candidate, others)) return candidate;
  }
}
