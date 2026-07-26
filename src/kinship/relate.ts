import type { Graph } from "../model/graph.ts";
import { kinshipBetween, parentageOf, type Kinship, type Parentage } from "./derive.ts";
import { networkOf, shortestPath, type Hop, type Network, type PathOptions } from "./path.ts";
import { TABLES, termFor } from "./term.ts";
import type { Lang } from "./terms.ts";
import { electiveTieBetween, unionIndexOf, type UnionIndex } from "./unions.ts";

/** Indexes built once and reused. Building them per query is the easy way to make this slow. */
export interface KinshipContext {
  graph: Graph;
  parentage: Parentage;
  unions: UnionIndex;
  network: Network;
}

export function kinshipContextOf(graph: Graph): KinshipContext {
  return {
    graph,
    parentage: parentageOf(graph),
    unions: unionIndexOf(graph),
    network: networkOf(graph),
  };
}

export type RelatednessKind =
  | "self"
  | "blood"
  | "partner"
  | "step"
  | "in-law"
  | "path"
  | "none";

export interface Relatedness {
  kind: RelatednessKind;
  /** The one summary word, or null when only a path could be found. */
  term: string | null;
  /** The blood tie behind a `blood` answer, for callers that want the raw pair. */
  kinship: Kinship | null;
  /** Ordered hops from a to b. Empty for the same person, null when nothing connects them. */
  path: Hop[] | null;
  /**
   * Section 8 keeps chosen family off the kin term and on its own line: it is a claim people
   * make about each other, not something derivable from parentage.
   */
  chosenFamily: boolean;
}

export interface RelateOptions extends PathOptions {
  lang?: Lang;
  distinguishNotByBirth?: boolean;
}

function hasChosenFamily(graph: Graph, a: string, b: string): boolean {
  return graph.relations.some(
    (relation) =>
      relation.type === "chosen-family" &&
      relation.status !== "ended" &&
      ((relation.from === a && relation.to === b) || (relation.from === b && relation.to === a)),
  );
}

/**
 * How b is related to a. Blood is tried before anything elective, because two step-siblings
 * who also share an ancestor are half-siblings and section 8 wants the blood reading.
 */
export function relate(
  context: KinshipContext,
  a: string,
  b: string,
  options: RelateOptions = {},
): Relatedness {
  const lang = options.lang ?? "en";
  const table = TABLES[lang];
  const chosenFamily = hasChosenFamily(context.graph, a, b);

  if (a === b) {
    return { kind: "self", term: table.self, kinship: null, path: [], chosenFamily };
  }

  const path = shortestPath(context.network, a, b, options);

  const blood = kinshipBetween(context.parentage, a, b);
  if (blood !== null) {
    const termOptions: { lang: Lang; distinguishNotByBirth?: boolean } = { lang };
    if (options.distinguishNotByBirth !== undefined) {
      termOptions.distinguishNotByBirth = options.distinguishNotByBirth;
    }

    return {
      kind: "blood",
      term: termFor(blood, termOptions),
      kinship: blood,
      path,
      chosenFamily,
    };
  }

  const elective = electiveTieBetween(context.parentage, context.unions, a, b);
  if (elective !== null) {
    const term =
      elective.kind === "partner"
        ? table.partner(elective.state)
        : elective.kind === "step"
          ? table.step(elective.relation, elective.ended)
          : table.inLaw(elective.relation);

    return { kind: elective.kind, term, kinship: null, path, chosenFamily };
  }

  if (path === null) {
    return { kind: "none", term: table.unrelated, kinship: null, path: null, chosenFamily };
  }

  return { kind: "path", term: null, kinship: null, path, chosenFamily };
}
