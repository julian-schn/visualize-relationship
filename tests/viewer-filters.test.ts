import { describe, expect, it } from "vitest";
import { compile, type CompiledGraph } from "../src/build/compile.ts";
import { buildGraph } from "../src/model/graph.ts";
import type { ParentEdge, Person, Relation, Union, Vocab } from "../src/model/types.ts";
import { egoGraph } from "../src/viewer/ego.ts";
import { elementsFor } from "../src/viewer/elements.ts";
import {
  descendantsOf,
  filterOptionsFrom,
  isFiltering,
  labelFor,
  noFilters,
  relationPasses,
  type Filters,
} from "../src/viewer/filters.ts";

const vocab: Vocab = {
  version: 1,
  relationType: [
    { key: "friend", label: "Friend", symmetric: true },
    { key: "colleague", label: "Colleague", symmetric: true },
  ],
  parentKind: [],
  unionType: [],
  unionEnd: [],
  relationStatus: [
    { key: "active", label: "Active" },
    { key: "ended", label: "Ended" },
  ],
  relationEnd: [],
  context: [
    { key: "work", label: "Work" },
    { key: "school", label: "School" },
  ],
  tag: [{ key: "maternal-side", label: "Maternal side" }],
};

const meta = { created: "2026-07-26", updated: "2026-07-26", author: "agent" as const };
const birth = (id: string): ParentEdge => ({ id, kind: "birth" });

function person(id: string, parents: ParentEdge[] = [], extra: Partial<Person> = {}): Person {
  return { id, names: { display: id }, status: "living", parents, meta, ...extra };
}

function relation(id: string, from: string, to: string, extra: Partial<Relation> = {}): Relation {
  return { id, type: "friend", from, to, symmetric: true, status: "active", ...extra };
}

function graphOf(people: Person[], relations: Relation[] = [], unions: Union[] = []): CompiledGraph {
  return compile(buildGraph({ people, unions, relations, vocab }));
}

const withFilters = (overrides: Partial<Filters>): Filters => ({ ...noFilters(), ...overrides });

describe("filter state", () => {
  it("starts filtering nothing", () => {
    expect(isFiltering(noFilters())).toBe(false);
  });

  it("knows when something is set", () => {
    expect(isFiltering(withFilters({ tags: new Set(["maternal-side"]) }))).toBe(true);
    expect(isFiltering(withFilters({ branch: "gran" }))).toBe(true);
  });

  it("treats an empty set as excluding everything, not as no filter", () => {
    expect(relationPasses(relation("r-0001", "a", "b"), withFilters({ statuses: new Set() }))).toBe(
      false,
    );
  });
});

describe("relation filters", () => {
  const tie = relation("r-0001", "a", "b", { status: "ended", context: ["work", "school"] });

  it("passes everything by default", () => {
    expect(relationPasses(tie, noFilters())).toBe(true);
  });

  it("filters by type", () => {
    expect(relationPasses(tie, withFilters({ relationTypes: new Set(["friend"]) }))).toBe(true);
    expect(relationPasses(tie, withFilters({ relationTypes: new Set(["colleague"]) }))).toBe(false);
  });

  it("filters by status", () => {
    expect(relationPasses(tie, withFilters({ statuses: new Set(["ended"]) }))).toBe(true);
    expect(relationPasses(tie, withFilters({ statuses: new Set(["active"]) }))).toBe(false);
  });

  it("keeps a relation matching any one of its contexts", () => {
    expect(relationPasses(tie, withFilters({ contexts: new Set(["school"]) }))).toBe(true);
    expect(relationPasses(tie, withFilters({ contexts: new Set(["music"]) }))).toBe(false);
  });

  it("drops a relation with no context when filtering on context", () => {
    const plain = relation("r-0002", "a", "b");
    expect(relationPasses(plain, withFilters({ contexts: new Set(["work"]) }))).toBe(false);
  });

  it("requires every set filter to pass, not just one", () => {
    const both = withFilters({
      relationTypes: new Set(["friend"]),
      statuses: new Set(["active"]),
    });
    expect(relationPasses(tie, both)).toBe(false);
  });
});

