import type { CompiledGraph } from "../build/compile.ts";
import type { Ego } from "./ego.ts";
import { descendantsOf, personPasses, relationPasses, type Filters } from "./filters.ts";
import { presenceAt, relationActiveAt, unionActiveAt } from "./timeline.ts";

export type Mode = "lineage" | "social";

export interface NodeData {
  id: string;
  label: string;
  distance: number;
  focus: boolean;
  deceased: boolean;
  /**
   * A union scaffolding node exists only so dagre ranks partners together. It is never a
   * person, is not in the data, and nothing may focus or hover it.
   */
  kind: "person" | "union";
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
  kind: "parentage" | "union" | "relation";
  /** Ranks to keep between the ends. Dagre rejects 0, so scaffolding uses 1 and direct 2. */
  span: number;
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
  /**
   * Which of a union's two parallel hairlines this is. Section 11.4 draws a union doubled,
   * and canvas has no double-line style, so it is two edges nudged either side of centre.
   */
  rail?: -1 | 1;
}

export interface Elements {
  nodes: { data: NodeData }[];
  edges: { data: EdgeData }[];
}

export interface ElementOptions {
  mode: Mode;
  filters?: Filters;
  /** The year the scrubber is parked on, or null for the whole record. */
  year?: number | null;
  /** Section 11.3's toggles. Hiding is the caller's choice; the data is unchanged. */
  showUncertain?: boolean;
  showEnded?: boolean;
}

const INACTIVE = new Set(["ended", "estranged"]);

function hasEnded(union: { to?: string | null; endReason?: string | null }): boolean {
  return (
    (union.to !== undefined && union.to !== null) ||
    (union.endReason !== undefined && union.endReason !== null)
  );
}

/**
 * Dagre ranks by edge, and its ranking rejects a length of 0, so partners cannot simply be
 * told to share a rank. Instead a union gets a scaffolding node one rank down that both
 * partners point at, which forces them level, and their children hang off it. Direct
 * parentage then spans two ranks so a generation is the same height either way.
 */
const SCAFFOLD_SPAN = 1;
const DIRECT_SPAN = 2;

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

  const year = options.year ?? null;
  const showUncertain = options.showUncertain ?? true;
  const showEnded = options.showEnded ?? true;

  for (const person of graph.people) {
    if (!ego.ids.has(person.id)) continue;
    if (filters !== undefined && !personPasses(person, filters, branchMembers)) continue;

    // Not yet born is not yet in the picture; dead is greyed, not removed, because a
    // family tree without its dead is not a family tree.
    const presence = year === null ? null : presenceAt(person, year);
    if (presence === "unborn") continue;

    visible.add(person.id);
    nodes.push({
      data: {
        id: person.id,
        label: person.names.display,
        distance: ego.distance.get(person.id) ?? 0,
        focus: ego.distance.get(person.id) === 0,
        deceased: presence === null ? person.status === "deceased" : presence === "dead",
        kind: "person",
      },
    });
  }

  const inside = (id: string): boolean => visible.has(id);
  const edges: { data: EdgeData }[] = [];

  // A union whose partners should carry a scaffolding node: two or more of them in view.
  const scaffolded = new Map<string, string[]>();
  if (options.mode === "lineage") {
    for (const union of graph.unions) {
      if (year !== null && !unionActiveAt(union, year)) continue;
      if (!showEnded && hasEnded(union)) continue;
      const partners = union.partners.filter(inside);
      if (partners.length >= 2) scaffolded.set(union.id, [...partners].sort());
    }
  }

  /** The union a child's parents all belong to, when exactly one covers them. */
  const unionCovering = (parents: string[]): string | null => {
    if (parents.length < 2) return null;
    for (const [id, partners] of scaffolded) {
      if (parents.length === partners.length && parents.every((p) => partners.includes(p))) {
        return id;
      }
    }
    return null;
  };

  for (const [unionId, partners] of scaffolded) {
    const union = graph.unions.find((candidate) => candidate.id === unionId);
    if (union === undefined) continue;

    const ended =
      (union.to !== undefined && union.to !== null) ||
      (union.endReason !== undefined && union.endReason !== null);

    nodes.push({
      data: {
        id: `n:${unionId}`,
        label: "",
        distance: 0,
        focus: false,
        deceased: false,
        kind: "union",
      },
    });

    for (const partner of partners) {
      for (const rail of [-1, 1] as const) {
        edges.push({
          data: {
            id: `u:${unionId}:${partner}:${rail}`,
            source: partner,
            target: `n:${unionId}`,
            kind: "union",
            uncertain: false,
            notByBirth: false,
            ended,
            closeness: null,
            contexts: 0,
            span: SCAFFOLD_SPAN,
            rail,
          },
        });
      }
    }
  }

  for (const person of graph.people) {
    if (!inside(person.id)) continue;

    const parents = (person.parents ?? []).filter((edge) => inside(edge.id));
    const shared = unionCovering(parents.map((edge) => edge.id).sort());

    // Routing through the scaffolding loses the per-parent line work, so it only happens
    // when every parent edge agrees; otherwise dashes and notches would be invented.
    const uniform =
      shared !== null &&
      parents.every(
        (edge) =>
          (edge.confidence ?? "certain") === (parents[0]?.confidence ?? "certain") &&
          edge.kind === parents[0]?.kind,
      );

    if (shared !== null && uniform) {
      const first = parents[0];
      const routedUncertain =
        first !== undefined && (first.confidence ?? "certain") !== "certain";
      if (!showUncertain && routedUncertain) continue;

      edges.push({
        data: {
          id: `p:${shared}->${person.id}`,
          source: `n:${shared}`,
          target: person.id,
          kind: "parentage",
          uncertain: first !== undefined && (first.confidence ?? "certain") !== "certain",
          notByBirth: first !== undefined && first.kind !== "birth" && first.kind !== "unknown",
          ended: false,
          closeness: null,
          contexts: 0,
          span: SCAFFOLD_SPAN,
        },
      });
      continue;
    }

    for (const edge of parents) {
      const uncertain = edge.confidence !== undefined && edge.confidence !== "certain";
      if (!showUncertain && uncertain) continue;

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
          span: DIRECT_SPAN,
        },
      });
    }
  }

  // Social mode has no ranks to protect, so partners join directly.
  if (options.mode === "social") {
    for (const union of graph.unions) {
      if (year !== null && !unionActiveAt(union, year)) continue;
      if (!showEnded && hasEnded(union)) continue;
      const partners = union.partners.filter(inside);
      const ended =
        (union.to !== undefined && union.to !== null) ||
        (union.endReason !== undefined && union.endReason !== null);

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
              span: DIRECT_SPAN,
            },
          });
        }
      }
    }
  }

  if (options.mode === "social") {
    for (const relation of graph.relations) {
      if (!inside(relation.from) || !inside(relation.to)) continue;
      if (filters !== undefined && !relationPasses(relation, filters)) continue;
      if (year !== null && !relationActiveAt(relation, year)) continue;
      if (!showEnded && INACTIVE.has(relation.status)) continue;

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
          span: DIRECT_SPAN,
        },
      });
    }
  }

  return { nodes, edges };
}
