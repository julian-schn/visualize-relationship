import { describe, expect, it } from "vitest";
import {
  BULK_LIMIT,
  buildReport,
  duplicateCandidates,
  formatReport,
  mechanicalFindings,
} from "../src/agent/maintenance.ts";
import { serialise } from "../src/agent/patch.ts";
import type { RawRecords, SourceFile } from "../src/model/load.ts";
import type { Person, Union, Vocab } from "../src/model/types.ts";

const meta = { created: "2026-07-26", updated: "2026-07-26", author: "agent" as const };

const vocab: Vocab = {
  version: 1,
  relationType: [],
  parentKind: [],
  unionType: [],
  unionEnd: [],
  relationStatus: [],
  relationEnd: [],
  context: [],
  tag: [],
};

function person(id: string, extra: Partial<Person> = {}): Person {
  return { id, names: { display: id }, status: "living", parents: [], meta, ...extra };
}

function personFile(record: Person, stem = record.id): SourceFile<Person> {
  return { path: `people/${stem}.json`, stem, record };
}

function unionFile(id: string, partners: string[]): SourceFile<Union> {
  return { path: `unions/${id}.json`, stem: id, record: { id, partners, type: "marriage" } };
}

function records(over: Partial<RawRecords> = {}): RawRecords {
  return { people: [], unions: [], relations: [], notes: [], vocab, ...over };
}

/** Canonical text for every file, so nothing looks like formatting drift by accident. */
function tidy(all: RawRecords): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of all.people) sources.set(file.path, serialise("person", file.record as never));
  for (const file of all.unions) sources.set(file.path, serialise("union", file.record as never));
  for (const file of all.relations) {
    sources.set(file.path, serialise("relation", file.record as never));
  }
  return sources;
}

describe("mechanical findings", () => {
  it("reports nothing about tidy records", () => {
    const all = records({ people: [personFile(person("a"))] });
    expect(mechanicalFindings(all, tidy(all))).toEqual([]);
  });

  it("spots a filename that drifted from its id", () => {
    const all = records({ people: [personFile(person("agnes-vogt"), "agnes")] });
    const found = mechanicalFindings(all, tidy(all));

    expect(found[0]).toMatchObject({ rule: "filename-drift", severity: "fix" });
    expect(found[0]?.message).toContain("agnes-vogt.json");
  });

  it("spots formatting drift", () => {
    const all = records({ people: [personFile(person("a"))] });
    const sources = new Map([["people/a.json", '{"id":"a"}']]);

    expect(mechanicalFindings(all, sources)[0]).toMatchObject({
      rule: "formatting",
      severity: "fix",
    });
  });

  it("spots an inline note that outgrew its field", () => {
    const long = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
    const all = records({ people: [personFile(person("a", { notes: long }))] });

    const found = mechanicalFindings(all, tidy(all)).find((f) => f.rule === "oversized-note");
    expect(found?.message).toContain("notes/a.md");
  });

  it("leaves a short note alone", () => {
    const all = records({ people: [personFile(person("a", { notes: "one line" }))] });
    expect(mechanicalFindings(all, tidy(all)).some((f) => f.rule === "oversized-note")).toBe(false);
  });
});

describe("duplicate detection", () => {
  it("does not flag two people who merely share a name", () => {
    const all = records({
      people: [
        personFile(person("karl-vogt", { names: { display: "Karl Vogt" } })),
        personFile(person("karl-vogt-2", { names: { display: "Karl Vogt" } })),
      ],
    });

    // Families reuse names; a shared name alone is not evidence.
    expect(duplicateCandidates(all)).toEqual([]);
  });

  it("flags a shared name plus a shared partner", () => {
    const all = records({
      people: [
        personFile(person("karl-vogt", { names: { display: "Karl Vogt" } })),
        personFile(person("karl-v", { names: { display: "Karl Vogt" } })),
        personFile(person("marie")),
      ],
      unions: [unionFile("u-0001", ["karl-vogt", "marie"]), unionFile("u-0002", ["karl-v", "marie"])],
    });

    const [candidate] = duplicateCandidates(all);
    expect(candidate?.score).toBeGreaterThanOrEqual(4);
    expect(candidate?.evidence.join(" ")).toContain("share a partner");
  });

  it("flags a shared name plus shared parents", () => {
    const all = records({
      people: [
        personFile(person("gran")),
        personFile(person("a", { names: { display: "Karl" }, parents: [{ id: "gran", kind: "birth" }] })),
        personFile(person("b", { names: { display: "Karl" }, parents: [{ id: "gran", kind: "birth" }] })),
      ],
    });

    expect(duplicateCandidates(all)[0]?.evidence.join(" ")).toContain("share a parent");
  });

  it("reports evidence rather than a verdict", () => {
    const all = records({
      people: [
        personFile(person("a", { names: { display: "Karl" }, birth: { date: "1930" } })),
        personFile(person("b", { names: { display: "Karl" }, birth: { date: "1930" } })),
        personFile(person("m")),
      ],
      unions: [unionFile("u-0001", ["a", "m"]), unionFile("u-0002", ["b", "m"])],
    });

    const [candidate] = duplicateCandidates(all);
    expect(candidate?.evidence.length).toBeGreaterThan(1);
    // Nothing in a finding says to merge; that decision is the human's.
    expect(JSON.stringify(candidate)).not.toContain("merge");
  });

  it("ignores tombstones, which are already merged", () => {
    const all = records({
      people: [
        personFile(person("karl-vogt", { names: { display: "Karl" } })),
        personFile(
          person("karl-v", {
            names: { display: "Karl" },
            status: "merged",
            mergedInto: "karl-vogt",
          }),
        ),
        personFile(person("m")),
      ],
      unions: [unionFile("u-0001", ["karl-vogt", "m"]), unionFile("u-0002", ["karl-v", "m"])],
    });

    expect(duplicateCandidates(all)).toEqual([]);
  });
});

describe("the report", () => {
  it("has a findings array, which the weekly workflow reads", () => {
    const all = records({ people: [personFile(person("a"))] });
    expect(buildReport(all, tidy(all))).toEqual({ findings: [] });
  });

  it("asks for a human once a run would rewrite more than the bulk limit", () => {
    const many = Array.from({ length: BULK_LIMIT + 2 }, (_, i) => personFile(person(`p${i}`), `wrong${i}`));
    const all = records({ people: many });

    const bulk = buildReport(all, tidy(all)).findings.find((f) => f.rule === "bulk-change");
    expect(bulk).toMatchObject({ severity: "propose" });
  });

  it("does not ask for a human on a small run", () => {
    const all = records({ people: [personFile(person("a"), "wrong")] });
    expect(buildReport(all, tidy(all)).findings.some((f) => f.rule === "bulk-change")).toBe(false);
  });

  it("says so plainly when there is nothing to report", () => {
    expect(formatReport({ findings: [] })).toBe("maintenance: nothing to report\n");
  });

  it("separates what it can fix from what it cannot", () => {
    const text = formatReport({
      findings: [
        { rule: "formatting", severity: "fix", where: "people/a.json", message: "x" },
        { rule: "possible-duplicate", severity: "propose", where: "people/b.json", message: "y" },
      ],
    });

    expect(text).toContain("1 auto-fixable, 1 needing a human");
  });
});
