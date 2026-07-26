import { describe, expect, it } from "vitest";
import { compile, type CompiledGraph } from "../src/build/compile.ts";
import { buildGraph } from "../src/model/graph.ts";
import type { ParentEdge, Person, Union, Vocab } from "../src/model/types.ts";
import { egoGraph } from "../src/viewer/ego.ts";
import { elementsFor } from "../src/viewer/elements.ts";

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

const meta = { created: "2026-07-26", updated: "2026-07-26", author: "agent" as const };

function person(id: string, parents: ParentEdge[] = [], extra: Partial<Person> = {}): Person {
  return { id, names: { display: id }, status: "living", parents, meta, ...extra };
}

function graphOf(people: Person[], unions: Union[] = []): CompiledGraph {
  return compile(buildGraph({ people, unions, relations: [], vocab }));
}

function shellOf(graph: CompiledGraph, focus: string, depth = 3) {
  return elementsFor(graph, egoGraph(graph, focus, { depth }));
}

describe("nodes", () => {
  it("emits only the people inside the shell", () => {
    const graph = graphOf([
      person("me", [{ id: "parent", kind: "birth" }]),
      person("parent"),
      person("stranger"),
    ]);

    const { nodes } = elementsFor(graph, egoGraph(graph, "me", { depth: 1 }));
    expect(nodes.map((node) => node.data.id).sort()).toEqual(["me", "parent"]);
  });

  it("marks the focus and carries the hop count for fading", () => {
    const graph = graphOf([
      person("me", [{ id: "parent", kind: "birth" }]),
      person("parent", [{ id: "gran", kind: "birth" }]),
      person("gran"),
    ]);

    const { nodes } = shellOf(graph, "me");
    const byId = new Map(nodes.map((node) => [node.data.id, node.data]));

    expect(byId.get("me")?.focus).toBe(true);
    expect(byId.get("parent")?.focus).toBe(false);
    expect(byId.get("gran")?.distance).toBe(2);
  });

  it("marks the dead so they can be greyed", () => {
    const graph = graphOf([person("a", [], { status: "deceased" })]);
    expect(shellOf(graph, "a").nodes[0]?.data.deceased).toBe(true);
  });
});

describe("parentage edges", () => {
  it("draws from parent down to child", () => {
    const graph = graphOf([person("kid", [{ id: "parent", kind: "birth" }]), person("parent")]);
    const edge = shellOf(graph, "kid").edges[0]?.data;

    expect(edge).toMatchObject({ source: "parent", target: "kid", kind: "parentage" });
  });

  it("flags parentage below certain, which renders dashed", () => {
    const graph = graphOf([
      person("kid", [{ id: "parent", kind: "birth", confidence: "uncertain" }]),
      person("parent"),
    ]);

    expect(shellOf(graph, "kid").edges[0]?.data.uncertain).toBe(true);
  });

  it("does not flag an edge that is explicitly certain", () => {
    const graph = graphOf([
      person("kid", [{ id: "parent", kind: "birth", confidence: "certain" }]),
      person("parent"),
    ]);

    expect(shellOf(graph, "kid").edges[0]?.data.uncertain).toBe(false);
  });

  it("flags non-birth parentage for the notch glyph", () => {
    const graph = graphOf([
      person("kid", [{ id: "parent", kind: "adoptive" }]),
      person("parent"),
    ]);

    expect(shellOf(graph, "kid").edges[0]?.data.notByBirth).toBe(true);
  });

  it("treats an unknown kind as birth rather than marking it", () => {
    const graph = graphOf([person("kid", [{ id: "parent", kind: "unknown" }]), person("parent")]);
    expect(shellOf(graph, "kid").edges[0]?.data.notByBirth).toBe(false);
  });

  it("omits an edge whose other end is outside the shell", () => {
    const graph = graphOf([
      person("me", [{ id: "parent", kind: "birth" }]),
      person("parent", [{ id: "gran", kind: "birth" }]),
      person("gran"),
    ]);

    const { edges } = elementsFor(graph, egoGraph(graph, "me", { depth: 1 }));
    expect(edges.map((edge) => edge.data.id)).toEqual(["p:parent->me"]);
  });
});

describe("union edges", () => {
  it("joins two partners", () => {
    const graph = graphOf(
      [person("a"), person("b")],
      [{ id: "u-0001", partners: ["a", "b"], type: "marriage" }],
    );

    expect(shellOf(graph, "a").edges[0]?.data).toMatchObject({ kind: "union", ended: false });
  });

  it("marks an ended union, by date or by reason", () => {
    const byDate = graphOf(
      [person("a"), person("b")],
      [{ id: "u-0001", partners: ["a", "b"], type: "marriage", to: "2004" }],
    );
    const byReason = graphOf(
      [person("a"), person("b")],
      [{ id: "u-0001", partners: ["a", "b"], type: "marriage", endReason: "drift" }],
    );

    expect(shellOf(byDate, "a").edges[0]?.data.ended).toBe(true);
    expect(shellOf(byReason, "a").edges[0]?.data.ended).toBe(true);
  });

  it("draws a three-person union as a triangle rather than a hub", () => {
    const graph = graphOf(
      [person("a"), person("b"), person("c")],
      [{ id: "u-0001", partners: ["a", "b", "c"], type: "partnership" }],
    );

    const unionEdges = shellOf(graph, "a").edges.filter((edge) => edge.data.kind === "union");
    expect(unionEdges).toHaveLength(3);
    expect(new Set(unionEdges.map((edge) => edge.data.id)).size).toBe(3);
  });

  it("drops a partner who is outside the shell", () => {
    const graph = graphOf(
      [person("a"), person("b"), person("c")],
      [{ id: "u-0001", partners: ["a", "b", "c"], type: "partnership" }],
    );

    const ego = { ids: new Set(["a", "b"]), distance: new Map([["a", 0], ["b", 1]]) };
    expect(elementsFor(graph, ego).edges).toHaveLength(1);
  });
});

describe("element ids", () => {
  it("are unique, which cytoscape requires", () => {
    const graph = graphOf(
      [
        person("kid", [
          { id: "mum", kind: "birth" },
          { id: "dad", kind: "birth" },
        ]),
        person("mum"),
        person("dad"),
      ],
      [{ id: "u-0001", partners: ["mum", "dad"], type: "marriage" }],
    );

    const { nodes, edges } = shellOf(graph, "kid");
    const ids = [...nodes.map((n) => n.data.id), ...edges.map((e) => e.data.id)];

    expect(new Set(ids).size).toBe(ids.length);
  });
});
