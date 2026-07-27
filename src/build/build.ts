import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build as esbuild } from "esbuild";
import { graphFrom, loadRecords } from "../model/load.ts";
import { hasErrors, sortFindings, validateRecords, vocabularyKeys } from "../validate/index.ts";
import { readResolvedProposals } from "../validate/proposals.ts";
import { format } from "../validate/report.ts";
import { loadValidators } from "../validate/schema.ts";
import { compile, type CompiledGraph } from "./compile.ts";
import { assertOffline } from "./verify.ts";

/** Where the four woff2 files live, relative to the repo root. */
export const FONT_DIR = "src/viewer/fonts";

/**
 * Section 11.4 wants three faces self-hosted, and section 2 forbids the page fetching
 * anything, so they are inlined as data URIs at build time. Latin subsets only: four files
 * for three families cost about 70K, which is the difference between a considered page and
 * a page that ships a webfont CDN's worth of glyphs nobody will read.
 *
 * Latin, not latin-ext. Google's css2 response lists the latin-ext @font-face block first,
 * so taking the first URL gets a file with no ASCII letters in it at all and every glyph
 * silently falls back to system-ui. tests/fonts.test.ts asserts the coverage instead of
 * trusting the download.
 */
export const FACES = [
  { family: "Space Grotesk", file: "space-grotesk.woff2", weight: "500" },
  { family: "Schibsted Grotesk", file: "schibsted-grotesk.woff2", weight: "400" },
  { family: "Schibsted Grotesk", file: "schibsted-grotesk-500.woff2", weight: "500" },
  { family: "IBM Plex Mono", file: "plex-mono.woff2", weight: "400" },
];

async function fontFaces(root: string): Promise<string> {
  const rules: string[] = [];

  for (const face of FACES) {
    const bytes = await readFile(join(root, FONT_DIR, face.file));
    rules.push(
      `@font-face{font-family:"${face.family}";font-style:normal;font-weight:${face.weight};` +
        `font-display:swap;src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2")}`,
    );
  }

  return rules.join("\n");
}

/**
 * The OFL requires its notice and licence to travel with the font software wherever it goes,
 * and inlining the four woff2 as data URIs redistributes them: dist/graph.html is committed
 * and anyone who clones the repo gets a copy. OFL.txt covers the files in the source tree,
 * not the ones inside the page, so the page carries its own.
 *
 * An HTML comment rather than markup, because it is legal text and not content. Section 12.2
 * is unaffected: verifyOffline strips comments before it scans for URLs, so the OFL's own
 * scripts.sil.org address cannot trip no-remote-url.
 */
async function fontLicence(root: string): Promise<string> {
  const ofl = await readFile(join(root, FONT_DIR, "OFL.txt"), "utf8");
  return `<!--\n${ofl.trim()}\n-->`;
}

export interface BuildResult {
  html: string;
  graph: CompiledGraph;
  warnings: number;
}

/**
 * A `</script>` anywhere in the data would close the block early and spill the rest of the
 * graph into the page as markup. The block is raw text until that sequence, so escaping the
 * slash is enough, and JSON.parse reads `<\/` back as `</`.
 */
function escapeForScriptBlock(json: string): string {
  return json.replace(/<\//g, "<\\/");
}

function page(graph: CompiledGraph, css: string, js: string, licence: string): string {
  // The graph is a JSON block rather than a fetch: section 2, and the single most common
  // way a file:// page breaks.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relationship graph</title>
${licence}
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="graph">
${escapeForScriptBlock(JSON.stringify(graph))}
</script>
<script>
${js}
</script>
</body>
</html>
`;
}

export async function buildGraphPage(root: string, today: string): Promise<BuildResult> {
  const [records, validators] = await Promise.all([loadRecords(root), loadValidators(root)]);

  const findings = validateRecords(records, validators, {
    today,
    resolvedProposals: await readResolvedProposals(root, vocabularyKeys(records.vocab)),
  });

  // Section 12.1 step 2: abort on error. A viewer built from data that failed validation is
  // worse than no viewer, because it looks authoritative.
  if (hasErrors(findings)) {
    throw new Error(`validation failed, refusing to build:\n${format(sortFindings(findings))}`);
  }

  const graph = compile(graphFrom(records));

  const css = `${await fontFaces(root)}\n${await readFile(join(root, "src/viewer/style.css"), "utf8")}`;

  const bundled = await esbuild({
    entryPoints: [join(root, "src/viewer/main.ts")],
    // Resolve imports from the repo being built, not from wherever the process was started.
    absWorkingDir: root,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    // Everything ships inline; nothing may resolve at runtime.
    write: false,
    minify: true,
    legalComments: "none",
  });

  const js = bundled.outputFiles[0]?.text;
  if (js === undefined) throw new Error("esbuild produced no bundle");

  const html = page(graph, css.trim(), js.trim(), await fontLicence(root));

  // Section 12.2: assert against the real output, whatever esbuild said.
  assertOffline(html);

  return { html, graph, warnings: findings.filter((f) => f.level === "warning").length };
}

export async function writeGraphPage(root: string, today: string): Promise<BuildResult> {
  const result = await buildGraphPage(root, today);
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist/graph.html"), result.html);
  return result;
}
