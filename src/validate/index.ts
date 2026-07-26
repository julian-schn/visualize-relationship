import { loadRecords, type RawRecords } from "../model/load.ts";
import { checkStructure } from "./errors.ts";
import { sortFindings, type Finding } from "./report.ts";
import { checkSchemas, loadValidators, type Validators } from "./schema.ts";

export { hasErrors, sortFindings } from "./report.ts";
export type { Finding, Level } from "./report.ts";

export function validateRecords(records: RawRecords, validators: Validators): Finding[] {
  const schema = checkSchemas(validators, records);
  const findings = [...schema.findings];

  // Without a readable vocabulary there is no way to tell a bad key from a missing one, so
  // the rules that depend on it are skipped rather than made to guess.
  if (schema.valid.vocab !== null) {
    findings.push(
      ...checkStructure({
        people: schema.valid.people,
        unions: schema.valid.unions,
        relations: schema.valid.relations,
        vocab: schema.valid.vocab,
      }),
    );
  }

  return sortFindings(findings);
}

export async function validateRepo(root: string): Promise<Finding[]> {
  const [records, validators] = await Promise.all([loadRecords(root), loadValidators(root)]);
  return validateRecords(records, validators);
}
