import { tryParseDate, type ParsedDate } from "../model/date.ts";
import { parentageOf } from "../kinship/derive.ts";
import type { Graph } from "../model/graph.ts";
import type { Person, Relation, Union, Vocab } from "../model/types.ts";

/**
 * What the viewer receives. Plain JSON: no Maps, no functions, no dates as objects, because
 * it crosses into the page as a `<script type="application/json">` block and has to survive
 * JSON.stringify unchanged.
 */
export interface CompiledGraph {
  version: 1;
  /** Present so a stale bundle against a new shape fails loudly rather than half-rendering. */
  builtFrom: { people: number; unions: number; relations: number };
  people: CompiledPerson[];
  unions: Union[];
  relations: Relation[];
  vocab: Vocab;
  /** child id -> parent ids, already resolved through merges. */
  parentsOf: Record<string, string[]>;
  /** parent id -> child ids. The reverse index the layout needs and cannot cheaply derive. */
  childrenOf: Record<string, string[]>;
  /** Tombstone id -> the surviving person, so an old link still resolves in the viewer. */
  redirects: Record<string, string>;
}

export interface CompiledPerson extends Person {
  /** Parsed once here so the viewer never re-parses a date string. */
  birthInterval: ParsedDate | null;
  deathInterval: ParsedDate | null;
}

function interval(raw: string | null | undefined): ParsedDate | null {
  const parsed = tryParseDate(raw);
  return parsed?.precision === "unknown" ? null : parsed;
}

/**
 * Turns a loaded graph into the single object the viewer reads. Everything expensive or
 * order-dependent happens here, at build time, because section 2 forbids the page doing any
 * work it could have been handed.
 */
export function compile(graph: Graph): CompiledGraph {
  const parentage = parentageOf(graph);

  // Sorted throughout so two builds of the same data are byte-identical, which is what
  // section 12.3's staleness check depends on.
  const people = [...graph.people.values()].sort((a, b) => a.id.localeCompare(b.id));

  const parentsOf: Record<string, string[]> = {};
  const childrenOf: Record<string, string[]> = {};

  for (const person of people) {
    const parents = parentage.parentsOf(person.id).map((edge) => edge.id);
    if (parents.length > 0) parentsOf[person.id] = [...parents].sort();

    const children = [...parentage.childrenOf(person.id)].sort();
    if (children.length > 0) childrenOf[person.id] = children;
  }

  const redirects: Record<string, string> = {};
  for (const id of [...graph.tombstones.keys()].sort()) {
    redirects[id] = graph.resolve(id);
  }

  return {
    version: 1,
    builtFrom: {
      people: people.length,
      unions: graph.unions.length,
      relations: graph.relations.length,
    },
    people: people.map((person) => ({
      ...person,
      birthInterval: interval(person.birth?.date),
      deathInterval: interval(person.death?.date),
    })),
    unions: [...graph.unions].sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...graph.relations].sort((a, b) => a.id.localeCompare(b.id)),
    vocab: graph.vocab,
    parentsOf,
    childrenOf,
    redirects,
  };
}
