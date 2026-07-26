export interface Placed {
  id: string;
  x: number;
  y: number;
}

/**
 * Dagre orders a rank to minimise edge crossings and knows nothing about couples, so a
 * spouse can land among their partner's siblings with the sibling connector running behind
 * them. This is a second pass over the finished layout: within each rank, partners are
 * gathered next to each other, and everyone keeps one of the slots the rank already had.
 *
 * Only the assignment of people to slots changes. No new x positions are invented, so rank
 * spacing, alignment and the overall shape of the tree survive untouched.
 */
export function seatPartners(
  placed: readonly Placed[],
  partnersOf: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const moved = new Map<string, number>();
  const ranks = new Map<number, Placed[]>();

  for (const node of placed) {
    // Rounded: dagre puts a rank on one y, but floating point can wobble the last digit.
    const rank = Math.round(node.y);
    const existing = ranks.get(rank);
    if (existing) existing.push(node);
    else ranks.set(rank, [node]);
  }

  for (const row of ranks.values()) {
    if (row.length < 3) continue;

    const byX = [...row].sort((a, b) => a.x - b.x);
    const slots = byX.map((node) => node.x);
    const remaining = new Set(byX.map((node) => node.id));
    const seated: string[] = [];

    for (const node of byX) {
      if (!remaining.has(node.id)) continue;

      remaining.delete(node.id);
      seated.push(node.id);

      // Anyone partnered to this person, and still unseated, sits immediately after them.
      for (const partner of partnersOf.get(node.id) ?? []) {
        if (!remaining.has(partner)) continue;
        remaining.delete(partner);
        seated.push(partner);
      }
    }

    seated.forEach((id, index) => {
      const x = slots[index];
      if (x !== undefined) moved.set(id, x);
    });
  }

  return moved;
}
