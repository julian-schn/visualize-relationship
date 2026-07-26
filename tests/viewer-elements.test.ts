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

  it("gives a three-person union one scaffolding node in lineage mode", () => {
    const graph = graphOf(
      [person("a"), person("b"), person("c")],
      [{ id: "u-0001", partners: ["a", "b", "c"], type: "partnership" }],
    );

    const { nodes, edges } = shellOf(graph, "a");
    const unionEdges = edges.filter((edge) => edge.data.kind === "union");

    expect(nodes.filter((node) => node.data.kind === "union")).toHaveLength(1);
    // Two rails per partner: section 11.4 draws a union as a doubled hairline.
    expect(unionEdges).toHaveLength(6);
    expect(unionEdges.every((edge) => edge.data.target === "n:u-0001")).toBe(true);
    expect(new Set(unionEdges.map((edge) => edge.data.rail))).toEqual(new Set([-1, 1]));
  });

  it("joins partners pairwise in social mode, with no scaffolding", () => {
    const graph = graphOf(
      [person("a"), person("b"), person("c")],
      [{ id: "u-0001", partners: ["a", "b", "c"], type: "partnership" }],
    );

    const ego = egoGraph(graph, "a", { depth: 3, kinds: ["parentage", "union", "relation"] });
    const { nodes, edges } = elementsFor(graph, ego, { mode: "social" });

    expect(nodes.filter((node) => node.data.kind === "union")).toHaveLength(0);
    expect(edges.filter((edge) => edge.data.kind === "union")).toHaveLength(3);
  });

  it("drops a partner who is outside the shell", () => {
    const graph = graphOf(
      [person("a"), person("b"), person("c")],
      [{ id: "u-0001", partners: ["a", "b", "c"], type: "partnership" }],
    );

    const ego = { ids: new Set(["a", "b"]), distance: new Map([["a", 0], ["b", 1]]) };
    const unionEdges = elementsFor(graph, ego).edges.filter((e) => e.data.kind === "union");

    expect([...new Set(unionEdges.map((edge) => edge.data.source))].sort()).toEqual(["a", "b"]);
  });

  it("draws each rail as its own edge with a distinct id", () => {
    const graph = graphOf(
      [person("a"), person("b")],
      [{ id: "u-0001", partners: ["a", "b"], type: "marriage" }],
    );

    const rails = shellOf(graph, "a").edges.filter((edge) => edge.data.kind === "union");
    expect(new Set(rails.map((edge) => edge.data.id)).size).toBe(rails.length);
    expect(rails.filter((edge) => edge.data.rail === -1)).toHaveLength(2);
  });

  it("leaves social mode undoubled, where a force layout has no rails to align", () => {
    const graph = graphOf(
      [person("a"), person("b")],
      [{ id: "u-0001", partners: ["a", "b"], type: "marriage" }],
    );

    const ego = egoGraph(graph, "a", { depth: 2, kinds: ["parentage", "union", "relation"] });
    const social = elementsFor(graph, ego, { mode: "social" });

    expect(social.edges.filter((edge) => edge.data.kind === "union")).toHaveLength(1);
  });

  it("does not scaffold a union with only one partner in view", () => {
    const graph = graphOf(
      [person("a"), person("b")],
      [{ id: "u-0001", partners: ["a", "b"], type: "marriage" }],
    );

    const ego = { ids: new Set(["a"]), distance: new Map([["a", 0]]) };
    const { nodes } = elementsFor(graph, ego);

    expect(nodes.filter((node) => node.data.kind === "union")).toHaveLength(0);
  });
});

