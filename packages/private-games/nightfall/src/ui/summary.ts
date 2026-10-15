import type { RoleId } from '../logic/roles.ts';

/**
 * The guests' summary of the cards: how many, then each role with its count in the host's order,
 * plain Villagers last (the least to say), so the parts cut on a phone are the least telling.
 */
export function cardsSummary(roles: readonly RoleId[], name: (role: RoleId) => string): string[] {
  const counts = new Map<RoleId, number>();
  for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  const order = [...counts].sort(([a], [b]) => +(a === 'villager') - +(b === 'villager'));
  return [
    `${roles.length} cards`,
    ...order.map(([r, n]) => (n > 1 ? `${name(r)} ×${n}` : name(r))),
  ];
}
