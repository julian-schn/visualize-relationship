import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { loadRecords } from "../model/load.ts";
import { hasErrors, sortFindings, validateRecords, vocabularyKeys } from "../validate/index.ts";
import { readResolvedProposals } from "../validate/proposals.ts";
import { format } from "../validate/report.ts";
import { loadValidators } from "../validate/schema.ts";
import {
  DIRECTORIES,
  PatchError,
  planPatch,
  serialise,
  suggestionFrom,
  type Patch,
  type PlannedWrite,
  type RecordType,
} from "./patch.ts";

export interface ApplyResult {
  applied: string[];
  written: PlannedWrite[];
  suggestions: string[];
  warnings: number;
}

async function stagedPatches(root: string): Promise<{ name: string; patch: Patch }[]> {
  let names: string[];
  try {
    names = (await readdir(join(root, "inbox/staged")))
      .filter((name) => name.endsWith(".patch.json"))
      .sort();
  } catch {
    return [];
  }

  const patches: { name: string; patch: Patch }[] = [];
  for (const name of names) {
    const text = await readFile(join(root, "inbox/staged", name), "utf8");
    try {
      patches.push({ name, patch: JSON.parse(text) as Patch });
    } catch (cause) {
      throw new PatchError(`inbox/staged/${name}: invalid JSON${cause instanceof Error ? `: ${cause.message}` : ""}`);
    }
  }

  return patches;
}

/**
 * Applies every staged patch, or none of them. Section 13.1 is explicit that this is atomic:
 * records are planned, written to a scratch map, validated as a whole, and only then put on
 * disk. A half-applied patch would leave the data in a state nobody chose.
 */
export async function applyInbox(root: string, today: string): Promise<ApplyResult> {
  const patches = await stagedPatches(root);
  if (patches.length === 0) return { applied: [], written: [], suggestions: [], warnings: 0 };

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const patchSchema = ajv.compile(
    JSON.parse(await readFile(join(root, "schema/patch.schema.json"), "utf8")) as object,
  );

  for (const { name, patch } of patches) {
    if (!patchSchema(patch)) {
      throw new PatchError(`inbox/staged/${name}: ${ajv.errorsText(patchSchema.errors)}`);
    }
  }

  const records = await loadRecords(root);
  const existing = new Map<string, { type: RecordType; record: Record<string, unknown> }>();
  const collect = (type: RecordType, files: { record: { id: string } }[]): void => {
    for (const file of files) {
      existing.set(file.record.id, {
        type,
        record: file.record as unknown as Record<string, unknown>,
      });
    }
  };
  collect("person", records.people);
  collect("union", records.unions);
  collect("relation", records.relations);

  // Keyed by id: a second patch touching the same record supersedes the first rather than
  // queueing a second write, which would look like a duplicate id to validation.
  const writes = new Map<string, PlannedWrite>();
  for (const { name, patch } of patches) {
    try {
      for (const write of planPatch(patch, existing, today)) {
        existing.set(write.id, { type: write.type, record: write.record });
        writes.set(write.id, write);
      }
    } catch (cause) {
      throw new PatchError(
        `inbox/staged/${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  const written = [...writes.values()].sort((a, b) => a.path.localeCompare(b.path));

  // Validate the whole graph as it would be, before a single byte reaches the record files.
  const validators = await loadValidators(root);
  const proposed = {
    ...records,
    people: rebuild("person", records.people, written),
    unions: rebuild("union", records.unions, written),
    relations: rebuild("relation", records.relations, written),
  };

  const findings = validateRecords(proposed, validators, {
    today,
    resolvedProposals: await readResolvedProposals(root, vocabularyKeys(records.vocab)),
  });

  if (hasErrors(findings)) {
    throw new PatchError(
      `applying would break validation, so nothing was written:\n${format(sortFindings(findings))}`,
    );
  }

  for (const write of written) {
    await mkdir(join(root, DIRECTORIES[write.type]), { recursive: true });
    await writeFile(join(root, write.path), serialise(write.type, write.record));
  }

  const suggestions: string[] = [];
  await mkdir(join(root, "suggestions"), { recursive: true });
  await mkdir(join(root, "inbox/processed"), { recursive: true });

  for (const { name, patch } of patches) {
    const suggestion = suggestionFrom(patch, `inbox/staged/${name}`, today);
    if (suggestion !== null) {
      // Patch files are usually named by timestamp already; do not date them twice.
      const stem = name.replace(/\.patch\.json$/, "");
      const dated = /^\d{4}-\d{2}-\d{2}/.test(stem) ? stem : `${today}-${stem}`;
      const path = `suggestions/${dated}.md`;
      await writeFile(join(root, path), suggestion);
      suggestions.push(path);
    }
    await rename(join(root, "inbox/staged", name), join(root, "inbox/processed", name));
  }

  return {
    applied: patches.map((entry) => entry.name),
    written,
    suggestions,
    warnings: findings.filter((finding) => finding.level === "warning").length,
  };
}

/** The record list as it would be after the patch, for validating before writing. */
function rebuild<T extends { id: string }>(
  type: RecordType,
  files: { path: string; stem: string; record: T }[],
  written: readonly PlannedWrite[],
): { path: string; stem: string; record: T }[] {
  const mine = written.filter((write) => write.type === type);
  const byId = new Map(mine.map((write) => [write.id, write]));
  const kept = files.map((file) => {
    const replacement = byId.get(file.record.id);
    return replacement === undefined
      ? file
      : { ...file, record: replacement.record as unknown as T };
  });

  const known = new Set(files.map((file) => file.record.id));
  const added = mine
    .filter((write) => !known.has(write.id))
    .map((write) => ({
      path: write.path,
      stem: write.id,
      record: write.record as unknown as T,
    }));

  return [...kept, ...added];
}
