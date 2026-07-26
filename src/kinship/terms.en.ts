import type { TermTable } from "./terms.ts";

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
];

const REMOVES = ["", "once removed", "twice removed", "three times removed"];

function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

function removed(n: number): string {
  return REMOVES[n] ?? `${n} times removed`;
}

/** "great-great-grandparent" for 4 generations up. */
function greats(generations: number, base: string, grand: string): string {
  if (generations === 1) return base;
  if (generations === 2) return grand;
  return `${"great-".repeat(generations - 2)}${grand}`;
}

export const en: TermTable = {
  ancestor: (generations) => greats(generations, "parent", "grandparent"),
  descendant: (generations) => greats(generations, "child", "grandchild"),

  sibling: (half) => (half ? "half-sibling" : "sibling"),

  // "parent's sibling" rather than "aunt or uncle": English has no neutral single word, and
  // the possessive form stays readable as the generations stack up.
  parentSibling: (generations) =>
    generations === 1
      ? "parent's sibling"
      : `${greats(generations, "parent", "grandparent")}'s sibling`,

  siblingDescendant: (generations) =>
    generations === 1 ? "sibling's child" : `sibling's ${greats(generations, "child", "grandchild")}`,

  cousin: (degree, removes) => {
    const base = `${ordinal(degree)} cousin`;
    return removes === 0 ? base : `${base} ${removed(removes)}`;
  },

  partner: (ended) => (ended ? "ex-partner" : "partner"),

  step: (relation, ended) => `${ended ? "former " : ""}step-${relation}`,

  inLaw: (relation) => `${relation}-in-law`,

  notByBirth: (term) => `${term} (not by birth)`,

  chosenFamily: "chosen family",
  unrelated: "not related",
  self: "the same person",
};
