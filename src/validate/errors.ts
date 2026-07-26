import { tryParseDate } from "../model/date.ts";
import { buildGraph } from "../model/graph.ts";
import type { SourceFile } from "../model/load.ts";
import type { Person, Relation, Union, Vocab, VocabEntry } from "../model/types.ts";
import { error, type Finding } from "./report.ts";

export interface ValidRecords {
  people: SourceFile<Person>[];
  unions: SourceFile<Union>[];
  relations: SourceFile<Relation>[];
  vocab: Vocab;
}

const MERGE_DEPTH_CAP = 32;

function keysOf(entries: VocabEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.key));
}

/** Rule: filename always equals the id. */
function checkFilenames(records: ValidRecords): Finding[] {
  const files = [...records.people, ...records.unions, ...records.relations];

  return files
    .filter((file) => file.stem !== file.record.id)
    .map((file) =>
      error(
        "filename-id-mismatch",
        file.path,
        `filename says ${file.stem} but the record id is ${file.record.id}`,
      ),
    );
}

/** Rule: no id appears twice, in any directory. */
function checkDuplicateIds(records: ValidRecords): Finding[] {
  const seen = new Map<string, string>();
  const findings: Finding[] = [];

  for (const file of [...records.people, ...records.unions, ...records.relations]) {
    const first = seen.get(file.record.id);
    if (first === undefined) {
      seen.set(file.record.id, file.path);
      continue;
    }
    findings.push(
      error("duplicate-id", file.path, `id ${file.record.id} is already used by ${first}`),
    );
  }

  return findings;
}

/** Rules: dangling references, plus section 6's self-merge, dangling target and merge cycle. */
function checkReferences(records: ValidRecords, resolve: (id: string) => string): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map<string, Person>();
  for (const file of records.people) byId.set(file.record.id, file.record);

  const requirePerson = (id: string, where: string, what: string): void => {
    if (!byId.has(id)) findings.push(error("dangling-reference", where, `${what} ${id} does not exist`));
  };

  for (const file of records.people) {
    const person = file.record;

    for (const parent of person.parents ?? []) {
      requirePerson(parent.id, file.path, "parent");

      if (resolve(parent.id) === resolve(person.id)) {
        findings.push(
          error(
            "self-parent",
            file.path,
            parent.id === person.id
              ? `${person.id} is listed as their own parent`
              : `${parent.id} is ${person.id} after merging, so they are their own parent`,
          ),
        );
      }
    }

    if (person.mergedInto !== undefined) {
      requirePerson(person.mergedInto, file.path, "mergedInto");

      if (person.mergedInto === person.id) {
        findings.push(error("self-merge", file.path, `${person.id} is merged into itself`));
        continue;
      }

      let current = person.mergedInto;
      const seen = new Set([person.id]);
      for (let step = 0; step < MERGE_DEPTH_CAP; step += 1) {
        if (seen.has(current)) {
          findings.push(
            error("merge-cycle", file.path, `the merge chain from ${person.id} loops back on itself`),
          );
          break;
        }
        seen.add(current);
        const next = byId.get(current);
        if (!next || next.status !== "merged" || next.mergedInto === undefined) break;
        current = next.mergedInto;
      }
    }
  }

  for (const file of records.unions) {
    for (const partner of file.record.partners) requirePerson(partner, file.path, "partner");
  }

  for (const file of records.relations) {
    requirePerson(file.record.from, file.path, "from");
    requirePerson(file.record.to, file.path, "to");
  }

  return findings;
}

/**
 * Rules: a union needs a partner, and nobody partners themselves.
 *
 * The schema already rejects an empty `partners` and a literal duplicate, so in the normal
 * pipeline these only fire for records that bypassed it. The resolved comparison is the part
 * the schema cannot do: two distinct ids that are the same person after merging.
 */
function checkUnions(records: ValidRecords, resolve: (id: string) => string): Finding[] {
  const findings: Finding[] = [];

  for (const file of records.unions) {
    const union = file.record;

    if (union.partners.length === 0) {
      findings.push(error("empty-union", file.path, `${union.id} has no partners`));
    }

    const seen = new Map<string, string>();
    for (const partner of union.partners) {
      const resolved = resolve(partner);
      const first = seen.get(resolved);

      if (first !== undefined) {
        findings.push(
          error(
            "self-partner",
            file.path,
            first === partner
              ? `${partner} is listed as their own partner`
              : `${first} and ${partner} are the same person, so ${union.id} partners them with themselves`,
          ),
        );
      }

      seen.set(resolved, partner);
    }
  }

  return findings;
}

