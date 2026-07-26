import type { Graph } from "../model/graph.ts";
import type { Union } from "../model/types.ts";
import type { Parentage } from "./derive.ts";
import type { InLawRelation, PartnerState, StepRelation } from "./terms.ts";

export interface PartnerLink {
  id: string;
  union: Union;
}

export interface UnionIndex {
  /** Everyone sharing a union with this person, with the union that links them. */
  partnersOf(id: string): PartnerLink[];
}

export function unionIndexOf(graph: Graph): UnionIndex {
  const links = new Map<string, PartnerLink[]>();

  for (const union of graph.unions) {
    for (const partner of union.partners) {
      for (const other of union.partners) {
        if (other === partner) continue;
        const existing = links.get(partner);
        if (existing) existing.push({ id: other, union });
        else links.set(partner, [{ id: other, union }]);
      }
    }
  }

  return { partnersOf: (id) => links.get(id) ?? [] };
}

function hasEnded(union: Union): boolean {
  return (
    (union.to !== undefined && union.to !== null) ||
    (union.endReason !== undefined && union.endReason !== null)
  );
}

function endedByDeath(union: Union): boolean {
  return union.endReason === "death";
}

export function partnerState(union: Union): PartnerState {
  if (!hasEnded(union)) return "current";
  return endedByDeath(union) ? "late" : "former";
}

/** A step tie survives bereavement; only a union someone left makes it former. */
function stepEnded(union: Union): boolean {
  return hasEnded(union) && !endedByDeath(union);
}

export type ElectiveTie =
  | { kind: "partner"; state: PartnerState }
  | { kind: "step"; relation: StepRelation; ended: boolean }
  | { kind: "in-law"; relation: InLawRelation };

function parentIdsOf(parentage: Parentage, id: string): string[] {
  return parentage.parentsOf(id).map((edge) => edge.id);
}

function siblingsOf(parentage: Parentage, id: string): Set<string> {
  const siblings = new Set<string>();

  for (const parent of parentIdsOf(parentage, id)) {
    for (const child of parentage.childrenOf(parent)) {
      if (child !== id) siblings.add(child);
    }
  }

  return siblings;
}

/**
 * What b is to a through a union rather than shared ancestry, or null. Checked in order of
 * closeness: a partner tie beats a step one, and a step one beats an in-law one, so a person
 * who is both gets the nearer word.
 *
 * Callers must rule out a blood tie first. Step and in-law only mean anything when there is
 * no shared ancestor, and section 8 prefers the blood reading when both exist.
 */
export function electiveTieBetween(
  parentage: Parentage,
  unions: UnionIndex,
  a: string,
  b: string,
): ElectiveTie | null {
  if (a === b) return null;

  for (const link of unions.partnersOf(a)) {
    if (link.id === b) return { kind: "partner", state: partnerState(link.union) };
  }

  const parentsOfA = parentIdsOf(parentage, a);
  const parentsOfB = parentIdsOf(parentage, b);

  // b is partnered to a's parent without being a's parent.
  if (!parentsOfA.includes(b)) {
    for (const parent of parentsOfA) {
      for (const link of unions.partnersOf(parent)) {
        if (link.id !== b) continue;
        return { kind: "step", relation: "parent", ended: stepEnded(link.union) };
      }
    }
  }

  // The mirror: a is partnered to b's parent.
  if (!parentsOfB.includes(a)) {
    for (const parent of parentsOfB) {
      for (const link of unions.partnersOf(parent)) {
        if (link.id !== a) continue;
        return { kind: "step", relation: "child", ended: stepEnded(link.union) };
      }
    }
  }

  // Children of two people who are partners, sharing no parent of their own.
  if (!parentsOfA.some((parent) => parentsOfB.includes(parent))) {
    for (const parent of parentsOfA) {
      for (const link of unions.partnersOf(parent)) {
        if (!parentsOfB.includes(link.id)) continue;
        return { kind: "step", relation: "sibling", ended: stepEnded(link.union) };
      }
    }
  }

  const siblingsOfA = siblingsOf(parentage, a);

  for (const link of unions.partnersOf(a)) {
    // b is a parent of a's partner.
    if (parentIdsOf(parentage, link.id).includes(b)) {
      return { kind: "in-law", relation: "parent" };
    }
    // b is a sibling of a's partner.
    if (siblingsOf(parentage, link.id).has(b)) {
      return { kind: "in-law", relation: "sibling" };
    }
  }

  for (const child of parentage.childrenOf(a)) {
    for (const link of unions.partnersOf(child)) {
      if (link.id === b) return { kind: "in-law", relation: "child" };
    }
  }

  for (const sibling of siblingsOfA) {
    for (const link of unions.partnersOf(sibling)) {
      if (link.id === b) return { kind: "in-law", relation: "sibling" };
    }
  }

  return null;
}
