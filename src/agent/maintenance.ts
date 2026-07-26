import { fold } from "../model/id.ts";
import type { RawRecords, SourceFile } from "../model/load.ts";
import type { Person } from "../model/types.ts";
import { tryParseDate } from "../model/date.ts";
import { nameFormsOf } from "../viewer/search.ts";
import { serialise, type RecordType } from "./patch.ts";

export type Severity = "fix" | "propose";

export interface Finding {
  rule: string;
  /** `fix` is mechanical and reversible; `propose` needs a human, per section 13.2. */
  severity: Severity;
  where: string;
  message: string;
  /** Supporting detail for a proposal, never a verdict. */
  evidence?: string[];
}

export interface Report {
  findings: Finding[];
}

/** Roughly how long an inline note may be before section 13.2 says move it to a sidecar. */
const MAX_INLINE_NOTE_LINES = 20;

/** Section 13.2 caps an unattended change; past this it is a proposal whatever it is. */
export const BULK_LIMIT = 10;

function isFormatted(file: SourceFile<unknown>, type: RecordType, raw: string): boolean {
  return raw === serialise(type, file.record as Record<string, unknown>);
}

/** Auto-fixable: formatting, key order, a filename that drifted from its id. */
export function mechanicalFindings(
  records: RawRecords,
  sources: ReadonlyMap<string, string>,
): Finding[] {
  const findings: Finding[] = [];

  const check = (type: RecordType, files: SourceFile<{ id: string }>[]): void => {
    for (const file of files) {
      if (file.stem !== file.record.id) {
        findings.push({
          rule: "filename-drift",
          severity: "fix",
          where: file.path,
          message: `rename to ${file.record.id}.json`,
        });
      }

      const raw = sources.get(file.path);
      if (raw !== undefined && !isFormatted(file, type, raw)) {
        findings.push({
          rule: "formatting",
          severity: "fix",
          where: file.path,
          message: "key order or whitespace differs from the canonical form",
        });
      }
    }
  };

  check("person", records.people);
  check("union", records.unions);
  check("relation", records.relations);

  for (const file of records.people) {
    const notes = file.record.notes;
    if (notes !== undefined && notes.split("\n").length > MAX_INLINE_NOTE_LINES) {
      findings.push({
        rule: "oversized-note",
        severity: "fix",
        where: file.path,
        message: `move the inline note to notes/${file.record.id}.md`,
      });
    }
  }

  return findings;
}

interface Candidate {
  a: Person;
  b: Person;
  score: number;
  evidence: string[];
}

function sharedNameForm(a: Person, b: Person): string | null {
  const theirs = new Set(nameFormsOf(b).map(fold));
  return nameFormsOf(a).find((form) => theirs.has(fold(form))) ?? null;
}

function datesOverlap(a: Person, b: Person): boolean {
  const first = tryParseDate(a.birth?.date);
  const second = tryParseDate(b.birth?.date);
  if (first?.earliest == null || second?.earliest == null) return false;
  if (first.latest == null || second.latest == null) return false;
  return first.earliest <= second.latest && second.earliest <= first.latest;
}

/**
 * Suspected duplicates, scored with the evidence that produced the score. Section 13.2 is
 * explicit that this reports and never decides: merging is destructive, the tool cannot see
 * that two Karls are different men, and a wrong merge is very hard to undo.
 */
export function duplicateCandidates(records: RawRecords): Candidate[] {
  const people = records.people.map((file) => file.record).filter((p) => p.status !== "merged");
  const partners = new Map<string, Set<string>>();

  for (const file of records.unions) {
    for (const a of file.record.partners) {
      for (const b of file.record.partners) {
        if (a === b) continue;
        const existing = partners.get(a);
        if (existing) existing.add(b);
        else partners.set(a, new Set([b]));
      }
    }
  }

  const candidates: Candidate[] = [];

  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      const a = people[i];
      const b = people[j];
      if (a === undefined || b === undefined) continue;

      const evidence: string[] = [];
      let score = 0;

      const name = sharedNameForm(a, b);
      if (name !== null) {
        score += 3;
        evidence.push(`both answer to "${name}"`);
      }

      const shared = [...(partners.get(a.id) ?? [])].filter((id) =>
        (partners.get(b.id) ?? new Set()).has(id),
      );
      if (shared.length > 0) {
        score += 2;
        evidence.push(`share a partner: ${shared.join(", ")}`);
      }

      const parentsOfA = new Set((a.parents ?? []).map((edge) => edge.id));
      const sharedParents = (b.parents ?? []).filter((edge) => parentsOfA.has(edge.id));
      if (sharedParents.length > 0) {
        score += 2;
        evidence.push(`share a parent: ${sharedParents.map((edge) => edge.id).join(", ")}`);
      }

      if (datesOverlap(a, b)) {
        score += 1;
        evidence.push("birth dates overlap");
      }

      // A shared name alone is not enough; plenty of families reuse one.
      if (score >= 4) candidates.push({ a, b, score, evidence });
    }
  }

  return candidates.sort((first, second) => second.score - first.score);
}

export function buildReport(records: RawRecords, sources: ReadonlyMap<string, string>): Report {
  const findings = mechanicalFindings(records, sources);

  for (const candidate of duplicateCandidates(records)) {
    findings.push({
      rule: "possible-duplicate",
      severity: "propose",
      where: `people/${candidate.a.id}.json`,
      message: `${candidate.a.id} and ${candidate.b.id} may be the same person (score ${candidate.score})`,
      evidence: candidate.evidence,
    });
  }

  const fixes = findings.filter((finding) => finding.severity === "fix").length;
  if (fixes > BULK_LIMIT) {
    findings.push({
      rule: "bulk-change",
      severity: "propose",
      where: ".",
      message: `${fixes} records would be rewritten at once; section 13.2 wants a human past ${BULK_LIMIT}`,
    });
  }

  return { findings };
}

export function formatReport(report: Report): string {
  if (report.findings.length === 0) return "maintenance: nothing to report\n";

  const lines: string[] = [];
  for (const finding of report.findings) {
    lines.push(`${finding.severity}: ${finding.rule}`);
    lines.push(`  ${finding.where}: ${finding.message}`);
    for (const line of finding.evidence ?? []) lines.push(`    ${line}`);
  }

  const fixes = report.findings.filter((finding) => finding.severity === "fix").length;
  lines.push("", `${fixes} auto-fixable, ${report.findings.length - fixes} needing a human`);

  return `${lines.join("\n")}\n`;
}
