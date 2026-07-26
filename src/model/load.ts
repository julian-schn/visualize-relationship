import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildGraph, type Graph } from "./graph.ts";
import type { Person, Relation, Union, Vocab } from "./types.ts";

export interface SourceFile<T> {
  /** Repo-relative, for error messages. */
  path: string;
  /** Filename without its extension. The validator compares this against the record id. */
  stem: string;
  record: T;
}

/**
 * Everything on disk, exactly as written. Records are cast, not validated; that is
 * milestone 3's job and it needs the unmodified files to report against.
 */
export interface RawRecords {
  people: SourceFile<Person>[];
  unions: SourceFile<Union>[];
  relations: SourceFile<Relation>[];
  notes: SourceFile<string>[];
  vocab: Vocab;
}

export class LoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LoadError";
  }
}

async function listFiles(directory: string, extension: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  // Sorted so a load is reproducible regardless of directory order.
  return entries.filter((name) => name.endsWith(extension)).sort();
}

async function readJsonDir<T>(root: string, directory: string): Promise<SourceFile<T>[]> {
  const names = await listFiles(join(root, directory), ".json");
  const files: SourceFile<T>[] = [];

  for (const name of names) {
    const path = `${directory}/${name}`;
    const text = await readFile(join(root, directory, name), "utf8");
    let record: T;
    try {
      record = JSON.parse(text) as T;
    } catch (cause) {
      throw new LoadError(`${path}: invalid JSON`, { cause });
    }
    files.push({ path, stem: name.slice(0, -".json".length), record });
  }

  return files;
}

async function readNotes(root: string): Promise<SourceFile<string>[]> {
  const names = await listFiles(join(root, "notes"), ".md");
  const files: SourceFile<string>[] = [];

  for (const name of names) {
    files.push({
      path: `notes/${name}`,
      stem: name.slice(0, -".md".length),
      record: await readFile(join(root, "notes", name), "utf8"),
    });
  }

  return files;
}

export async function loadRecords(root: string): Promise<RawRecords> {
  const [people, unions, relations, notes, vocabText] = await Promise.all([
    readJsonDir<Person>(root, "people"),
    readJsonDir<Union>(root, "unions"),
    readJsonDir<Relation>(root, "relations"),
    readNotes(root),
    readFile(join(root, "vocab.json"), "utf8").catch((cause: unknown) => {
      throw new LoadError("vocab.json: cannot be read", { cause });
    }),
  ]);

  let vocab: Vocab;
  try {
    vocab = JSON.parse(vocabText) as Vocab;
  } catch (cause) {
    throw new LoadError("vocab.json: invalid JSON", { cause });
  }

  return { people, unions, relations, notes, vocab };
}

export function graphFrom(records: RawRecords): Graph {
  return buildGraph({
    people: records.people.map((file) => file.record),
    unions: records.unions.map((file) => file.record),
    relations: records.relations.map((file) => file.record),
    vocab: records.vocab,
    notes: new Map(records.notes.map((file) => [file.stem, file.record])),
  });
}

export async function loadGraph(root: string): Promise<Graph> {
  return graphFrom(await loadRecords(root));
}
