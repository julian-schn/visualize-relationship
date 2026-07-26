import { fold } from "../model/id.ts";
import type { RawRecords } from "../model/load.ts";
import type { Person } from "../model/types.ts";
import { isSubsequence, nameFormsOf } from "../viewer/search.ts";

export type MatchedIn = "id" | "name" | "notes";

export interface FindHit {
  id: string;
  display: string;
  /** Which text matched, so a hit through a nickname or a note is explicable. */
  matched: string;
  where: MatchedIn;
}

/** A note is long; show the words around the match rather than the whole thing. */
function excerpt(text: string, query: string, radius = 40): string {
  const at = fold(text).indexOf(query);
  if (at === -1) return "";

  const from = Math.max(0, at - radius);
  const to = Math.min(text.length, at + query.length + radius);

  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
}

/**
 * Everyone who might already be the person you are about to create. Section 13.1 calls
 * duplicates the number one failure mode of a tool like this, and they are very hard to
 * unpick afterwards, so this searches ids, every name form, and the notes.
 */
export function findPeople(
  people: readonly Person[],
  notes: ReadonlyMap<string, string>,
  rawQuery: string,
): FindHit[] {
  const query = fold(rawQuery.trim());
  if (query === "") return [];

  const hits: FindHit[] = [];

  for (const person of people) {
    const display = person.names.display;

    if (fold(person.id).includes(query)) {
      hits.push({ id: person.id, display, matched: person.id, where: "id" });
      continue;
    }

    // Loose on names: a duplicate missed here is very hard to unpick later, and a spurious
    // hit costs a glance.
    const name = nameFormsOf(person).find((form) => {
      const folded = fold(form);
      return folded.includes(query) || isSubsequence(query, folded);
    });
    if (name !== undefined) {
      hits.push({ id: person.id, display, matched: name, where: "name" });
      continue;
    }

    // Sidecar wins over the inline field, the same way the loader merges them.
    const note = notes.get(person.id) ?? person.notes;
    if (note !== undefined && fold(note).includes(query)) {
      hits.push({ id: person.id, display, matched: excerpt(note, query), where: "notes" });
    }
  }

  return hits.sort((a, b) => a.display.localeCompare(b.display));
}

export function findIn(records: RawRecords, query: string): FindHit[] {
  return findPeople(
    records.people.map((file) => file.record),
    new Map(records.notes.map((file) => [file.stem, file.record])),
    query,
  );
}

export function formatHits(hits: readonly FindHit[], query: string): string {
  if (hits.length === 0) return `find: nothing matches ${JSON.stringify(query)}\n`;

  const lines = hits.map(
    (hit) => `  ${hit.id.padEnd(24)} ${hit.display}${hit.where === "id" ? "" : `  (${hit.where}: ${hit.matched})`}`,
  );

  return `${hits.length} match(es) for ${JSON.stringify(query)}\n${lines.join("\n")}\n`;
}
