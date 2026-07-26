import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import type { CompiledGraph, CompiledPerson } from "../build/compile.ts";
import { DEFAULT_DEPTH, MAX_DEPTH, MIN_DEPTH, egoGraph } from "./ego.ts";
import { elementsFor } from "./elements.ts";
import { searchPeople } from "./search.ts";
import { cytoscapeStyle } from "./theme.ts";

cytoscape.use(dagre);

/**
 * Reads the graph the build inlined. There is no fetch here and there must never be one:
 * over file:// a request for a sibling JSON file is blocked by CORS, which is why section 2
 * makes inlining non-negotiable.
 */
export function readGraph(doc: Document): CompiledGraph {
  const block = doc.getElementById("graph");
  if (block === null) throw new Error("no inlined graph found");
  return JSON.parse(block.textContent ?? "") as CompiledGraph;
}

interface State {
  focus: string;
  depth: number;
  /** Previously focused people, most recent last. Section 11.3's breadcrumb trail. */
  trail: string[];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function describe(person: CompiledPerson): string {
  const born = person.birthInterval?.display;
  const died = person.deathInterval?.display;
  if (born === undefined && died === undefined) return "";
  return `${born ?? "?"} – ${died ?? (person.status === "deceased" ? "?" : "")}`.trim();
}

export function start(graph: CompiledGraph, root: HTMLElement): void {
  const byId = new Map(graph.people.map((person) => [person.id, person]));

  if (graph.people.length === 0) {
    root.append(
      el("p", "empty", "No people yet. Add records to people/ and rebuild."),
    );
    return;
  }

  const state: State = {
    focus: graph.people[0]?.id ?? "",
    depth: DEFAULT_DEPTH,
    trail: [],
  };

  // --- chrome -------------------------------------------------------------
  const bar = el("header", "bar");
  const search = el("input", "search");
  search.type = "search";
  search.placeholder = "Search names";
  search.setAttribute("aria-label", "Search people by any name");

  const results = el("ul", "results");
  results.hidden = true;

  const depthLabel = el("label", "depth");
  const depth = el("input");
  depth.type = "range";
  depth.min = String(MIN_DEPTH);
  depth.max = String(MAX_DEPTH);
  depth.value = String(DEFAULT_DEPTH);
  depth.setAttribute("aria-label", "How many steps out to show");
  const depthValue = el("span", "depth-value", String(DEFAULT_DEPTH));
  depthLabel.append("Depth ", depth, depthValue);

  const trail = el("nav", "trail");
  trail.setAttribute("aria-label", "Recently focused");

  const canvas = el("div", "canvas");
  const card = el("aside", "card");
  card.hidden = true;

  bar.append(search, depthLabel);
  root.append(bar, results, trail, canvas, card);

  const cy = cytoscape({
    container: canvas,
    style: cytoscapeStyle(),
    // Layout is applied per render; an unlaid-out graph flashes before dagre runs.
    layout: { name: "preset" },
    wheelSensitivity: 0.2,
  });

  const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function render(): void {
    const ego = egoGraph(graph, state.focus, { depth: state.depth });
    const { nodes, edges } = elementsFor(graph, ego);

    cy.elements().remove();
    cy.add([...nodes, ...edges]);
    cy.layout({
      name: "dagre",
      // Generations run top to bottom; a force layout butchers a family tree.
      rankDir: "TB",
      nodeSep: 28,
      rankSep: 64,
      animate: motionOk,
      animationDuration: 180,
      fit: true,
      padding: 32,
    } as cytoscape.LayoutOptions).run();

    renderTrail();
  }

  function focusOn(id: string): void {
    if (id === state.focus || !byId.has(id)) return;
    state.trail = [...state.trail.filter((seen) => seen !== state.focus), state.focus].slice(-6);
    state.focus = id;
    card.hidden = true;
    render();
  }

  function renderTrail(): void {
    trail.replaceChildren();
    const current = byId.get(state.focus);
    if (current === undefined) return;

    for (const id of state.trail) {
      const person = byId.get(id);
      if (person === undefined) continue;
      const crumb = el("button", "crumb", person.names.display);
      crumb.type = "button";
      crumb.addEventListener("click", () => focusOn(id));
      trail.append(crumb);
    }

    trail.append(el("span", "crumb current", current.names.display));
  }

  // --- interactions -------------------------------------------------------
  search.addEventListener("input", () => {
    const hits = searchPeople(graph.people, search.value);
    results.replaceChildren();
    results.hidden = hits.length === 0;

    for (const hit of hits) {
      const item = el("li");
      const button = el("button", "hit");
      button.type = "button";
      button.append(el("span", "hit-name", hit.display));
      if (hit.matched !== hit.display) button.append(el("span", "hit-via", hit.matched));
      button.addEventListener("click", () => {
        search.value = "";
        results.hidden = true;
        focusOn(hit.id);
      });
      item.append(button);
      results.append(item);
    }
  });

  depth.addEventListener("input", () => {
    state.depth = Number(depth.value);
    depthValue.textContent = depth.value;
    render();
  });

  cy.on("tap", "node", (event) => {
    focusOn(String(event.target.id()));
  });

  cy.on("mouseover", "node", (event) => {
    const person = byId.get(String(event.target.id()));
    if (person === undefined) return;

    card.replaceChildren();
    card.append(el("h2", "card-name", person.names.display));

    const pronouns = person.pronouns?.join(", ");
    if (pronouns !== undefined) card.append(el("p", "card-pronouns", pronouns));

    const dates = describe(person);
    if (dates !== "") card.append(el("p", "card-dates", dates));

    if (person.tags !== undefined && person.tags.length > 0) {
      card.append(el("p", "card-tags", person.tags.join(" · ")));
    }

    const notes = person.notes?.split("\n").slice(0, 2).join(" ");
    if (notes !== undefined && notes !== "") card.append(el("p", "card-notes", notes));

    card.hidden = false;
  });

  cy.on("mouseout", "node", () => {
    card.hidden = true;
  });

  render();
}

const root = document.getElementById("app");
if (root !== null) start(readGraph(document), root);
