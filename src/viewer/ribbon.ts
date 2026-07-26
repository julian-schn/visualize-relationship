import type { CompiledGraph } from "../build/compile.ts";
import type { Hop } from "../kinship/path.ts";
import { kinshipContextOf, type KinshipContext } from "../kinship/relate.ts";
import type { Graph } from "../model/graph.ts";

/**
 * The kinship engine takes a loaded graph; the page has the compiled one. Adapting is a
 * handful of lines and means derivation, terms and path finding are the same code in the
 * viewer as in the tests, which is what section 2 requires: the page does the work itself,
 * with no agent and no network.
 */
export function graphFor(compiled: CompiledGraph): Graph {
  const people = new Map(compiled.people.map((person) => [person.id, person]));

  return {
    people,
    // Tombstones are dropped at compile time; redirects are all the viewer needs.
    tombstones: new Map(),
    unions: compiled.unions,
    relations: compiled.relations,
    vocab: compiled.vocab,
    resolve: (id) => compiled.redirects[id] ?? id,
  };
}

export function contextFor(compiled: CompiledGraph): KinshipContext {
  return kinshipContextOf(graphFor(compiled));
}

/** Every person the ribbon touches, in order, starting at `from`. */
export function ribbonNodes(from: string, path: readonly Hop[]): string[] {
  return [from, ...path.map((hop) => hop.to)];
}

/**
 * Where the kinship term is set. Section 11.4 puts it at the midpoint of the ribbon, which
 * for an even number of people is the later of the two middle ones.
 */
export function ribbonMidpoint(ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  return ids[Math.floor(ids.length / 2)] ?? null;
}
