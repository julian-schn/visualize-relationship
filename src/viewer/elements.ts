import type { CompiledGraph } from "../build/compile.ts";
import type { Ego } from "./ego.ts";

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
  kind: "parentage" | "union";
  /** Parentage below `certain`, which section 11.4 renders dashed. */
  uncertain: boolean;
  /** Parentage that is not a birth edge, which gets the notch glyph. */
  notByBirth: boolean;
  /** A union that has ended, drawn broken. */
  ended: boolean;
}

export interface Elements {
  nodes: { data: NodeData }[];
  edges: { data: EdgeData }[];
}

/**
 * The shell as cytoscape elements. Only what is inside the ego shell is emitted: section
 * 11.1 means the layout engine should never be handed the whole graph in the first place.
 */
export function elementsFor(graph: CompiledGraph, ego: Ego): Elements {
  const inside = (id: string): boolean => ego.ids.has(id);

  const nodes = graph.people
    .filter((person) => inside(person.id))
    .map((person) => ({
      data: {
        id: person.id,
        label: person.names.display,
        distance: ego.distance.get(person.id) ?? 0,
        focus: ego.distance.get(person.id) === 0,
        deceased: person.status === "deceased",
      },
    }));

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
          },
        });
      }
    }
  }

  return { nodes, edges };
}
