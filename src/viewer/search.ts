import type { CompiledPerson } from "../build/compile.ts";
import { fold } from "../model/id.ts";

export interface SearchHit {
  id: string;
  display: string;
  /** The name form that matched, so the list can show why a nickname surfaced someone. */
  matched: string;
  score: number;
}

/** Every string someone might type to mean this person. Section 11.3 wants all name forms. */
export function nameFormsOf(person: CompiledPerson): string[] {
  const { names } = person;

  return [
    names.display,
    names.given,
    names.family,
    ...(names.nicknames ?? []),
    ...(names.aka ?? []),
    ...(names.former ?? []).map((former) => former.display),
  ].filter((value): value is string => value !== undefined && value !== "");
}

/** Every character of the query in order, not necessarily adjacent. */
function isSubsequence(query: string, target: string): boolean {
  let index = 0;
  for (const character of target) {
    if (character === query[index]) index += 1;
    if (index === query.length) return true;
  }
  return query.length === 0;
}

/**
 * Ranked rather than fuzzy-for-its-own-sake. An exact name beats a prefix, a prefix beats a
 * word start, and a scattered subsequence comes last, so typing "ag" surfaces Agnes before
 * anyone who merely contains those letters.
 */
function scoreOf(query: string, form: string): number {
  const target = fold(form);

  if (target === query) return 100;
  if (target.startsWith(query)) return 80;
  if (target.split(/[\s-]+/).some((word) => word.startsWith(query))) return 65;
  if (target.includes(query)) return 45;
  if (isSubsequence(query, target)) return 20;
  return 0;
}

export function searchPeople(
  people: readonly CompiledPerson[],
  rawQuery: string,
  limit = 12,
): SearchHit[] {
  const query = fold(rawQuery.trim());
  if (query === "") return [];

  const hits: SearchHit[] = [];

  for (const person of people) {
    let best: SearchHit | null = null;

    for (const form of nameFormsOf(person)) {
      const score = scoreOf(query, form);
      if (score === 0 || (best !== null && score <= best.score)) continue;
      best = { id: person.id, display: person.names.display, matched: form, score };
    }

    if (best !== null) hits.push(best);
  }

  // Score first, then alphabetical, so the list never reorders between identical queries.
  hits.sort((a, b) => b.score - a.score || a.display.localeCompare(b.display));

  return hits.slice(0, limit);
}
