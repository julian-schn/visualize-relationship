import process from "node:process";
import { format, hasErrors, validateRepo } from "./index.ts";

const findings = await validateRepo(process.cwd(), new Date().toISOString().slice(0, 10));

process.stdout.write(format(findings));
process.exit(hasErrors(findings) ? 1 : 0);
