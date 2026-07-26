import type { CompiledGraph, CompiledPerson } from "../build/compile.ts";
import { tryParseDate } from "../model/date.ts";
import type { Relation, Union } from "../model/types.ts";

export type Presence = "unborn" | "alive" | "dead";

function yearOf(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const year = Number(iso.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function boundsOf(raw: string | null | undefined): { from: number | null; to: number | null } {
  const parsed = tryParseDate(raw);
  if (parsed === null || parsed.precision === "unknown") return { from: null, to: null };
  return { from: yearOf(parsed.earliest), to: yearOf(parsed.latest) };
}

/**
 * Where someone stands in year Y.
 *
 * An unknown date never hides anyone. Most of a hand-kept graph has partial dates, and a
 * scrubber that quietly emptied the screen because birth years are missing would be read as
 * broken rather than as honest.
 */
export function presenceAt(person: CompiledPerson, year: number): Presence {
  const born = yearOf(person.birthInterval?.earliest);
  if (born !== null && year < born) return "unborn";

  const died = yearOf(person.deathInterval?.latest);
  if (died !== null && year > died) return "dead";

  return "alive";
}

/** Whether a dated tie covers year Y. Same rule: an open or unknown end never excludes. */
function coversYear(from: string | null | undefined, to: string | null | undefined, year: number): boolean {
  const start = boundsOf(from);
  const end = boundsOf(to);

  if (start.from !== null && year < start.from) return false;
  if (end.to !== null && year > end.to) return false;
  return true;
}

export function unionActiveAt(union: Union, year: number): boolean {
  return coversYear(union.from, union.to, year);
}

export function relationActiveAt(relation: Relation, year: number): boolean {
  return coversYear(relation.since, relation.until, year);
}

export interface YearRange {
  min: number;
  max: number;
}

/** The span the scrubber can cover, taken from the data rather than guessed. */
export function yearRangeOf(graph: CompiledGraph, today: number): YearRange | null {
  const years: number[] = [];

  for (const person of graph.people) {
    const born = yearOf(person.birthInterval?.earliest);
    const died = yearOf(person.deathInterval?.latest);
    if (born !== null) years.push(born);
    if (died !== null) years.push(died);
  }

  for (const union of graph.unions) {
    for (const raw of [union.from, union.to]) {
      const bound = boundsOf(raw);
      if (bound.from !== null) years.push(bound.from);
      if (bound.to !== null) years.push(bound.to);
    }
  }

  for (const relation of graph.relations) {
    for (const raw of [relation.since, relation.until]) {
      const bound = boundsOf(raw);
      if (bound.from !== null) years.push(bound.from);
      if (bound.to !== null) years.push(bound.to);
    }
  }

  if (years.length === 0) return null;

  return { min: Math.min(...years), max: Math.max(Math.max(...years), today) };
}
