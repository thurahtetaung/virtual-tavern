/** What a room code looks like, for the "that's not a code" message. */
export const EXAMPLE_ROOM_CODE = 'amber-otter-lantern-7k3q';

/**
 * The room id in whatever a friend pasted or typed: a whole invite link, or the code itself,
 * read out loud and typed with spaces (or a mix of spaces and hyphens) instead of hyphens.
 */
export function parseRoomCode(input: string): string | null {
  const text = input.trim().toLowerCase();
  // A link: the code is the last path segment after /r/.
  const fromLink = text.match(/\/r\/([a-z0-9-]+)\/?(?:[?#].*)?$/);
  const raw = fromLink?.[1] ?? text;
  const words = raw.split(/[\s\-–—_.,]+/).filter(Boolean);
  if (words.length !== 4) return null;
  const code = words.join('-');
  return /^[a-z]+-[a-z]+-[a-z]+-[a-z0-9]{4}$/.test(code) ? code : null;
}
