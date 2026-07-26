import { tryParseDate, type ParsedDate } from "../model/date.ts";
import { buildGraph } from "../model/graph.ts";
import type { SourceFile } from "../model/load.ts";
import type { VocabEntry } from "../model/types.ts";
import { warning, type Finding } from "./report.ts";
import type { ValidRecords } from "./errors.ts";

export interface WarningContext extends ValidRecords {
  notes: SourceFile<string>[];
  /** Today, as `YYYY-MM-DD`. Injected so a run is reproducible. */
  today: string;
  /** Vocabulary keys with a resolved proposal, from `proposals/`. */
  resolvedProposals: Set<string>;
}

const MINIMUM_PARENT_AGE_YEARS = 12;
const IMPLAUSIBLE_AGE_YEARS = 110;
const PROVISIONAL_GRACE_DAYS = 30;

function interval(raw: string | null | undefined): ParsedDate | null {
  const parsed = tryParseDate(raw);
  // An unparseable date is already an error; do not warn about it as well.
  return parsed?.precision === "unknown" ? null : parsed;
}

function shiftYears(date: string, years: number): string {
  const year = Number(date.slice(0, 4)) + years;
  return `${String(year).padStart(4, "0")}${date.slice(4)}`;
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** Warning: a child born before, or too soon after, a parent. */
function checkParentAges(context: WarningContext): Finding[] {
  const birthOf = new Map<string, ParsedDate | null>();
  for (const file of context.people) birthOf.set(file.record.id, interval(file.record.birth?.date));

  const findings: Finding[] = [];

  for (const file of context.people) {
    const child = birthOf.get(file.record.id);
    if (!child?.earliest) continue;

    for (const parent of file.record.parents ?? []) {
      const parentBirth = birthOf.get(parent.id);
      if (!parentBirth?.latest) continue;

      const earliestPlausible = shiftYears(parentBirth.latest, MINIMUM_PARENT_AGE_YEARS);
      if (child.earliest >= earliestPlausible) continue;

      findings.push(
        warning(
          "implausible-parent-age",
          file.path,
          child.earliest < parentBirth.latest
            ? `${file.record.id} is born before their parent ${parent.id}`
            : `${file.record.id} is born less than ${MINIMUM_PARENT_AGE_YEARS} years after their parent ${parent.id}`,
        ),
      );
    }
  }

  return findings;
}

/** Warning: death before birth, and a union that ends before it starts. */
function checkOrdering(context: WarningContext): Finding[] {
  const findings: Finding[] = [];

  for (const file of context.people) {
    const birth = interval(file.record.birth?.date);
    const death = interval(file.record.death?.date);
    if (birth?.earliest && death?.latest && death.latest < birth.earliest) {
      findings.push(
        warning("death-before-birth", file.path, `${file.record.id} dies before they are born`),
      );
    }
  }

  for (const file of context.unions) {
    const from = interval(file.record.from);
    const to = interval(file.record.to);
    if (from?.earliest && to?.latest && to.latest < from.earliest) {
      findings.push(warning("union-ends-before-it-starts", file.path, `${file.record.id} ends before it starts`));
    }
  }

  for (const file of context.relations) {
    const since = interval(file.record.since);
    const until = interval(file.record.until);
    if (since?.earliest && until?.latest && until.latest < since.earliest) {
      findings.push(
        warning("relation-ends-before-it-starts", file.path, `${file.record.id} ends before it starts`),
      );
    }
  }

  return findings;
}

/** Warning: a relation that says why it ended while also saying it has not. */
function checkEndedContradictions(context: WarningContext): Finding[] {
  return context.relations.flatMap((file) => {
    const endReason = file.record.endReason;
    if (endReason === undefined || endReason === null) return [];
    if (file.record.status !== "active") return [];

    return [
      warning(
        "active-with-end-reason",
        file.path,
        `${file.record.id} is active but records why it ended (${endReason})`,
      ),
    ];
  });
}

/** Warning: a union or relation dated after a participant died. */
function checkPosthumousTies(context: WarningContext): Finding[] {
  const deathOf = new Map<string, ParsedDate | null>();
  for (const file of context.people) deathOf.set(file.record.id, interval(file.record.death?.date));

  const findings: Finding[] = [];

  const check = (id: string, start: ParsedDate | null, where: string, what: string): void => {
    const death = deathOf.get(id);
    if (!death?.latest || !start?.earliest) return;
    if (start.earliest <= death.latest) return;
    findings.push(warning("posthumous-tie", where, `${what} starts after ${id} died`));
  };

  for (const file of context.unions) {
    const from = interval(file.record.from);
    for (const partner of file.record.partners) check(partner, from, file.path, file.record.id);
  }

  for (const file of context.relations) {
    const since = interval(file.record.since);
    check(file.record.from, since, file.path, file.record.id);
    check(file.record.to, since, file.path, file.record.id);
  }

  return findings;
}

/** Warning: living, but born implausibly long ago. */
function checkImplausibleAge(context: WarningContext): Finding[] {
  return context.people.flatMap((file) => {
    if (file.record.status !== "living") return [];

    const birth = interval(file.record.birth?.date);
    if (!birth?.latest) return [];
    if (shiftYears(birth.latest, IMPLAUSIBLE_AGE_YEARS) >= context.today) return [];

    return [
      warning(
        "implausibly-old",
        file.path,
        `${file.record.id} is marked living but was born over ${IMPLAUSIBLE_AGE_YEARS} years ago`,
      ),
    ];
  });
}

/** Warnings: an island, and a graph in more than one piece. */
function checkConnectivity(context: WarningContext): Finding[] {
  const graph = buildGraph({
    people: context.people.map((file) => file.record),
    unions: context.unions.map((file) => file.record),
    relations: context.relations.map((file) => file.record),
    vocab: context.vocab,
  });

  const visible = new Set(graph.people.keys());
  const neighbours = new Map<string, Set<string>>();
  for (const id of visible) neighbours.set(id, new Set());

  const link = (a: string, b: string): void => {
    if (a === b || !visible.has(a) || !visible.has(b)) return;
    neighbours.get(a)?.add(b);
    neighbours.get(b)?.add(a);
  };

  for (const person of graph.people.values()) {
    for (const parent of person.parents ?? []) link(person.id, parent.id);
  }
  for (const union of graph.unions) {
    for (const partner of union.partners) {
      for (const other of union.partners) link(partner, other);
    }
  }
  for (const relation of graph.relations) link(relation.from, relation.to);

  const pathOf = new Map<string, string>();
  for (const file of context.people) pathOf.set(file.record.id, file.path);

  const findings: Finding[] = [];

  for (const [id, linked] of neighbours) {
    if (linked.size === 0) {
      findings.push(warning("island", pathOf.get(id) ?? id, `${id} has no relations of any kind`));
    }
  }

  const seen = new Set<string>();
  let components = 0;
  for (const id of visible) {
    if (seen.has(id)) continue;
    components += 1;
    const queue = [id];
    seen.add(id);
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const next of neighbours.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }

  if (components > 1) {
    findings.push(
      warning("disconnected-graph", "people/", `the graph is in ${components} disconnected pieces`),
    );
  }

  return findings;
}

/** Warning: a provisional vocabulary entry that nobody resolved. */
function checkProvisionalVocabulary(context: WarningContext): Finding[] {
  const findings: Finding[] = [];

  const collections: [string, VocabEntry[]][] = [
    ["relationType", context.vocab.relationType],
    ["parentKind", context.vocab.parentKind],
    ["unionType", context.vocab.unionType],
    ["unionEnd", context.vocab.unionEnd],
    ["relationStatus", context.vocab.relationStatus],
    ["context", context.vocab.context],
    ["tag", context.vocab.tag],
  ];

  for (const [name, entries] of collections) {
    for (const entry of entries) {
      if (entry.provisional !== true || entry.added === undefined) continue;
      if (context.resolvedProposals.has(entry.key)) continue;
      if (daysBetween(entry.added, context.today) <= PROVISIONAL_GRACE_DAYS) continue;

      findings.push(
        warning(
          "stale-provisional-vocabulary",
          "vocab.json",
          `${name}.${entry.key} has been provisional since ${entry.added} with no resolved proposal`,
        ),
      );
    }
  }

  return findings;
}

/** Warning: a notes sidecar belonging to nobody. */
function checkNotes(context: WarningContext): Finding[] {
  const ids = new Set(context.people.map((file) => file.record.id));

  return context.notes
    .filter((file) => !ids.has(file.stem))
    .map((file) => warning("orphan-note", file.path, `no person has the id ${file.stem}`));
}

export function checkWarnings(context: WarningContext): Finding[] {
  return [
    ...checkParentAges(context),
    ...checkOrdering(context),
    ...checkEndedContradictions(context),
    ...checkPosthumousTies(context),
    ...checkImplausibleAge(context),
    ...checkConnectivity(context),
    ...checkProvisionalVocabulary(context),
    ...checkNotes(context),
  ];
}
