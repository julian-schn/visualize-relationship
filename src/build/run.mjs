// Runs a TypeScript entry point on Node, which cannot execute TypeScript itself. esbuild is
// already a dependency for the viewer bundle, so reusing it here keeps npm scripts written in
// the same language as the rest of the source without adding a runtime or a build artefact.
//
// Delete this the day the project's minimum Node version supports type stripping natively.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const entry = process.argv[2];

if (entry === undefined) {
  process.stderr.write("usage: node src/build/run.mjs <entry.ts> [args...]\n");
  process.exit(2);
}

// Drop the entry path so the target sees the argv it would have as a real script, rather
// than its own filename as the first user argument.
process.argv.splice(2, 1);

const cache = join(process.cwd(), "node_modules", ".cache", "visualize-relationship");
await mkdir(cache, { recursive: true });

const bundled = await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Dependencies stay external and resolve from node_modules as usual.
  packages: "external",
  write: false,
});

const output = bundled.outputFiles[0];

if (output === undefined) {
  process.stderr.write(`run: esbuild produced nothing for ${entry}\n`);
  process.exit(2);
}

// Written inside node_modules so bare imports in the bundle resolve normally.
const compiled = join(cache, `${entry.replace(/[^a-zA-Z0-9]+/g, "-")}.mjs`);
await writeFile(compiled, output.text);

await import(pathToFileURL(compiled).href);
