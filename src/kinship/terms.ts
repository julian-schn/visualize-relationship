export type Lang = "en" | "de";

export type StepRelation = "parent" | "child" | "sibling";
export type InLawRelation = "parent" | "child" | "sibling";

/**
 * `late` exists because a union ended by death is not a union someone left. Collapsing it
 * into `former` would label a widowed person an ex-partner.
 */
export type PartnerState = "current" | "former" | "late";

/**
 * Every phrase the engine can produce, in one language.
 *
 * Terms carry no gender. A record's only gender is `pronouns`, which is free text meant to
 * be displayed rather than parsed, so there is nothing to derive a gendered term from.
 * Where a language has no neutral singular, the table uses the paired form rather than
 * guessing which half applies.
 */
export interface TermTable {
  /** 1 parent, 2 grandparent, 3 great-grandparent, and so on. */
  ancestor(generations: number): string;
  /** 1 child, 2 grandchild, 3 great-grandchild, and so on. */
  descendant(generations: number): string;
  sibling(half: boolean): string;
  /** 1 parent's sibling, 2 grandparent's sibling. */
  parentSibling(generations: number): string;
  /** 1 sibling's child, 2 sibling's grandchild. */
  siblingDescendant(generations: number): string;
  /** degree 1 is a first cousin; removed 0 is same-generation. */
  cousin(degree: number, removed: number): string;
  partner(state: PartnerState): string;
  /** `ended` excludes unions ended by death: a step-parent stays one when your parent dies. */
  step(relation: StepRelation, ended: boolean): string;
  inLaw(relation: InLawRelation): string;
  /** Marks a tie that reaches through an adoptive, foster or guardian edge. */
  notByBirth(term: string): string;
  chosenFamily: string;
  unrelated: string;
  self: string;
}