/** Rule: every constrained string is a key in vocab.json. */
function checkVocabulary(records: ValidRecords): Finding[] {
  const findings: Finding[] = [];
  const { vocab } = records;

  const parentKind = keysOf(vocab.parentKind);
  const tag = keysOf(vocab.tag);
  const unionType = keysOf(vocab.unionType);
  const unionEnd = keysOf(vocab.unionEnd);
  const relationType = keysOf(vocab.relationType);
  const relationStatus = keysOf(vocab.relationStatus);
  const context = keysOf(vocab.context);

  const require = (value: string, allowed: Set<string>, list: string, where: string): void => {
    if (!allowed.has(value)) {
      findings.push(error("unknown-vocabulary", where, `${value} is not a key in vocab.${list}`));
    }
  };

  for (const file of records.people) {
    for (const parent of file.record.parents ?? []) {
      require(parent.kind, parentKind, "parentKind", file.path);
    }
    for (const value of file.record.tags ?? []) require(value, tag, "tag", file.path);
  }

  for (const file of records.unions) {
    require(file.record.type, unionType, "unionType", file.path);
    const endReason = file.record.endReason;
    if (endReason !== undefined && endReason !== null) {
      require(endReason, unionEnd, "unionEnd", file.path);
    }
  }

  for (const file of records.relations) {
    require(file.record.type, relationType, "relationType", file.path);
    require(file.record.status, relationStatus, "relationStatus", file.path);
    for (const value of file.record.context ?? []) require(value, context, "context", file.path);
  }

  return findings;
}

/** Rule: a relation's symmetric field agrees with its vocabulary entry. */
function checkSymmetry(records: ValidRecords): Finding[] {
  const byKey = new Map(records.vocab.relationType.map((entry) => [entry.key, entry]));

  return records.relations.flatMap((file) => {
    const entry = byKey.get(file.record.type);
    // An unknown type is already reported by the vocabulary rule.
    if (!entry || entry.symmetric === file.record.symmetric) return [];

    return [
      error(
        "symmetry-mismatch",
        file.path,
        `${file.record.type} is ${entry.symmetric ? "symmetric" : "asymmetric"} in vocab.json but the relation says symmetric: ${String(file.record.symmetric)}`,
      ),
    ];
  });
}

/** Rule: every date string parses under the section 7 subset. */
function checkDates(records: ValidRecords): Finding[] {
  const findings: Finding[] = [];

  const require = (value: string | null | undefined, field: string, where: string): void => {
    if (tryParseDate(value) === null) {
      findings.push(error("unparseable-date", where, `${field} is not a valid date: ${String(value)}`));
    }
  };

  for (const file of records.people) {
    require(file.record.birth?.date, "birth.date", file.path);
    require(file.record.death?.date, "death.date", file.path);
    for (const former of file.record.names.former ?? []) {
      require(former.until, `names.former "${former.display}" until`, file.path);
    }
  }

  for (const file of records.unions) {
    require(file.record.from, "from", file.path);
    require(file.record.to, "to", file.path);
  }

  for (const file of records.relations) {
    require(file.record.since, "since", file.path);
    require(file.record.until, "until", file.path);
  }

  return findings;
}

/** Rule: nobody is their own ancestor. Walks resolved ids so a loop through a tombstone counts. */
function checkParentageCycles(records: ValidRecords, resolve: (id: string) => string): Finding[] {
  const parents = new Map<string, string[]>();
  for (const file of records.people) {
    parents.set(
      resolve(file.record.id),
      (file.record.parents ?? []).map((edge) => resolve(edge.id)),
    );
  }

  const pathOf = new Map<string, string>();
  for (const file of records.people) pathOf.set(resolve(file.record.id), file.path);

  const findings: Finding[] = [];
  const settled = new Set<string>();
  const reported = new Set<string>();

  const walk = (id: string, stack: string[]): void => {
    if (settled.has(id)) return;

    const loopAt = stack.indexOf(id);
    if (loopAt !== -1) {
      const loop = [...stack.slice(loopAt), id];
      // Report a loop once, against whichever member sorts first, so the finding does not
      // depend on which person the walk happened to start from.
      const owner = [...loop].sort()[0] ?? id;
      if (!reported.has(owner)) {
        reported.add(owner);
        findings.push(
          error("parentage-cycle", pathOf.get(owner) ?? owner, `${loop.join(" -> ")} is a cycle`),
        );
      }
      return;
    }

    stack.push(id);
    for (const parent of parents.get(id) ?? []) walk(parent, stack);
    stack.pop();
    settled.add(id);
  };

  for (const file of records.people) walk(resolve(file.record.id), []);

  return findings;
}

export function checkStructure(records: ValidRecords): Finding[] {
  const resolve = buildGraph({
    people: records.people.map((file) => file.record),
    unions: [],
    relations: [],
    vocab: records.vocab,
  }).resolve;

  return [
    ...checkFilenames(records),
    ...checkDuplicateIds(records),
    ...checkReferences(records, resolve),
    ...checkUnions(records, resolve),
    ...checkVocabulary(records),
    ...checkSymmetry(records),
    ...checkDates(records),
    ...checkParentageCycles(records, resolve),
  ];
}
