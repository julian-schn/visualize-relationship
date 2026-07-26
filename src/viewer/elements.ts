import type { CompiledGraph } from "../build/compile.ts";
import type { Ego } from "./ego.ts";
import { descendantsOf, personPasses, relationPasses, type Filters } from "./filters.ts";

export type Mode = "lineage" | "social";

export interface NodeData {
  id: string;
  label: string;
  distance: number;
  focus: boolean;
  deceased: boolean;
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
  kind: "parentage" | "union" | "relation";
  /** Parentage below `certain`, which section 11.4 renders dashed. */
  uncertain: boolean;
  /** Parentage that is not a birth edge, which gets the notch glyph. */
  notByBirth: boolean;
  /** A union or relation that has ended, drawn broken. */
  ended: boolean;
  /** 0..5 where known. Drives line thickness and how hard fcose pulls. */
  closeness: number | null;
  /** Shared context count, so a force layout can cluster on it. */
  contexts: number;
}

export interface Elements {
  nodes: { data: NodeData }[];
  edges: { data: EdgeData }[];
}

export interface ElementOptions {
  mode: Mode;
  filters?: Filters;
}

const INACTIVE = new Set(["ended", "estranged"]);

/**
 * The shell as cytoscape elements. Only what is inside the ego shell and past the filters is
 * emitted: section 11.1 means the layout engine should never be handed the whole graph.
 *
 * Lineage mode draws kinship only. Social mode adds elective ties, because "how do we know
 * each other" and "how are we related" are different questions over the same records.
 */
export function elementsFor(
  graph: CompiledGraph,
  ego: Ego,
  options: ElementOptions = { mode: "lineage" },
): Elements {
  const filters = options.filters;
  const branchMembers =
    filters?.branch != null ? descendantsOf(graph, filters.branch) : null;

  const visible = new Set<string>();
  const nodes: { data: NodeData }[] = [];

  for (const person of graph.people) {
    if (!ego.ids.has(person.id)) continue;
    if (filters !== undefined && !personPasses(person, filters, branchMembers)) continue;

    visible.add(person.id);
    nodes.push({
      data: {
        id: person.id,
        label: person.names.display,
        distance: ego.distance.get(person.id) ?? 0,
        focus: ego.distance.get(person.id) === 0,
        deceased: person.status === "deceased",
      },
    });
  }

  const inside = (id: string): boolean => visible.has(id);
  const edges: { data: EdgeData }[] = [];

  for (const person of graph.people) {
    if (!inside(person.id)) continue;

    for (const edge of person.parents ?? []) {
      if (!inside(edge.id)) continue;
      edges.push({
        data: {
          id: `p:${edge.id}->${person.id}`,
          source: edge.id,
          target: person.id,
          kind: "parentage",
          uncertain: edge.confidence !== undefined && edge.confidence !== "certain",
          notByBirth: edge.kind !== "birth" && edge.kind !== "unknown",
          ended: false,
          closeness: null,
          contexts: 0,
        },
      });
    }
  }

  for (const union of graph.unions) {
    const partners = union.partners.filter(inside);
    const ended =
      (union.to !== undefined && union.to !== null) ||
      (union.endReason !== undefined && union.endReason !== null);

    // One edge per pair, so a three-person union draws as a triangle rather than a hub.
    for (let i = 0; i < partners.length; i += 1) {
      for (let j = i + 1; j < partners.length; j += 1) {
        const a = partners[i];
        const b = partners[j];
        if (a === undefined || b === undefined) continue;

        edges.push({
          data: {
            id: `u:${union.id}:${a}-${b}`,
            source: a,
            target: b,
            kind: "union",
            uncertain: false,
            notByBirth: false,
            ended,
            closeness: null,
            contexts: 0,
          },
        });
      }
    }
  }

  if (options.mode === "social") {
    for (const relation of graph.relations) {
      if (!inside(relation.from) || !inside(relation.to)) continue;
      if (filters !== undefined && !relationPasses(relation, filters)) continue;

      edges.push({
        data: {
          id: `r:${relation.id}`,
          source: relation.from,
          target: relation.to,
          kind: "relation",
          uncertain: false,
          notByBirth: false,
          ended: INACTIVE.has(relation.status),
          closeness: relation.closeness ?? null,
          contexts: relation.context?.length ?? 0,
        },
      });
    }
  }

  return { nodes, edges };
}
