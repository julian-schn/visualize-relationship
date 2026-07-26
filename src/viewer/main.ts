import type { CompiledGraph } from "../build/compile.ts";

/**
 * Reads the graph the build inlined. There is no fetch here and there must never be one:
 * over file:// a request for a sibling JSON file is blocked by CORS, which is why section 2
 * makes inlining non-negotiable.
 */
export function readGraph(document: Document): CompiledGraph {
  const block = document.getElementById("graph");
  if (block === null) throw new Error("no inlined graph found");
  return JSON.parse(block.textContent ?? "") as CompiledGraph;
}

/** Placeholder until milestone 6 brings the lineage view. Proves the graph arrived intact. */
export function render(graph: CompiledGraph, root: HTMLElement): void {
  const { people, unions, relations } = graph.builtFrom;

  root.replaceChildren();

  const heading = document.createElement("h1");
  heading.textContent = "Relationship graph";

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = `${people} people, ${unions} unions, ${relations} relations`;

  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "The viewer arrives in milestone 6. This page proves the graph is inlined and readable offline.";

  root.append(heading, summary, note);
}

const root = document.getElementById("app");
if (root !== null) render(readGraph(document), root);