describe("scaffolding keeps partners level", () => {
  const couple = [
    person("mum"),
    person("dad"),
    person("kid", [
      { id: "mum", kind: "birth" },
      { id: "dad", kind: "birth" },
    ]),
  ];
  const married = [{ id: "u-0001", partners: ["mum", "dad"], type: "marriage" }];

  it("hangs a couple's child off the union rather than off one parent", () => {
    const graph = graphOf(couple, married);
    const parentage = shellOf(graph, "kid").edges.filter((e) => e.data.kind === "parentage");

    expect(parentage).toHaveLength(1);
    expect(parentage[0]?.data.source).toBe("n:u-0001");
  });

  it("spans one rank through scaffolding and two when direct", () => {
    const graph = graphOf(couple, married);
    const viaUnion = shellOf(graph, "kid").edges.find((e) => e.data.kind === "parentage");
    expect(viaUnion?.data.span).toBe(1);

    const single = graphOf([person("mum"), person("kid", [{ id: "mum", kind: "birth" }])]);
    const direct = shellOf(single, "kid").edges.find((e) => e.data.kind === "parentage");
    expect(direct?.data.span).toBe(2);
  });

  it("keeps direct edges when the parents disagree on how they are parents", () => {
    // One birth parent and one adoptive parent must keep their own line work.
    const mixed = graphOf(
      [
        person("mum"),
        person("dad"),
        person("kid", [
          { id: "mum", kind: "birth" },
          { id: "dad", kind: "adoptive" },
        ]),
      ],
      married,
    );

    const parentage = shellOf(mixed, "kid").edges.filter((e) => e.data.kind === "parentage");
    expect(parentage).toHaveLength(2);
    expect(parentage.some((edge) => edge.data.notByBirth)).toBe(true);
  });

  it("does not scaffold in social mode", () => {
    const graph = graphOf(couple, married);
    const ego = egoGraph(graph, "kid", { depth: 3, kinds: ["parentage", "union", "relation"] });
    const { edges } = elementsFor(graph, ego, { mode: "social" });

    expect(edges.filter((e) => e.data.kind === "parentage")).toHaveLength(2);
  });
});

describe("circle mode", () => {
  const people = [
    person("me", [{ id: "mum", kind: "birth" }]),
    person("mum"),
    person("pal"),
  ];
  const relations = [
    {
      id: "r-0001",
      type: "friend",
      from: "me",
      to: "pal",
      symmetric: true,
      status: "active",
    },
  ];

  const graph = compile(buildGraph({ people, unions: [], relations, vocab }));

  it("shows a friend, where lineage shows only kin", () => {
    const circle = elementsFor(
      graph,
      egoGraph(graph, "me", { depth: 2, kinds: ["parentage", "union", "relation"] }),
      { mode: "circle" },
    );
    const lineage = elementsFor(graph, egoGraph(graph, "me", { depth: 2 }), { mode: "lineage" });

    expect(circle.nodes.map((node) => node.data.id)).toContain("pal");
    expect(lineage.nodes.map((node) => node.data.id)).not.toContain("pal");
  });

  it("puts the term under the name", () => {
    const { nodes } = elementsFor(
      graph,
      egoGraph(graph, "me", { depth: 2, kinds: ["parentage", "union", "relation"] }),
      { mode: "circle", terms: new Map([["mum", "parent"], ["pal", "Friend"]]) },
    );

    const mum = nodes.find((node) => node.data.id === "mum")?.data;
    expect(mum?.term).toBe("parent");
    expect(mum?.caption).toBe("mum\nparent");
  });

  it("leaves the focus without a term, being the person everything relates to", () => {
    const { nodes } = elementsFor(
      graph,
      egoGraph(graph, "me", { depth: 2, kinds: ["parentage", "union", "relation"] }),
      { mode: "circle", terms: new Map([["me", "should be ignored"]]) },
    );

    const me = nodes.find((node) => node.data.id === "me")?.data;
    expect(me?.term).toBeNull();
    expect(me?.caption).toBe("me");
  });

  it("falls back to the bare name when no term was supplied", () => {
    const { nodes } = elementsFor(
      graph,
      egoGraph(graph, "me", { depth: 2, kinds: ["parentage", "union", "relation"] }),
      { mode: "circle" },
    );

    expect(nodes.find((node) => node.data.id === "mum")?.data.caption).toBe("mum");
  });

  it("joins partners directly rather than through a marriage point", () => {
    const couple = compile(
      buildGraph({
        people: [person("a"), person("b")],
        unions: [{ id: "u-0001", partners: ["a", "b"], type: "marriage" }],
        relations: [],
        vocab,
      }),
    );

    const { nodes } = elementsFor(
      couple,
      egoGraph(couple, "a", { depth: 2, kinds: ["parentage", "union", "relation"] }),
      { mode: "circle" },
    );

    expect(nodes.filter((node) => node.data.kind === "union")).toHaveLength(0);
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
