import { describe, expect, it } from "vitest";
import { compile, type CompiledGraph } from "../src/build/compile.ts";
import { buildGraph } from "../src/model/graph.ts";
import type { ParentEdge, Person, Relation, Union, Vocab } from "../src/model/types.ts";
import { egoGraph } from "../src/viewer/ego.ts";
import { elementsFor } from "../src/viewer/elements.ts";
import {
  presenceAt,
  relationActiveAt,
  unionActiveAt,
  yearRangeOf,
} from "../src/viewer/timeline.ts";

const vocab: Vocab = {
  version: 1,
  relationType: [{ key: "friend", label: "Friend", symmetric: true }],
  parentKind: [],
  unionType: [],
  unionEnd: [],
  relationStatus: [{ key: "active", label: "Active" }],
  relationEnd: [],
  context: [],
  tag: [],
};

const meta = { created: "2026-07-26", updated: "2026-07-26", author: "agent" as const };
const birth = (id: string): ParentEdge => ({ id, kind: "birth" });

function person(id: string, extra: Partial<Person> = {}): Person {
  return { id, names: { display: id }, status: "living", parents: [], meta, ...extra };
}

function compiled(people: Person[], unions: Union[] = [], relations: Relation[] = []) {
  return compile(buildGraph({ people, unions, relations, vocab }));
}

const personIn = (graph: CompiledGraph, id: string) =>
  graph.people.find((candidate) => candidate.id === id);

describe("presence", () => {
  const graph = compiled([
    person("karl", { birth: { date: "1930" }, death: { date: "2005-11-02" }, status: "deceased" }),
    person("agnes", { birth: { date: "1962-03-04" } }),
    person("undated"),
    person("approx", { birth: { date: "1890~" } }),
  ]);

  const at = (id: string, year: number) => {
    const found = personIn(graph, id);
    return found === undefined ? null : presenceAt(found, year);
  };

  it("hides someone before they were born", () => {
    expect(at("agnes", 1950)).toBe("unborn");
  });

  it("shows them from their birth year", () => {
    expect(at("agnes", 1962)).toBe("alive");
    expect(at("agnes", 2000)).toBe("alive");
  });

  it("greys them after they died rather than hiding them", () => {
    expect(at("karl", 2004)).toBe("alive");
    expect(at("karl", 2005)).toBe("alive");
    expect(at("karl", 2006)).toBe("dead");
  });

  it("never hides someone whose dates are unknown", () => {
    expect(at("undated", 1800)).toBe("alive");
    expect(at("undated", 2200)).toBe("alive");
  });

  it("reads an approximate birth at its earliest, so nobody vanishes on a guess", () => {
    // 1890~ spans 1889..1891; the person is shown from 1889.
    expect(at("approx", 1889)).toBe("alive");
    expect(at("approx", 1888)).toBe("unborn");
  });
});

describe("dated ties", () => {
  const union = (extra: Partial<Union>): Union => ({
    id: "u-0001",
    partners: ["a", "b"],
    type: "marriage",
    ...extra,
  });

  it("covers the years between its ends", () => {
    const married = union({ from: "1988-06-11", to: "2004" });
    expect(unionActiveAt(married, 1987)).toBe(false);
    expect(unionActiveAt(married, 1988)).toBe(true);
    expect(unionActiveAt(married, 2004)).toBe(true);
    expect(unionActiveAt(married, 2005)).toBe(false);
  });

  it("runs on when it has no end", () => {
    const ongoing = union({ from: "2008", to: null });
    expect(unionActiveAt(ongoing, 2200)).toBe(true);
  });

  it("is never hidden when it has no dates at all", () => {
    expect(unionActiveAt(union({}), 1500)).toBe(true);
  });

  it("applies the same rule to relations", () => {
    const tie: Relation = {
      id: "r-0001",
      type: "friend",
      from: "a",
      to: "b",
      symmetric: true,
      status: "active",
      since: "2019",
      until: "2023",
    };

    expect(relationActiveAt(tie, 2018)).toBe(false);
    expect(relationActiveAt(tie, 2020)).toBe(true);
    expect(relationActiveAt(tie, 2024)).toBe(false);
  });
});

describe("the scrubber's span", () => {
  it("runs from the earliest date in the data to today", () => {
    const graph = compiled([person("old", { birth: { date: "1890" } })]);
    expect(yearRangeOf(graph, 2026)).toEqual({ min: 1890, max: 2026 });
  });

  it("extends past today when the data does", () => {
    const graph = compiled([
      person("a", { birth: { date: "1890" } }),
      person("b", { birth: { date: "2040" } }),
    ]);
    expect(yearRangeOf(graph, 2026)?.max).toBe(2040);
  });

  it("counts union and relation dates too", () => {
    const graph = compiled(
      [person("a"), person("b")],
      [{ id: "u-0001", partners: ["a", "b"], type: "marriage", from: "1901" }],
    );
    expect(yearRangeOf(graph, 2026)?.min).toBe(1901);
  });

  it("has no span when nothing is dated", () => {
    expect(yearRangeOf(compiled([person("a")]), 2026)).toBeNull();
  });
});

describe("the graph as it stood", () => {
  const graph = compiled(
    [
      person("gran", { birth: { date: "1930" }, death: { date: "2005" }, status: "deceased" }),
      person("mum", { birth: { date: "1962" }, parents: [birth("gran")] }),
      person("kid", { birth: { date: "1990" }, parents: [birth("mum")] }),
    ],
    [{ id: "u-0001", partners: ["gran", "mum"], type: "marriage", from: "1980", to: "1990" }],
  );

  const shellAt = (year: number | null) =>
    elementsFor(graph, egoGraph(graph, "mum", { depth: 3 }), { mode: "lineage", year });

  it("shows everyone when the scrubber is off", () => {
    expect(shellAt(null).nodes.map((node) => node.data.id)).toContain("kid");
  });

  it("hides the unborn", () => {
    const ids = shellAt(1970).nodes.map((node) => node.data.id);
    expect(ids).toContain("mum");
    expect(ids).not.toContain("kid");
  });

  it("keeps the dead, greyed", () => {
    const nodes = shellAt(2010).nodes;
    expect(nodes.map((node) => node.data.id)).toContain("gran");
    expect(nodes.find((node) => node.data.id === "gran")?.data.deceased).toBe(true);
  });

  it("does not grey them before they died", () => {
    expect(shellAt(1995).nodes.find((node) => node.data.id === "gran")?.data.deceased).toBe(false);
  });

  it("drops a union outside its range", () => {
    const inRange = shellAt(1985).edges.filter((edge) => edge.data.kind === "union");
    const outOfRange = shellAt(2000).edges.filter((edge) => edge.data.kind === "union");

    expect(inRange.length).toBeGreaterThan(0);
    expect(outOfRange).toHaveLength(0);
  });
});
