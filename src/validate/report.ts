export type Level = "error" | "warning";

export interface Finding {
  level: Level;
  /** Stable slug so tooling can group findings without matching on prose. */
  rule: string;
  /** Repo-relative file path where known, otherwise a record id. */
  where: string;
  message: string;
}

export function error(rule: string, where: string, message: string): Finding {
  return { level: "error", rule, where, message };
}

export function warning(rule: string, where: string, message: string): Finding {
  return { level: "warning", rule, where, message };
}

export function hasErrors(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.level === "error");
}

/** Errors first, then a stable order, so two runs over the same data print identically. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const rank = (finding: Finding): number => (finding.level === "error" ? 0 : 1);

  return [...findings].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.rule.localeCompare(b.rule) ||
      a.where.localeCompare(b.where) ||
      a.message.localeCompare(b.message),
  );
}
