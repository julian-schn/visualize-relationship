import type { CompiledGraph, CompiledPerson } from "../build/compile.ts";
import type { Relation } from "../model/types.ts";

/**
 * A null set means "not filtering on this", which is different from an empty set meaning
 * "nothing passes". The distinction matters: unticking every box should empty the view
 * rather than silently showing everything.
 */
export interface Filters {
  relationTypes: Set<string> | null;
  statuses: Set<string> | null;
  contexts: Set<string> | null;
  tags: Set<string> | null;
  /** An ancestor id. Keeps that person and everyone descended from them. */
  branch: string | null;
}

export function noFilters(): Filters {
  return { relationTypes: null, statuses: null, contexts: null, tags: null, branch: null };
}

export function isFiltering(filters: Filters): boolean {
  return (
    filters.relationTypes !== null ||
    filters.statuses !== null ||
    filters.contexts !== null ||
    filters.tags !== null ||
    filters.branch !== null
  );
}

function passes(chosen: Set<string> | null, values: readonly string[]): boolean {
  if (chosen === null) return true;
  return values.some((value) => chosen.has(value));
}

export function relationPasses(relation: Relation, filters: Filters): boolean {
  return (
    passes(filters.relationTypes, [relation.type]) &&
    passes(filters.statuses, [relation.status]) &&
    passes(filters.contexts, relation.context ?? [])
  );
}

/**
 * Everyone descended from `ancestor`, plus the ancestor. Depth-capped and revisit-guarded
 * like every other traversal, because a parentage cycle must degrade rather than hang.
 */
export function descendantsOf(graph: CompiledGraph, ancestor: string): Set<string> {
  const found = new Set([ancestor]);
  let frontier = [ancestor];

  for (let depth = 0; depth < 32 && frontier.length > 0; depth += 1) {
    const next: string[] = [];

    for (const current of frontier) {
      for (const child of graph.childrenOf[current] ?? []) {
        if (found.has(child)) continue;
        found.add(child);
        next.push(child);
      }
    }

    frontier = next;
  }

  return found;
}

export function personPasses(
  person: CompiledPerson,
  filters: Filters,
  branchMembers: Set<string> | null,
): boolean {
  if (!passes(filters.tags, person.tags ?? [])) return false;
  if (branchMembers !== null && !branchMembers.has(person.id)) return false;
  return true;
}

/** The choices a filter UI can offer, taken from the data rather than hardcoded. */
export interface FilterOptions {
  relationTypes: string[];
  statuses: string[];
  contexts: string[];
  tags: string[];
}

export function filterOptionsFrom(graph: CompiledGraph): FilterOptions {
  const used = <T>(values: Iterable<T>): T[] => [...new Set(values)];

  return {
    relationTypes: used(graph.relations.map((relation) => relation.type)).sort(),
    statuses: used(graph.relations.map((relation) => relation.status)).sort(),
    contexts: used(graph.relations.flatMap((relation) => relation.context ?? [])).sort(),
    tags: used(graph.people.flatMap((person) => person.tags ?? [])).sort(),
  };
}

/** Vocabulary labels are for display; the data stores keys. */
export function labelFor(graph: CompiledGraph, collection: keyof CompiledGraph["vocab"], key: string): string {
  const entries = graph.vocab[collection];
  if (!Array.isArray(entries)) return key;
  return entries.find((entry) => entry.key === key)?.label ?? key;
}
