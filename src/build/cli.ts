import process from "node:process";
import { writeGraphPage } from "./build.ts";

const result = await writeGraphPage(process.cwd(), new Date().toISOString().slice(0, 10));
const { people, unions, relations } = result.graph.builtFrom;

process.stdout.write(
  `build: dist/graph.html, ${people} people, ${unions} unions, ${relations} relations` +
    `${result.warnings > 0 ? `, ${result.warnings} warning(s)` : ""}\n`,
);
