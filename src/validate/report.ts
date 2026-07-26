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

/** Grouped by rule, with a count of each level last. */
export function format(findings: readonly Finding[]): string {
  if (findings.length === 0) return "validate: nothing to report\n";

  const lines: string[] = [];
  let lastRule = "";

  for (const finding of findings) {
    if (finding.rule !== lastRule) {
      if (lastRule !== "") lines.push("");
      lines.push(`${finding.level}: ${finding.rule}`);
      lastRule = finding.rule;
    }
    lines.push(`  ${finding.where}: ${finding.message}`);
  }

  const errors = findings.filter((finding) => finding.level === "error").length;
  lines.push("", `${errors} error(s), ${findings.length - errors} warning(s)`);

  return `${lines.join("\n")}\n`;
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
