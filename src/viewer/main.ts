import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import fcose from "cytoscape-fcose";
import type { CompiledGraph, CompiledPerson } from "../build/compile.ts";
import { DEFAULT_DEPTH, MAX_DEPTH, MIN_DEPTH, egoGraph } from "./ego.ts";
import { elementsFor, type Mode } from "./elements.ts";
import {
  filterOptionsFrom,
  labelFor,
  noFilters,
  type FilterOptions,
  type Filters,
} from "./filters.ts";
import { searchPeople } from "./search.ts";
import { cytoscapeStyle, idealEdgeLength } from "./theme.ts";

cytoscape.use(dagre);
cytoscape.use(fcose);

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
  mode: Mode;
  filters: Filters;
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
    mode: "lineage",
    filters: noFilters(),
    trail: [],
  };

  const options = filterOptionsFrom(graph);

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

  const modes = el("div", "modes");
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "Layout");
  const lineageButton = el("button", "mode current", "Lineage");
  const socialButton = el("button", "mode", "Social");
  lineageButton.type = "button";
  socialButton.type = "button";
  modes.append(lineageButton, socialButton);

  const filterPanel = el("details", "filters");
  const filterSummary = el("summary", undefined, "Filters");
  const filterBody = el("div", "filter-body");
  filterPanel.append(filterSummary, filterBody);

  const trail = el("nav", "trail");
  trail.setAttribute("aria-label", "Recently focused");

  const canvas = el("div", "canvas");
  const card = el("aside", "card");
  card.hidden = true;

  bar.append(search, modes, depthLabel, filterPanel);
  root.append(bar, results, trail, canvas, card);

  const cy = cytoscape({
    container: canvas,
    style: cytoscapeStyle(),
    // Layout is applied per render; an unlaid-out graph flashes before dagre runs.
    layout: { name: "preset" },
    maxZoom: 1.6,
  });

  const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function layoutFor(mode: Mode): cytoscape.LayoutOptions {
    if (mode === "lineage") {
      return {
        name: "dagre",
        // Generations run top to bottom; a force layout butchers a family tree.
        rankDir: "TB",
        nodeSep: 28,
        rankSep: 42,
        // Scaffolding spans one rank, direct parentage two, so a generation is the same
        // height whether or not the parents are recorded as a couple.
        minLen: (edge: { data(key: string): unknown }) => {
          const span = edge.data("span");
          return typeof span === "number" && span > 0 ? span : 1;
        },
        animate: motionOk,
        animationDuration: 180,
        fit: true,
        padding: 32,
      } as unknown as cytoscape.LayoutOptions;
    }

    return {
      name: "fcose",
      quality: "proof",
      // Elements are rebuilt each render, so there are no previous positions to refine from.
      // With randomize off, fcose starts every node at the same spot and cannot separate them.
      randomize: true,
      // Closeness and shared context shorten edges, which is what makes clusters appear.
      idealEdgeLength,
      nodeSeparation: 140,
      nodeRepulsion: 12000,
      animate: motionOk,
      animationDuration: 240,
      fit: true,
      padding: 32,
    } as unknown as cytoscape.LayoutOptions;
  }

  function render(): void {
    const kinds = state.mode === "social" ? (["parentage", "union", "relation"] as const) : undefined;
    const ego = egoGraph(graph, state.focus, {
      depth: state.depth,
      ...(kinds === undefined ? {} : { kinds: [...kinds] }),
    });

    const { nodes, edges } = elementsFor(graph, ego, {
      mode: state.mode,
      filters: state.filters,
    });

    cy.elements().remove();
    cy.add([...nodes, ...edges]);
    canvas.dataset["nodes"] = String(nodes.length);
    canvas.dataset["edges"] = String(edges.length);
    cy.layout(layoutFor(state.mode)).run();

    renderTrail();
  }

  function setMode(mode: Mode): void {
    if (state.mode === mode) return;
    state.mode = mode;
    cy.style(cytoscapeStyle(mode));
    lineageButton.classList.toggle("current", mode === "lineage");
    socialButton.classList.toggle("current", mode === "social");
    // The focus person is deliberately untouched: section 11.2 keeps it across the switch.
    render();
  }

  function buildFilters(): void {
    const groups: [string, keyof FilterOptions, keyof Filters, keyof CompiledGraph["vocab"]][] = [
      ["Relation", "relationTypes", "relationTypes", "relationType"],
      ["Status", "statuses", "statuses", "relationStatus"],
      ["Context", "contexts", "contexts", "context"],
      ["Tag", "tags", "tags", "tag"],
    ];

    for (const [title, source, key, collection] of groups) {
      const values = options[source];
      if (values.length === 0) continue;

      const group = el("fieldset", "filter-group");
      group.append(el("legend", undefined, title));

      for (const value of values) {
        const row = el("label", "filter-row");
        const box = el("input");
        box.type = "checkbox";
        box.checked = true;
        box.addEventListener("change", () => {
          const ticked = [...group.querySelectorAll<HTMLInputElement>("input")]
            .filter((input) => input.checked)
            .map((input) => input.value);

          // All ticked reads as "not filtering", which keeps the view unchanged by default.
          state.filters = {
            ...state.filters,
            [key]: ticked.length === values.length ? null : new Set(ticked),
          };
          render();
        });
        box.value = value;

        row.append(box, el("span", undefined, labelFor(graph, collection, value)));
        group.append(row);
      }

      filterBody.append(group);
    }

    if (options.tags.length + options.contexts.length + options.relationTypes.length === 0) {
      filterPanel.hidden = true;
    }
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

  lineageButton.addEventListener("click", () => setMode("lineage"));
  socialButton.addEventListener("click", () => setMode("social"));

  buildFilters();
  render();
}

const root = document.getElementById("app");
if (root !== null) start(readGraph(document), root);
