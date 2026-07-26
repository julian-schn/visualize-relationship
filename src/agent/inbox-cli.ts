import process from "node:process";
import { applyInbox } from "./inbox.ts";

const today = new Date().toISOString().slice(0, 10);

try {
  const result = await applyInbox(process.cwd(), today);

  if (result.applied.length === 0) {
    process.stdout.write("inbox: nothing staged\n");
    process.exit(0);
  }

  const lines = [
    `applied ${result.applied.length} patch(es), ${result.written.length} record(s) written`,
    ...result.written.map((write) => `  ${write.existing ? "update" : "create"}  ${write.path}`),
    ...result.suggestions.map((path) => `  question ${path}`),
  ];

  if (result.warnings > 0) lines.push(`${result.warnings} warning(s); run npm run validate`);

  process.stdout.write(`${lines.join("\n")}\n`);
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
}
