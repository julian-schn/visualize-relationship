import type { Graph } from "../model/graph.ts";
import type { ParentEdge } from "../model/types.ts";

/** Bad data will exist eventually; no traversal may run away. */
export const MAX_GENERATIONS = 24;

export interface Ancestor {
  /** Generations up from the starting person. 0 is the person themselves. */
  distance: number;
  /** True if every edge on the way up was a birth edge. */
  byBirth: boolean;
}

/**
 * A tie read as "what b is to a", matching the pairs in AGENTS.md section 8: (1,0) is b is
 * a's parent, (0,1) is b is a's child, (1,1) siblings, (2,1) b is a's parent's sibling.
 */
export interface Kinship {
  /** Generations from a up to the common ancestor. */
  up: number;
  /** Generations from the common ancestor down to b. */
  down: number;
  /** The lowest common ancestors. More than one for full siblings. */
  through: string[];
  /** Both parents shared for a sibling-shaped tie, rather than one. */
  full: boolean;
  /** Every edge on the path is a birth edge. */
  byBirth: boolean;
}

/** Parentage adjacency, built once and reused across queries. */
export interface Parentage {
  parentsOf(id: string): ParentEdge[];
  childrenOf(id: string): string[];
}

export function parentageOf(graph: Graph): Parentage {
  const children = new Map<string, string[]>();

  for (const person of graph.people.values()) {
    for (const edge of person.parents ?? []) {
      const existing = children.get(edge.id);
      if (existing) existing.push(person.id);
      else children.set(edge.id, [person.id]);
    }
  }

  return {
    parentsOf: (id) => graph.people.get(id)?.parents ?? [],
    childrenOf: (id) => children.get(id) ?? [],
  };
}

/**
 * Every ancestor of `id` with the fewest generations to reach them. Includes `id` at
 * distance 0, so a parent-child tie falls out of the same lookup as a cousin one.
 */
export function ancestorsOf(parentage: Parentage, id: string): Map<string, Ancestor> {
  const found = new Map<string, Ancestor>([[id, { distance: 0, byBirth: true }]]);
  let frontier: { id: string; byBirth: boolean }[] = [{ id, byBirth: true }];

  for (let distance = 1; distance <= MAX_GENERATIONS && frontier.length > 0; distance += 1) {
    const next: { id: string; byBirth: boolean }[] = [];

    for (const current of frontier) {
      for (const edge of parentage.parentsOf(current.id)) {
        const byBirth = current.byBirth && (edge.kind === "birth" || edge.kind === "unknown");
        const seen = found.get(edge.id);

        if (seen === undefined) {
          found.set(edge.id, { distance, byBirth });
          next.push({ id: edge.id, byBirth });
          continue;
        }

        // Same person reachable twice; keep the birth-only reading if either path is one.
        if (seen.distance === distance && byBirth && !seen.byBirth) {
          found.set(edge.id, { distance, byBirth: true });
        }
      }
    }

    frontier = next;
  }

  return found;
}

/**
 * The blood (or adoptive) tie between two people, or null when they share no ancestor.
 * Returns the closest such tie: the pair with the smallest total distance.
 */
export function kinshipBetween(parentage: Parentage, a: string, b: string): Kinship | null {
  if (a === b) return null;

  const fromA = ancestorsOf(parentage, a);
  const fromB = ancestorsOf(parentage, b);

  let best: Kinship | null = null;
  const equals: string[] = [];

  for (const [id, reachedFromA] of fromA) {
    const reachedFromB = fromB.get(id);
    if (reachedFromB === undefined) continue;

    const up = reachedFromA.distance;
    const down = reachedFromB.distance;
    const byBirth = reachedFromA.byBirth && reachedFromB.byBirth;

    if (best === null || up + down < best.up + best.down) {
      best = { up, down, through: [id], full: false, byBirth };
      equals.length = 0;
      equals.push(id);
      continue;
    }

    if (up + down === best.up + best.down && up === best.up) {
      equals.push(id);
      best.through = [...equals];
      best.byBirth = best.byBirth || byBirth;
    }
  }

  if (best === null) return null;

  // Two shared ancestors one generation up means both parents, not one.
  best.full = best.up === 1 && best.down === 1 && best.through.length > 1;
  best.through = [...best.through].sort();

  return best;
}

/** Whether an ancestor path passes only through birth edges. */
export function isBloodRelated(kinship: Kinship | null): boolean {
  return kinship !== null && kinship.byBirth;
}
