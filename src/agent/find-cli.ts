import process from "node:process";
import { loadRecords } from "../model/load.ts";
import { findIn, formatHits } from "./find.ts";

const query = process.argv.slice(2).join(" ");

if (query.trim() === "") {
  process.stderr.write('usage: npm run find -- "karl"\n');
  process.exit(2);
}

const hits = findIn(await loadRecords(process.cwd()), query);
process.stdout.write(formatHits(hits, query));
