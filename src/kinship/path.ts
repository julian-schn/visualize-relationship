import type { Graph } from "../model/graph.ts";
import type { RelationTypeEntry } from "../model/types.ts";
import { TABLES } from "./term.ts";
import type { Lang } from "./terms.ts";
import { partnerState } from "./unions.ts";

export type HopKind = "parent" | "child" | "partner" | "relation";

export interface Hop {
  from: string;
  to: string;
  kind: HopKind;
  /** What the person at `to` is to the person at `from`, for this hop alone. */
  label: string;
  /** The union or relation id this hop crossed, where there is one. */
  via?: string;
}

/**
 * Blood is cheapest so a shared ancestor always beats a chain of acquaintances, and a tie
 * someone has left costs more than one they have not. Without the spread, "friend of a
 * friend of a cousin" comes back as the shortest answer and reads as nonsense.
 */
export const HOP_COST = {
  parentage: 1,
  partnerCurrent: 2,
  partnerEnded: 3,
  relationActive: 5,
  relationDormant: 7,
  relationEnded: 9,
} as const;

/** Bad or sprawling data must not turn one query into a graph-wide walk. */
export const MAX_HOPS = 8;

interface Edge {
  to: string;
  kind: HopKind;
  cost: number;
  via?: string;
  labelFor(lang: Lang): string;
}

export interface Network {
  edgesFrom(id: string): Edge[];
}

function relationCost(status: string): number {
  if (status === "ended" || status === "estranged") return HOP_COST.relationEnded;
  if (status === "dormant" || status === "unknown") return HOP_COST.relationDormant;
  return HOP_COST.relationActive;
}

export function networkOf(graph: Graph): Network {
  const edges = new Map<string, Edge[]>();
  const relationTypes = new Map<string, RelationTypeEntry>(
    graph.vocab.relationType.map((entry) => [entry.key, entry]),
  );

  const add = (from: string, edge: Edge): void => {
    if (!graph.people.has(from) || !graph.people.has(edge.to)) return;
    const existing = edges.get(from);
    if (existing) existing.push(edge);
    else edges.set(from, [edge]);
  };

  for (const person of graph.people.values()) {
    for (const parent of person.parents ?? []) {
      add(person.id, {
        to: parent.id,
        kind: "parent",
        cost: HOP_COST.parentage,
        labelFor: (lang) => TABLES[lang].ancestor(1),
      });
      add(parent.id, {
        to: person.id,
        kind: "child",
        cost: HOP_COST.parentage,
        labelFor: (lang) => TABLES[lang].descendant(1),
      });
    }
  }

  for (const union of graph.unions) {
    const state = partnerState(union);
    const cost = state === "current" ? HOP_COST.partnerCurrent : HOP_COST.partnerEnded;

    for (const partner of union.partners) {
      for (const other of union.partners) {
        if (other === partner) continue;
        add(partner, {
          to: other,
          kind: "partner",
          cost,
          via: union.id,
          labelFor: (lang) => TABLES[lang].partner(state),
        });
      }
    }
  }

  for (const relation of graph.relations) {
    const entry = relationTypes.get(relation.type);
    const cost = relationCost(relation.status);
    const forward = entry?.label ?? relation.type;
    // Walking an asymmetric tie backwards means the other role, which is what `inverse` is
    // for. A mentor reached from their mentee is still a mentor, not a second mentee.
    const backward =
      entry === undefined || entry.symmetric
        ? forward
        : (relationTypes.get(entry.inverse ?? "")?.label ?? forward);

    add(relation.from, {
      to: relation.to,
      kind: "relation",
      cost,
      via: relation.id,
      labelFor: () => forward,
    });
    add(relation.to, {
      to: relation.from,
      kind: "relation",
      cost,
      via: relation.id,
      labelFor: () => backward,
    });
  }

  return { edgesFrom: (id) => edges.get(id) ?? [] };
}

export interface PathOptions {
  lang?: Lang;
  maxHops?: number;
}

/**
 * Cheapest route from a to b, or null when there is none inside the hop cap. Cost decides
 * the winner, not hop count, so two blood steps beat one hop through a friend.
 */
export function shortestPath(
  network: Network,
  a: string,
  b: string,
  options: PathOptions = {},
): Hop[] | null {
  const lang = options.lang ?? "en";
  const maxHops = options.maxHops ?? MAX_HOPS;

  if (a === b) return [];

  const best = new Map<string, number>([[a, 0]]);
  const depth = new Map<string, number>([[a, 0]]);
  const cameFrom = new Map<string, { from: string; edge: Edge }>();
  const settled = new Set<string>();

  for (;;) {
    let current: string | null = null;
    let currentCost = Infinity;

    for (const [id, cost] of best) {
      if (settled.has(id) || cost >= currentCost) continue;
      current = id;
      currentCost = cost;
    }

    if (current === null) return null;
    if (current === b) break;

    settled.add(current);

    const hops = depth.get(current) ?? 0;
    if (hops >= maxHops) continue;

    for (const edge of network.edgesFrom(current)) {
      if (settled.has(edge.to)) continue;

      const cost = currentCost + edge.cost;
      const known = best.get(edge.to);
      if (known !== undefined && known <= cost) continue;

      best.set(edge.to, cost);
      depth.set(edge.to, hops + 1);
      cameFrom.set(edge.to, { from: current, edge });
    }
  }

  const hops: Hop[] = [];
  let cursor = b;

  while (cursor !== a) {
    const step = cameFrom.get(cursor);
    if (step === undefined) return null;

    const hop: Hop = {
      from: step.from,
      to: cursor,
      kind: step.edge.kind,
      label: step.edge.labelFor(lang),
    };
    if (step.edge.via !== undefined) hop.via = step.edge.via;

    hops.unshift(hop);
    cursor = step.from;
  }

  return hops;
}
