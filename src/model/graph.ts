import type { Person, Relation, Union, Vocab } from "./types.ts";

export interface GraphInput {
  people: Person[];
  unions: Union[];
  relations: Relation[];
  vocab: Vocab;
  /** Sidecar markdown keyed by person id. Wins over an inline `notes` field. */
  notes?: Map<string, string>;
}

export interface Graph {
  /** Everyone visible, tombstones excluded. References already redirected. */
  people: Map<string, Person>;
  tombstones: Map<string, Person>;
  unions: Union[];
  relations: Relation[];
  vocab: Vocab;
  /** Follows a merge chain to the surviving id. Returns `id` unchanged if nothing merged. */
  resolve(id: string): string;
}

/** Bad data will exist eventually; a traversal must degrade rather than hang. */
const MERGE_DEPTH_CAP = 32;

export function buildGraph(input: GraphInput): Graph {
  const byId = new Map<string, Person>();
  for (const person of input.people) byId.set(person.id, person);

  const resolve = (id: string): string => {
    let current = id;
    const seen = new Set<string>([id]);

    for (let step = 0; step < MERGE_DEPTH_CAP; step += 1) {
      const person = byId.get(current);
      if (!person || person.status !== "merged") return current;

      const next = person.mergedInto;
      // A tombstone without a target, or one pointing back into the chain, is a validation
      // error. Stop on the last good id instead of looping or throwing.
      if (next === undefined || seen.has(next)) return current;

      seen.add(next);
      current = next;
    }

    return current;
  };

  const notes = input.notes ?? new Map<string, string>();

  const people = new Map<string, Person>();
  const tombstones = new Map<string, Person>();

  for (const person of input.people) {
    if (person.status === "merged") {
      tombstones.set(person.id, person);
      continue;
    }

    let resolved: Person = person;

    const sidecar = notes.get(person.id);
    if (sidecar !== undefined) resolved = { ...resolved, notes: sidecar };

    if (resolved.parents !== undefined) {
      resolved = {
        ...resolved,
        parents: resolved.parents.map((edge) => ({ ...edge, id: resolve(edge.id) })),
      };
    }

    people.set(person.id, resolved);
  }

  return {
    people,
    tombstones,
    unions: input.unions.map((union) => ({
      ...union,
      partners: union.partners.map(resolve),
    })),
    relations: input.relations.map((relation) => ({
      ...relation,
      from: resolve(relation.from),
      to: resolve(relation.to),
    })),
    vocab: input.vocab,
    resolve,
  };
}
