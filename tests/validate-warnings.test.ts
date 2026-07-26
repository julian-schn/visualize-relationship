import { describe, expect, it } from "vitest";
import type { SourceFile } from "../src/model/load.ts";
import type { Person, Relation, Union, Vocab } from "../src/model/types.ts";
import { checkWarnings, type WarningContext } from "../src/validate/warnings.ts";

const TODAY = "2026-07-26";

const vocab: Vocab = {
  version: 1,
  relationType: [{ key: "friend", label: "Friend", symmetric: true }],
  parentKind: [{ key: "birth", label: "Birth" }],
  unionType: [{ key: "marriage", label: "Marriage" }],
  unionEnd: [{ key: "divorce", label: "Divorce" }],
  relationStatus: [{ key: "active", label: "Active" }],
  context: [],
  tag: [],
};

const meta = { created: "2026-07-26", updated: "2026-07-26", author: "agent" as const };

function personFile(id: string, extra: Partial<Person> = {}): SourceFile<Person> {
  return {
    path: `people/${id}.json`,
    stem: id,
    record: { id, names: { display: id }, status: "living", meta, ...extra },
  };
}

function unionFile(id: string, extra: Partial<Union> = {}): SourceFile<Union> {
  return { path: `unions/${id}.json`, stem: id, record: { id, partners: [], type: "marriage", ...extra } };
}

function relationFile(id: string, extra: Partial<Relation> = {}): SourceFile<Relation> {
  return {
    path: `relations/${id}.json`,
    stem: id,
    record: { id, type: "friend", from: "a", to: "b", symmetric: true, status: "active", ...extra },
  };
}

function warn(context: Partial<WarningContext>): string[] {
  return checkWarnings({
    people: [],
    unions: [],
    relations: [],
    notes: [],
    vocab,
    today: TODAY,
    resolvedProposals: new Set(),
    ...context,
  }).map((finding) => finding.rule);
}

/** A pair joined by a relation, so connectivity warnings stay out of the way. */
function connectedPair(a: Partial<Person> = {}, b: Partial<Person> = {}) {
  return {
    people: [personFile("a", a), personFile("b", b)],
    relations: [relationFile("r-0001", { from: "a", to: "b" })],
  };
}

describe("parent ages", () => {
  it("warns when a child is born before their parent", () => {
    expect(
      warn({
        people: [
          personFile("parent", { birth: { date: "1990" } }),
          personFile("child", {
            birth: { date: "1960" },
            parents: [{ id: "parent", kind: "birth" }],
          }),
        ],
      }),
    ).toContain("implausible-parent-age");
  });

  it("warns when a child is born less than twelve years after their parent", () => {
    expect(
      warn({
        people: [
          personFile("parent", { birth: { date: "1990" } }),
          personFile("child", {
            birth: { date: "1999" },
            parents: [{ id: "parent", kind: "birth" }],
          }),
        ],
      }),
    ).toContain("implausible-parent-age");
  });

  it("accepts an ordinary generation gap", () => {
    expect(
      warn({
        people: [
          personFile("parent", { birth: { date: "1962-03-04" } }),
          personFile("child", {
            birth: { date: "1990-05-01" },
            parents: [{ id: "parent", kind: "birth" }],
          }),
        ],
      }),
    ).not.toContain("implausible-parent-age");
  });

  it("says nothing when either birth is unknown", () => {
    expect(
      warn({
        people: [
          personFile("parent"),
          personFile("child", { parents: [{ id: "parent", kind: "birth" }] }),
        ],
      }),
    ).not.toContain("implausible-parent-age");
  });

  it("uses the widest reading of an approximate date before warning", () => {
    // parent c. 1950 has latest 1951-12-31; a child born 1964 is 12 years later exactly.
    expect(
      warn({
        people: [
          personFile("parent", { birth: { date: "1950~" } }),
          personFile("child", {
            birth: { date: "1964" },
            parents: [{ id: "parent", kind: "birth" }],
          }),
        ],
      }),
    ).not.toContain("implausible-parent-age");
  });
});

describe("ordering", () => {
  it("warns when death precedes birth", () => {
    expect(
      warn(connectedPair({ birth: { date: "1962" }, death: { date: "1940" } })),
    ).toContain("death-before-birth");
  });

  it("warns when a union ends before it starts", () => {
    expect(
      warn({
        ...connectedPair(),
        unions: [unionFile("u-0001", { partners: ["a", "b"], from: "2004", to: "1988" })],
      }),
    ).toContain("union-ends-before-it-starts");
  });

  it("warns when a relation ends before it starts", () => {
    expect(
      warn({
        ...connectedPair(),
        relations: [relationFile("r-0001", { from: "a", to: "b", since: "2019", until: "2010" })],
      }),
    ).toContain("relation-ends-before-it-starts");
  });

  it("accepts an ongoing union with no end", () => {
    expect(
      warn({
        ...connectedPair(),
        unions: [unionFile("u-0001", { partners: ["a", "b"], from: "1988", to: null })],
      }),
    ).not.toContain("union-ends-before-it-starts");
  });
});

