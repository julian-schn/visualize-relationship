import type { TermTable } from "./terms.ts";

// Genitive ordinals, as used in "Cousine oder Cousin ersten Grades".
const ORDINALS = [
  "ersten",
  "zweiten",
  "dritten",
  "vierten",
  "fünften",
  "sechsten",
  "siebten",
  "achten",
];

// Small counts are written out, as German does everywhere outside tables.
const CARDINALS = [
  "eine",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
  "zehn",
];

function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}.`;
}

function cardinal(n: number): string {
  return CARDINALS[n - 1] ?? String(n);
}

/**
 * The Ur- prefix doubles rather than repeating capitalised: Urgroßelternteil,
 * Ururgroßelternteil, Urururgroßelternteil.
 */
function ur(generations: number): string {
  return generations < 3 ? "" : `Ur${"ur".repeat(generations - 3)}`;
}

/** Großelternteil for 2, Urgroßelternteil for 3, and so on. */
function stacked(generations: number, base: string, compound: string): string {
  if (generations === 1) return base;
  const prefix = ur(generations);
  return prefix === "" ? compound : prefix + compound.toLowerCase();
}

/** Großtante oder Großonkel, Urgroßnichte oder Urgroßneffe. */
function pairStacked(generations: number, feminine: string, masculine: string): string {
  if (generations === 1) return `${feminine} oder ${masculine}`;
  const prefix = `${ur(generations)}${generations >= 3 ? "groß" : "Groß"}`;
  return `${prefix}${feminine.toLowerCase()} oder ${prefix}${masculine.toLowerCase()}`;
}

/**
 * German has neutral singulars down the direct line (Elternteil, Kind, Enkelkind) but none
 * across the collateral one, so Tante/Onkel and Nichte/Neffe appear as pairs. Picking one
 * half would be inventing a gender the record does not carry.
 */
export const de: TermTable = {
  ancestor: (generations) => stacked(generations, "Elternteil", "Großelternteil"),
  descendant: (generations) => stacked(generations, "Kind", "Enkelkind"),

  sibling: (half) => (half ? "Halbgeschwisterteil" : "Geschwisterteil"),

  parentSibling: (generations) => pairStacked(generations, "Tante", "Onkel"),
  siblingDescendant: (generations) => pairStacked(generations, "Nichte", "Neffe"),

  cousin: (degree, removes) => {
    const base = `Cousine oder Cousin ${ordinal(degree)} Grades`;
    if (removes === 0) return base;
    if (removes === 1) return `${base}, eine Generation entfernt`;
    return `${base}, ${cardinal(removes)} Generationen entfernt`;
  },

  // Ex- rather than "ehemalige", which would need a different adjective ending for every
  // term it precedes.
  partner: (ended) => (ended ? "Ex-Partnerin oder Ex-Partner" : "Partnerin oder Partner"),

  step: (relation, ended) => {
    const base =
      relation === "parent"
        ? "Stiefelternteil"
        : relation === "child"
          ? "Stiefkind"
          : "Stiefgeschwisterteil";
    return ended ? `Ex-${base}` : base;
  },

  inLaw: (relation) =>
    relation === "parent"
      ? "Schwiegerelternteil"
      : relation === "child"
        ? "Schwiegerkind"
        : "Schwägerin oder Schwager",

  notByBirth: (term) => `${term} (nicht leiblich)`,

  chosenFamily: "Wahlfamilie",
  unrelated: "nicht verwandt",
  self: "dieselbe Person",
};
