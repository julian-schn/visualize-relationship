import { describe, expect, it } from "vitest";
import { buildGraph, type GraphInput } from "../src/model/graph.ts";
import type { Person, Relation, Union, Vocab } from "../src/model/types.ts";

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

function person(id: string, extra: Partial<Person> = {}): Person {
  return {
    id,
    names: { display: id },
    status: "living",
    meta: { created: "2026-07-26", updated: "2026-07-26", author: "agent" },
    ...extra,
  };
}

function tombstone(id: string, mergedInto: string): Person {
  return person(id, { status: "merged", mergedInto });
}

function union(id: string, partners: string[]): Union {
  return { id, partners, type: "marriage" };
}

function relation(id: string, from: string, to: string): Relation {
  return { id, type: "friend", from, to, symmetric: true, status: "active" };
}

function build(input: Partial<GraphInput>) {
  return buildGraph({
    people: [],
    unions: [],
    relations: [],
    vocab,
    ...input,
  });
}

describe("merged tombstones", () => {
  it("keeps tombstones out of the visible graph but not out of the data", () => {
    const graph = build({ people: [person("agnes-vogt"), tombstone("agnes-v", "agnes-vogt")] });

    expect([...graph.people.keys()]).toEqual(["agnes-vogt"]);
    expect([...graph.tombstones.keys()]).toEqual(["agnes-v"]);
    expect(graph.tombstones.get("agnes-v")?.names.display).toBe("agnes-v");
  });

  it("resolves an id that was never merged to itself", () => {
    const graph = build({ people: [person("agnes-vogt")] });
    expect(graph.resolve("agnes-vogt")).toBe("agnes-vogt");
  });

  it("resolves an unknown id to itself rather than throwing", () => {
    const graph = build({ people: [] });
    expect(graph.resolve("nobody")).toBe("nobody");
  });

  it("flattens a chain of merges", () => {
    const graph = build({
      people: [person("c"), tombstone("b", "c"), tombstone("a", "b")],
    });

    expect(graph.resolve("a")).toBe("c");
    expect(graph.resolve("b")).toBe("c");
  });

  it("redirects parentage through a tombstone", () => {
    const graph = build({
      people: [
        person("karl-vogt"),
        tombstone("uncle-karl", "karl-vogt"),
        person("agnes-vogt", { parents: [{ id: "uncle-karl", kind: "birth" }] }),
      ],
    });

    expect(graph.people.get("agnes-vogt")?.parents).toEqual([
      { id: "karl-vogt", kind: "birth" },
    ]);
  });

  it("keeps the rest of a parentage edge intact while redirecting it", () => {
    const graph = build({
      people: [
        person("karl-vogt"),
        tombstone("uncle-karl", "karl-vogt"),
        person("agnes-vogt", {
          parents: [{ id: "uncle-karl", kind: "adoptive", confidence: "probable" }],
        }),
      ],
    });

    expect(graph.people.get("agnes-vogt")?.parents).toEqual([
      { id: "karl-vogt", kind: "adoptive", confidence: "probable" },
    ]);
  });

  it("redirects union partners and relation endpoints", () => {
    const graph = build({
      people: [person("karl-vogt"), tombstone("uncle-karl", "karl-vogt"), person("agnes-vogt")],
      unions: [union("u-0001", ["uncle-karl", "agnes-vogt"])],
      relations: [relation("r-0001", "agnes-vogt", "uncle-karl")],
    });

    expect(graph.unions[0]?.partners).toEqual(["karl-vogt", "agnes-vogt"]);
    expect(graph.relations[0]).toMatchObject({ from: "agnes-vogt", to: "karl-vogt" });
  });

  it("does not mutate the records it was given", () => {
    const child = person("agnes-vogt", { parents: [{ id: "uncle-karl", kind: "birth" }] });
    const source = union("u-0001", ["uncle-karl"]);

    build({
      people: [person("karl-vogt"), tombstone("uncle-karl", "karl-vogt"), child],
      unions: [source],
    });

    expect(child.parents).toEqual([{ id: "uncle-karl", kind: "birth" }]);
    expect(source.partners).toEqual(["uncle-karl"]);
  });
});

describe("degrading on bad merge data", () => {
  it("stops on a merge cycle instead of hanging", () => {
    const graph = build({ people: [tombstone("a", "b"), tombstone("b", "a")] });

    expect(graph.resolve("a")).toBe("b");
    expect(graph.resolve("b")).toBe("a");
    expect(graph.people.size).toBe(0);
  });

  it("stops on a tombstone pointing at itself", () => {
    const graph = build({ people: [tombstone("a", "a")] });
    expect(graph.resolve("a")).toBe("a");
  });

  it("stops at a dangling merge target", () => {
    const graph = build({ people: [tombstone("a", "gone")] });
    expect(graph.resolve("a")).toBe("gone");
  });

  it("survives a chain longer than the depth cap", () => {
    const links = Array.from({ length: 200 }, (_, index) =>
      tombstone(`p-${index}`, `p-${index + 1}`),
    );
    const graph = build({ people: [...links, person("p-200")] });

    expect(graph.resolve("p-0")).toBe("p-32");
  });
});

describe("notes", () => {
  it("prefers a sidecar over the inline field", () => {
    const graph = build({
      people: [person("agnes-vogt", { notes: "inline" })],
      notes: new Map([["agnes-vogt", "sidecar"]]),
    });

    expect(graph.people.get("agnes-vogt")?.notes).toBe("sidecar");
  });

  it("keeps the inline field when there is no sidecar", () => {
    const graph = build({ people: [person("agnes-vogt", { notes: "inline" })] });
    expect(graph.people.get("agnes-vogt")?.notes).toBe("inline");
  });

  it("ignores a sidecar belonging to nobody", () => {
    const graph = build({
      people: [person("agnes-vogt")],
      notes: new Map([["ghost", "sidecar"]]),
    });

    expect(graph.people.get("agnes-vogt")?.notes).toBeUndefined();
    expect(graph.people.size).toBe(1);
  });
});