describe("branch", () => {
  const family = graphOf([
    person("gran"),
    person("mum", [birth("gran")]),
    person("me", [birth("mum")]),
    person("kid", [birth("me")]),
    person("outsider"),
  ]);

  it("collects a whole line of descent, including the ancestor", () => {
    expect([...descendantsOf(family, "gran")].sort()).toEqual(["gran", "kid", "me", "mum"]);
  });

  it("excludes anyone off that line", () => {
    expect(descendantsOf(family, "gran").has("outsider")).toBe(false);
  });

  it("returns just the person when they have no children", () => {
    expect([...descendantsOf(family, "kid")]).toEqual(["kid"]);
  });

  it("survives a parentage cycle rather than hanging", () => {
    const looped = graphOf([
      person("a", [birth("c")]),
      person("b", [birth("a")]),
      person("c", [birth("b")]),
    ]);
    expect(descendantsOf(looped, "a").size).toBe(3);
  });

  it("narrows the rendered nodes", () => {
    const ego = egoGraph(family, "gran", { depth: 3 });
    const all = elementsFor(family, ego, { mode: "lineage" });
    const branch = elementsFor(family, ego, {
      mode: "lineage",
      filters: withFilters({ branch: "mum" }),
    });

    expect(all.nodes.length).toBeGreaterThan(branch.nodes.length);
    expect(branch.nodes.map((node) => node.data.id).sort()).toEqual(["kid", "me", "mum"]);
  });
});

describe("mode", () => {
  const people = [person("a", [], { tags: ["maternal-side"] }), person("b")];
  const ties = [relation("r-0001", "a", "b", { closeness: 4, context: ["work"] })];
  const graph = graphOf(people, ties);
  const ego = egoGraph(graph, "a", { depth: 2, kinds: ["parentage", "union", "relation"] });

  it("leaves social ties out of lineage mode", () => {
    const { edges } = elementsFor(graph, ego, { mode: "lineage" });
    expect(edges.filter((edge) => edge.data.kind === "relation")).toHaveLength(0);
  });

  it("draws them in social mode, carrying closeness and context", () => {
    const { edges } = elementsFor(graph, ego, { mode: "social" });
    const tie = edges.find((edge) => edge.data.kind === "relation")?.data;

    expect(tie).toMatchObject({ closeness: 4, contexts: 1, ended: false });
  });

  it("marks an ended or estranged tie as broken", () => {
    const ended = graphOf(people, [relation("r-0001", "a", "b", { status: "ended" })]);
    const estranged = graphOf(people, [relation("r-0001", "a", "b", { status: "estranged" })]);
    const shell = (g: CompiledGraph) =>
      elementsFor(g, egoGraph(g, "a", { depth: 2, kinds: ["relation"] }), { mode: "social" });

    expect(shell(ended).edges[0]?.data.ended).toBe(true);
    expect(shell(estranged).edges[0]?.data.ended).toBe(true);
  });

  it("hides a relation whose other end a filter removed", () => {
    const { edges } = elementsFor(graph, ego, {
      mode: "social",
      filters: withFilters({ tags: new Set(["maternal-side"]) }),
    });

    expect(edges.filter((edge) => edge.data.kind === "relation")).toHaveLength(0);
  });
});

describe("filter options", () => {
  it("offers only what the data actually uses", () => {
    const graph = graphOf(
      [person("a", [], { tags: ["maternal-side"] }), person("b")],
      [relation("r-0001", "a", "b", { type: "colleague", context: ["work"] })],
    );

    expect(filterOptionsFrom(graph)).toEqual({
      relationTypes: ["colleague"],
      statuses: ["active"],
      contexts: ["work"],
      tags: ["maternal-side"],
    });
  });

  it("shows vocabulary labels rather than keys", () => {
    const graph = graphOf([person("a")]);
    expect(labelFor(graph, "relationType", "friend")).toBe("Friend");
    expect(labelFor(graph, "context", "work")).toBe("Work");
  });

  it("falls back to the key when nothing defines a label", () => {
    const graph = graphOf([person("a")]);
    expect(labelFor(graph, "relationType", "invented")).toBe("invented");
  });
});
