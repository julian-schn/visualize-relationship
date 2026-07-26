import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { RawRecords, SourceFile } from "../model/load.ts";
import type { Person, Relation, Union, Vocab } from "../model/types.ts";
import { error, type Finding } from "./report.ts";

export interface Validators {
  person: ValidateFunction;
  union: ValidateFunction;
  relation: ValidateFunction;
  vocab: ValidateFunction;
}

export async function loadValidators(root: string): Promise<Validators> {
  // strict mode is on so a schema that silently validates nothing fails here, loudly, at
  // compile time rather than by passing every record.
  const ajv = new Ajv2020({ allErrors: true, strict: true });

  const compile = async (name: string): Promise<ValidateFunction> => {
    const text = await readFile(join(root, "schema", `${name}.schema.json`), "utf8");
    return ajv.compile(JSON.parse(text) as object);
  };

  const [person, union, relation, vocab] = await Promise.all([
    compile("person"),
    compile("union"),
    compile("relation"),
    compile("vocab"),
  ]);

  return { person, union, relation, vocab };
}

function findingsFrom(validate: ValidateFunction, where: string, data: unknown): Finding[] {
  if (validate(data)) return [];

  return (validate.errors ?? []).map((detail) => {
    const at = detail.instancePath === "" ? "the record" : detail.instancePath;
    return error("schema", where, `${at} ${detail.message ?? "is invalid"}`);
  });
}

function partition<T>(
  validate: ValidateFunction,
  files: SourceFile<T>[],
): { kept: SourceFile<T>[]; findings: Finding[] } {
  const kept: SourceFile<T>[] = [];
  const findings: Finding[] = [];

  for (const file of files) {
    const problems = findingsFrom(validate, file.path, file.record);
    if (problems.length === 0) kept.push(file);
    else findings.push(...problems);
  }

  return { kept, findings };
}

export interface SchemaCheck {
  findings: Finding[];
  /**
   * Only the records that matched their schema. Later rules read fields directly, so a
   * record that failed here would crash them or produce nonsense follow-on findings.
   */
  valid: {
    people: SourceFile<Person>[];
    unions: SourceFile<Union>[];
    relations: SourceFile<Relation>[];
    vocab: Vocab | null;
  };
}

export function checkSchemas(validators: Validators, records: RawRecords): SchemaCheck {
  const vocabFindings = findingsFrom(validators.vocab, "vocab.json", records.vocab);
  const people = partition(validators.person, records.people);
  const unions = partition(validators.union, records.unions);
  const relations = partition(validators.relation, records.relations);

  return {
    findings: [
      ...vocabFindings,
      ...people.findings,
      ...unions.findings,
      ...relations.findings,
    ],
    valid: {
      people: people.kept,
      unions: unions.kept,
      relations: relations.kept,
      vocab: vocabFindings.length === 0 ? records.vocab : null,
    },
  };
}
