import type { CompiledGraph } from "../build/compile.ts";

export type EdgeKind = "parentage" | "union" | "relation";

export interface EgoOptions {
  depth: number;
  kinds?: EdgeKind[];
}

export interface Ego {
  /** Everyone inside the shell, including the focus person. */
  ids: Set<string>;
  /** Hops from the focus person. 0 is the focus, and fading is driven off this. */
  distance: Map<string, number>;
}

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 3;
export const DEFAULT_DEPTH = 2;

function neighboursOf(graph: CompiledGraph, kinds: EdgeKind[]): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>();

  const link = (a: string, b: string): void => {
    if (a === b) return;
    const existing = links.get(a);
    if (existing) existing.add(b);
    else links.set(a, new Set([b]));
  };

  const join = (a: string, b: string): void => {
    link(a, b);
    link(b, a);
  };

  if (kinds.includes("parentage")) {
    for (const [child, parents] of Object.entries(graph.parentsOf)) {
      for (const parent of parents) join(child, parent);
    }
  }

  if (kinds.includes("union")) {
    for (const union of graph.unions) {
      for (const a of union.partners) {
        for (const b of union.partners) join(a, b);
      }
    }
  }

  if (kinds.includes("relation")) {
    for (const relation of graph.relations) join(relation.from, relation.to);
  }

  return links;
}

/**
 * The shell around one person. Section 11.1 is the rule that makes the viewer usable: a
 * force-directed picture of four hundred people is a screenshot, not a tool, so nothing
 * renders until a focus and a depth have narrowed it.
 */
export function egoGraph(
  graph: CompiledGraph,
  focus: string,
  options: EgoOptions,
): Ego {
  const depth = Math.min(Math.max(Math.trunc(options.depth), MIN_DEPTH), MAX_DEPTH);
  const kinds = options.kinds ?? ["parentage", "union"];
  const links = neighboursOf(graph, kinds);

  const distance = new Map<string, number>([[focus, 0]]);
  let frontier = [focus];

  for (let step = 1; step <= depth && frontier.length > 0; step += 1) {
    const next: string[] = [];

    for (const current of frontier) {
      for (const neighbour of links.get(current) ?? []) {
        if (distance.has(neighbour)) continue;
        distance.set(neighbour, step);
        next.push(neighbour);
      }
    }

    frontier = next;
  }

  return { ids: new Set(distance.keys()), distance };
}