describe("ties dated after a death", () => {
  it("warns about a union starting after a partner died", () => {
    expect(
      warn({
        ...connectedPair({ death: { date: "1990" } }),
        unions: [unionFile("u-0001", { partners: ["a", "b"], from: "2004" })],
      }),
    ).toContain("posthumous-tie");
  });

  it("warns about a relation starting after either end died", () => {
    expect(
      warn({
        people: [personFile("a"), personFile("b", { death: { date: "1990" } })],
        relations: [relationFile("r-0001", { from: "a", to: "b", since: "2004" })],
      }),
    ).toContain("posthumous-tie");
  });

  it("accepts a union that started while both were alive", () => {
    expect(
      warn({
        ...connectedPair({ death: { date: "2010" } }),
        unions: [unionFile("u-0001", { partners: ["a", "b"], from: "1988" })],
      }),
    ).not.toContain("posthumous-tie");
  });
});

describe("implausible age", () => {
  it("warns about someone living and born over 110 years ago", () => {
    expect(warn(connectedPair({ birth: { date: "1900" } }))).toContain("implausibly-old");
  });

  it("says nothing about someone deceased and born long ago", () => {
    expect(
      warn(connectedPair({ status: "deceased", birth: { date: "1900" }, death: { date: "1975" } })),
    ).not.toContain("implausibly-old");
  });

  it("says nothing about someone plausibly alive", () => {
    expect(warn(connectedPair({ birth: { date: "1990" } }))).not.toContain("implausibly-old");
  });
});

describe("connectivity", () => {
  it("warns about a person with no ties at all", () => {
    expect(warn({ people: [personFile("lonely")] })).toContain("island");
  });

  it("does not call someone an island for a parentage tie alone", () => {
    expect(
      warn({
        people: [personFile("parent"), personFile("child", { parents: [{ id: "parent", kind: "birth" }] })],
      }),
    ).not.toContain("island");
  });

  it("counts a union as a tie", () => {
    expect(
      warn({
        people: [personFile("a"), personFile("b")],
        unions: [unionFile("u-0001", { partners: ["a", "b"] })],
      }),
    ).not.toContain("island");
  });

  it("warns when the graph is in more than one piece", () => {
    expect(
      warn({
        people: [personFile("a"), personFile("b"), personFile("c"), personFile("d")],
        relations: [
          relationFile("r-0001", { from: "a", to: "b" }),
          relationFile("r-0002", { from: "c", to: "d" }),
        ],
      }),
    ).toContain("disconnected-graph");
  });

  it("says nothing when everyone is connected", () => {
    expect(warn(connectedPair())).not.toContain("disconnected-graph");
  });

  it("ignores tombstones when counting pieces", () => {
    expect(
      warn({
        people: [
          personFile("a"),
          personFile("b"),
          personFile("ghost", { status: "merged", mergedInto: "a" }),
        ],
        relations: [relationFile("r-0001", { from: "a", to: "b" })],
      }),
    ).not.toContain("disconnected-graph");
  });
});

describe("provisional vocabulary", () => {
  const provisional = (added: string, resolved: string[] = []): string[] =>
    warn({
      vocab: {
        ...vocab,
        context: [{ key: "climbing", label: "Climbing", provisional: true, added }],
      },
      resolvedProposals: new Set(resolved),
    });

  it("warns once a provisional entry is over thirty days old", () => {
    expect(provisional("2026-01-01")).toContain("stale-provisional-vocabulary");
  });

  it("stays quiet inside the grace period", () => {
    expect(provisional("2026-07-20")).not.toContain("stale-provisional-vocabulary");
  });

  it("stays quiet once a proposal has been resolved", () => {
    expect(provisional("2026-01-01", ["climbing"])).not.toContain("stale-provisional-vocabulary");
  });

  it("says nothing about a settled entry", () => {
    expect(warn({})).not.toContain("stale-provisional-vocabulary");
  });
});

describe("notes", () => {
  it("warns about a sidecar belonging to nobody", () => {
    expect(
      warn({
        people: [personFile("agnes-vogt")],
        notes: [{ path: "notes/ghost.md", stem: "ghost", record: "orphaned" }],
      }),
    ).toContain("orphan-note");
  });

  it("accepts a sidecar with a matching person", () => {
    expect(
      warn({
        people: [personFile("agnes-vogt")],
        notes: [{ path: "notes/agnes-vogt.md", stem: "agnes-vogt", record: "fine" }],
      }),
    ).not.toContain("orphan-note");
  });
});

describe("warnings never block", () => {
  it("marks every finding as a warning", () => {
    const findings = checkWarnings({
      people: [personFile("lonely", { birth: { date: "1900" } })],
      unions: [],
      relations: [],
      notes: [{ path: "notes/ghost.md", stem: "ghost", record: "" }],
      vocab,
      today: TODAY,
      resolvedProposals: new Set(),
    });

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.level === "warning")).toBe(true);
  });
});
