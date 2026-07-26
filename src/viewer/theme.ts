import type { StylesheetStyle } from "cytoscape";

/**
 * Section 11.4. Line work encodes meaning rather than decorating it, so the reference is
 * drafting and field notation: no gradients, no shadows, no rounded card chrome.
 *
 * Cytoscape draws to canvas and cannot read CSS custom properties, so the tokens are
 * repeated here. style.css holds the same five values for the surrounding page.
 */
export const INK = "#1e211c";
export const RULE = "#a8ac9c";
export const SIGNAL = "#7a2e3a";
export const DORMANT = "#6e7166";
export const GROUND = "#e3e5dc";

export function cytoscapeStyle(mode: "lineage" | "social" = "lineage"): StylesheetStyle[] {
  return [
    {
      selector: "node",
      style: {
        "background-color": GROUND,
        "border-color": INK,
        "border-width": 1,
        shape: "round-rectangle",
        // Not 'label': that sizing mode is deprecated and leaves most nodes with no
        // computed box, so they never paint. A fixed plate also suits the drafting look.
        width: 140,
        height: 26,
        "text-wrap": "ellipsis",
        "text-max-width": "126px",
        label: "data(label)",
        color: INK,
        "font-family": "sans-serif",
        "font-size": 12,
        "text-valign": "center",
        "text-halign": "center",
      },
    },
    {
      // The marriage point: small, inked, unlabelled. Family charts have drawn one for a
      // century, and dagre needs a node here anyway to keep partners level.
      selector: "node[kind = 'union']",
      style: {
        width: 7,
        height: 7,
        shape: "ellipse",
        "background-color": INK,
        "border-width": 0,
        label: "",
        events: "no",
      },
    },
    {
      // Everything outside the first ring fades rather than competing with the focus.
      selector: "node[distance > 1]",
      style: { "border-color": RULE, color: DORMANT },
    },
    {
      selector: "node[?deceased]",
      style: { "border-style": "solid", color: DORMANT, "border-color": DORMANT },
    },
    {
      selector: "node[?focus]",
      style: {
        "border-color": SIGNAL,
        "border-width": 2,
        color: SIGNAL,
        "font-family": "serif",
        "font-size": 14,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1,
        "line-color": INK,
        "curve-style": mode === "lineage" ? "taxi" : "bezier",
        "taxi-direction": "downward",
        "target-arrow-shape": "none",
      },
    },
    {
      selector: "edge[kind = 'parentage'][?uncertain]",
      style: { "line-style": "dashed", "line-color": RULE },
    },
    {
      // The notch glyph at the child end, marking parentage that is not by birth.
      selector: "edge[kind = 'parentage'][?notByBirth]",
      style: { "target-arrow-shape": "tee", "target-arrow-color": INK, "arrow-scale": 0.6 },
    },
    {
      selector: "edge[kind = 'union']",
      style: { "curve-style": mode === "lineage" ? "straight" : "bezier", "line-color": INK, width: 1 },
    },
    {
      selector: "edge[kind = 'union'][?ended]",
      style: { "line-style": "dotted", "line-color": DORMANT },
    },
    {
      // Social ties are a single line whose thickness is closeness, per section 11.4.
      selector: "edge[kind = 'relation']",
      style: {
        "curve-style": "bezier",
        "line-color": RULE,
        width: "mapData(closeness, 0, 5, 0.5, 3)",
      },
    },
    {
      selector: "edge[kind = 'relation'][^closeness]",
      style: { width: 1 },
    },
    {
      selector: "edge[kind = 'relation'][?ended]",
      style: { "line-style": "dotted", "line-color": DORMANT },
    },
  ] as StylesheetStyle[];
}

/**
 * Closeness and shared context both shorten an edge, so people who are close, or who know
 * each other from several places, settle nearer together. fCoSE has no cluster parameter;
 * pulling harder on the edges that mean more is how the grouping emerges.
 *
 * The floor is well above the widest node label. Shorter than a node is wide and the layout
 * cannot satisfy it: boxes pile on top of each other and the fit zooms into the heap.
 */
const MIN_EDGE = 190;

export function idealEdgeLength(edge: { data(key: string): unknown }): number {
  const closeness = edge.data("closeness");
  const contexts = edge.data("contexts");

  const base = edge.data("kind") === "relation" ? 330 : 260;
  const pull = (typeof closeness === "number" ? closeness : 2) * 16;
  const shared = (typeof contexts === "number" ? contexts : 0) * 14;

  return Math.max(MIN_EDGE, base - pull - shared);
}
