import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { loadRecords } from "../model/load.ts";
import { serialise, type RecordType } from "./patch.ts";
import { buildReport, formatReport } from "./maintenance.ts";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const asJson = process.argv.includes("--format") && process.argv.includes("json");

const records = await loadRecords(root);

// The raw text of each file, so formatting drift is detectable rather than guessed at.
const sources = new Map<string, string>();
for (const file of [...records.people, ...records.unions, ...records.relations]) {
  sources.set(file.path, await readFile(join(root, file.path), "utf8"));
}

const report = buildReport(records, sources);

if (args.has("--fix")) {
  const typeOf = (path: string): RecordType =>
    path.startsWith("people/") ? "person" : path.startsWith("unions/") ? "union" : "relation";

  const applied: string[] = [];

  for (const finding of report.findings) {
    if (finding.severity !== "fix") continue;

    if (finding.rule === "formatting") {
      const file = [...records.people, ...records.unions, ...records.relations].find(
        (candidate) => candidate.path === finding.where,
      );
      if (file === undefined) continue;
      await writeFile(
        join(root, file.path),
        serialise(typeOf(file.path), file.record as unknown as Record<string, unknown>),
      );
      applied.push(`formatted ${file.path}`);
      continue;
    }

    if (finding.rule === "filename-drift") {
      const file = [...records.people, ...records.unions, ...records.relations].find(
        (candidate) => candidate.path === finding.where,
      );
      if (file === undefined) continue;
      const target = finding.where.replace(/[^/]+$/, `${file.record.id}.json`);
      await rename(join(root, finding.where), join(root, target));
      applied.push(`renamed ${finding.where} to ${target}`);
    }
  }

  process.stdout.write(
    applied.length === 0 ? "maintenance: nothing to fix\n" : `${applied.join("\n")}\n`,
  );
  process.exit(0);
}

// Section 13.2: --format json is the stable interface the weekly workflow reads.
process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
