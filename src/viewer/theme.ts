import type { StylesheetStyle } from "cytoscape";

/**
 * Section 11.4, from the Graph Viewer Redesign. Cytoscape paints to canvas and cannot read a
 * CSS custom property, so these five repeat what style.css holds for the surrounding panes.
 *
 * One set, not two: the design is a dark design, and section 11.4 rules out inventing a light
 * variant with nothing to check it against.
 */
export const TOKENS = {
  ground: "#0d1219",
  ink: "#e8eef5",
  rule: "rgba(159,180,205,0.22)",
  signal: "#9b8cf0",
  dormant: "#62748a",
};

export function cytoscapeStyle(mode: "lineage" | "social" | "circle" = "lineage"): StylesheetStyle[] {
  const { ink: INK, rule: RULE, signal: SIGNAL, dormant: DORMANT } = TOKENS;

  return [
    {
      selector: "node",
      style: {
        "background-color": "#0d1219",
        "background-opacity": 0.86,
        "border-color": RULE,
        "border-width": 1,
        // The panes carry the design's 18px radius; a person is a plate on the canvas and
        // takes a much tighter corner, so it does not read as another floating card.
        shape: "round-rectangle",
        // Not 'label': that sizing mode is deprecated and leaves most nodes with no
        // computed box, so they never paint. A fixed plate also suits the drafting look.
        width: 158,
        height: 44,
        // Two lines: the name, and underneath what this person is to the focus.
        "text-wrap": "wrap",
        "text-max-width": "134px",
        label: "data(caption)",
        color: INK,
        "font-family": "Schibsted Grotesk, sans-serif",
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
      style: { "border-color": "rgba(159,180,205,0.12)", color: DORMANT },
    },
    {
      selector: "node[?deceased]",
      style: { "border-style": "solid", color: DORMANT, "border-color": "rgba(98,116,138,0.5)" },
    },
    {
      selector: "node[?focus]",
      style: {
        "border-color": SIGNAL,
        "border-width": 1.5,
        "background-color": SIGNAL,
        "background-opacity": 0.12,
        color: "#e8eef5",
        "font-family": "Space Grotesk, sans-serif",
        "font-size": 15,
        width: 170,
        height: 42,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1,
        "line-color": "rgba(159,180,205,0.30)",
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
      style: { "target-arrow-shape": "tee", "target-arrow-color": RULE, "arrow-scale": 0.6 },
    },
    {
      selector: "edge[kind = 'union']",
      style: { "curve-style": "unbundled-bezier", "line-color": "rgba(159,180,205,0.34)", width: 1 },
    },
    {
      // The two rails of the doubled hairline, nudged either side of centre.
      selector: "edge[kind = 'union'][rail = -1]",
      style: { "control-point-distances": [-2], "control-point-weights": [0.5] },
    },
    {
      selector: "edge[kind = 'union'][rail = 1]",
      style: { "control-point-distances": [2], "control-point-weights": [0.5] },
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
      // The ribbon. Section 11.4's one loud moment, so everything else stays quiet.
      // edge.ribbon, not .ribbon: width on a node makes it three pixels wide, and the
      // person collapses to a bar.
      selector: "edge.ribbon",
      style: { "line-color": SIGNAL, width: 3, "target-arrow-color": SIGNAL },
    },
    {
      selector: "node.ribbon",
      style: { "border-color": SIGNAL, "border-width": 2, color: SIGNAL },
    },
    {
      selector: "node.ribbon[kind = 'union']",
      style: { "background-color": SIGNAL },
    },
    {
      // Hops not yet revealed are laid out but not drawn, so the reveal reads as one line
      // arriving rather than several appearing at once.
      selector: "edge.ribbon-pending",
      style: { "line-opacity": 0 },
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
