import { loadRecords, type RawRecords } from "../model/load.ts";
import type { Vocab } from "../model/types.ts";
import { checkStructure } from "./errors.ts";
import { readResolvedProposals } from "./proposals.ts";
import { sortFindings, type Finding } from "./report.ts";
import { checkSchemas, loadValidators, type Validators } from "./schema.ts";
import { checkWarnings } from "./warnings.ts";

export { format, hasErrors, sortFindings } from "./report.ts";
export type { Finding, Level } from "./report.ts";

export interface ValidateOptions {
  /** Today, as `YYYY-MM-DD`. Injected so a run is reproducible. */
  today: string;
  resolvedProposals?: Set<string>;
}

export function vocabularyKeys(vocab: Vocab): string[] {
  return [
    ...vocab.relationType,
    ...vocab.parentKind,
    ...vocab.unionType,
    ...vocab.unionEnd,
    ...vocab.relationStatus,
    ...vocab.context,
    ...vocab.tag,
  ].map((entry) => entry.key);
}

export function validateRecords(
  records: RawRecords,
  validators: Validators,
  options: ValidateOptions,
): Finding[] {
  const schema = checkSchemas(validators, records);
  const findings = [...schema.findings];

  // Without a readable vocabulary there is no way to tell a bad key from a missing one, so
  // the rules that depend on it are skipped rather than made to guess.
  if (schema.valid.vocab !== null) {
    const valid = {
      people: schema.valid.people,
      unions: schema.valid.unions,
      relations: schema.valid.relations,
      vocab: schema.valid.vocab,
    };

    findings.push(...checkStructure(valid));
    findings.push(
      ...checkWarnings({
        ...valid,
        notes: records.notes,
        today: options.today,
        resolvedProposals: options.resolvedProposals ?? new Set(),
      }),
    );
  }

  return sortFindings(findings);
}

export async function validateRepo(root: string, today: string): Promise<Finding[]> {
  const [records, validators] = await Promise.all([loadRecords(root), loadValidators(root)]);

  return validateRecords(records, validators, {
    today,
    resolvedProposals: await readResolvedProposals(root, vocabularyKeys(records.vocab)),
  });
}
