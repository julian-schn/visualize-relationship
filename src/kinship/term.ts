import type { Kinship } from "./derive.ts";
import { de } from "./terms.de.ts";
import { en } from "./terms.en.ts";
import type { Lang, TermTable } from "./terms.ts";

export const TABLES: Record<Lang, TermTable> = { en, de };

export interface TermOptions {
  lang?: Lang;
  /** Show that a tie reaches through an adoptive, foster or guardian edge. */
  distinguishNotByBirth?: boolean;
}

/**
 * The word for a blood or adoptive tie. Section 8's pairs generalise: one end at the common
 * ancestor is a direct line, one generation down on either side is a sibling line, and
 * everything else is a cousin with a degree and a remove.
 */
export function termFor(kinship: Kinship, options: TermOptions = {}): string {
  const table = TABLES[options.lang ?? "en"];
  const { up, down } = kinship;

  let term: string;

  if (up === 0 && down === 0) {
    term = table.self;
  } else if (down === 0) {
    term = table.ancestor(up);
  } else if (up === 0) {
    term = table.descendant(down);
  } else if (up === 1 && down === 1) {
    term = table.sibling(!kinship.full);
  } else if (down === 1) {
    // b sits one generation below the shared ancestor, a sits further down.
    term = table.parentSibling(up - 1);
  } else if (up === 1) {
    term = table.siblingDescendant(down - 1);
  } else {
    term = table.cousin(Math.min(up, down) - 1, Math.abs(up - down));
  }

  if (options.distinguishNotByBirth === true && !kinship.byBirth) {
    return table.notByBirth(term);
  }

  return term;
}
