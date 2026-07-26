import type { Person, Relation, Union } from "../model/types.ts";

export type RecordType = "person" | "union" | "relation";

export interface Patch {
  creates?: { type: RecordType; record: Record<string, unknown> }[];
  updates?: { type: RecordType; id: string; set: Record<string, unknown> }[];
  notes?: string;
  uncertain?: string[];
}

export type AnyRecord = Person | Union | Relation;

export const DIRECTORIES: Record<RecordType, string> = {
  person: "people",
  union: "unions",
  relation: "relations",
};

/** Key order in written files, so a diff shows a change rather than a reshuffle. */
const KEY_ORDER: Record<RecordType, string[]> = {
  person: [
    "id",
    "names",
    "pronouns",
    "birth",
    "death",
    "status",
    "mergedInto",
    "parents",
    "tags",
    "links",
    "notes",
    "meta",
  ],
  union: ["id", "partners", "type", "from", "to", "endReason", "note"],
  relation: [
    "id",
    "type",
    "from",
    "to",
    "symmetric",
    "closeness",
    "since",
    "until",
    "status",
    "endReason",
    "context",
    "note",
  ],
};

export function orderKeys(type: RecordType, record: Record<string, unknown>): Record<string, unknown> {
  const order = KEY_ORDER[type];
  const ordered: Record<string, unknown> = {};

  for (const key of order) {
    if (Object.hasOwn(record, key)) ordered[key] = record[key];
  }
  // Anything unrecognised keeps its place at the end rather than being dropped.
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(ordered, key)) ordered[key] = record[key];
  }

  return ordered;
}

export function serialise(type: RecordType, record: Record<string, unknown>): string {
  return `${JSON.stringify(orderKeys(type, record), null, 2)}\n`;
}

export interface PlannedWrite {
  type: RecordType;
  id: string;
  path: string;
  record: Record<string, unknown>;
  /** Whether this replaces a record that already exists. */
  existing: boolean;
}

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

/**
 * What a patch would write, without writing it. Kept separate from the filesystem so the
 * refusals below are testable and so nothing lands until every one of them has passed.
 */
export function planPatch(
  patch: Patch,
  existing: ReadonlyMap<string, { type: RecordType; record: Record<string, unknown> }>,
  today: string,
): PlannedWrite[] {
  const planned = new Map<string, PlannedWrite>();

  for (const create of patch.creates ?? []) {
    const id = create.record["id"];
    if (typeof id !== "string" || id === "") {
      throw new PatchError(`a created ${create.type} has no id`);
    }
    if (existing.has(id)) {
      throw new PatchError(`${id} already exists; use updates, not creates`);
    }
    if (planned.has(id)) {
      throw new PatchError(`${id} is created twice in one patch`);
    }

    const record = { ...create.record };
    if (create.type === "person") record["meta"] = withMeta(record["meta"], today, true);

    planned.set(id, {
      type: create.type,
      id,
      path: `${DIRECTORIES[create.type]}/${id}.json`,
      record,
      existing: false,
    });
  }

  for (const update of patch.updates ?? []) {
    const current = planned.get(update.id) ?? existing.get(update.id);
    if (current === undefined) {
      throw new PatchError(`${update.id} does not exist; use creates, not updates`);
    }
    if (current.type !== update.type) {
      throw new PatchError(`${update.id} is a ${current.type}, not a ${update.type}`);
    }
    if (Object.hasOwn(update.set, "id")) {
      throw new PatchError(`${update.id}: ids are permanent and cannot be changed`);
    }

    const record = { ...current.record, ...update.set };
    if (update.type === "person") record["meta"] = withMeta(record["meta"], today, false);

    planned.set(update.id, {
      type: update.type,
      id: update.id,
      path: `${DIRECTORIES[update.type]}/${update.id}.json`,
      record,
      existing: existing.has(update.id),
    });
  }

  return [...planned.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function withMeta(current: unknown, today: string, creating: boolean): Record<string, unknown> {
  const meta = typeof current === "object" && current !== null ? { ...current } : {};
  const created = (meta as Record<string, unknown>)["created"];

  return {
    ...meta,
    created: creating || typeof created !== "string" ? today : created,
    updated: today,
    author: "agent",
  };
}

/** The suggestions file a patch's open questions become. Section 13.1: never guess silently. */
export function suggestionFrom(patch: Patch, source: string, today: string): string | null {
  const questions = patch.uncertain ?? [];
  if (questions.length === 0) return null;

  const lines = [
    `# Open questions from ${source}`,
    "",
    ...(patch.notes === undefined || patch.notes === "" ? [] : [patch.notes, ""]),
    ...questions.map((question) => `- [ ] ${question}`),
    "",
    `Raised ${today}. Delete this file once every box is ticked.`,
    "",
  ];

  return lines.join("\n");
}
