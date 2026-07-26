import { describe, expect, it } from "vitest";
import { HOP_COST, networkOf, shortestPath } from "../src/kinship/path.ts";
import { kinshipContextOf, relate } from "../src/kinship/relate.ts";
import { buildGraph } from "../src/model/graph.ts";
import type { ParentEdge, Person, Relation, Union, Vocab } from "../src/model/types.ts";

const vocab: Vocab = {
  version: 1,
  relationType: [
    { key: "friend", label: "Friend", symmetric: true },
    { key: "mentor", label: "Mentor", symmetric: false, inverse: "mentee" },
    { key: "mentee", label: "Mentee", symmetric: false, inverse: "mentor" },
    { key: "chosen-family", label: "Chosen family", symmetric: true },
  ],
  parentKind: [],
  unionType: [],
  unionEnd: [],
  relationStatus: [],
  relationEnd: [],
  context: [],
  tag: [],
};

const meta = { created: "2026-07-26", updated: "2026-07-26", author: "agent" as const };
const birth = (id: string): ParentEdge => ({ id, kind: "birth" });

function person(id: string, parents: ParentEdge[] = []): Person {
  return { id, names: { display: id }, status: "living", parents, meta };
}

function union(id: string, partners: string[], extra: Partial<Union> = {}): Union {
  return { id, partners, type: "marriage", ...extra };
}

function relation(id: string, from: string, to: string, extra: Partial<Relation> = {}): Relation {
  return { id, type: "friend", from, to, symmetric: true, status: "active", ...extra };
}

function context(people: Person[], unions: Union[] = [], relations: Relation[] = []) {
  return kinshipContextOf(buildGraph({ people, unions, relations, vocab }));
}

/** grandma -> mum, uncle; mum + dad -> me, sister; uncle -> cousin */
const family = [
  person("grandma"),
  person("mum", [birth("grandma")]),
  person("uncle", [birth("grandma")]),
  person("dad"),
  person("me", [birth("mum"), birth("dad")]),
  person("sister", [birth("mum"), birth("dad")]),
  person("cousin", [birth("uncle")]),
];

describe("relate", () => {
  const ctx = context(family, [union("u-0001", ["mum", "dad"])]);

  it("names a blood tie", () => {
    expect(relate(ctx, "me", "grandma")).toMatchObject({ kind: "blood", term: "grandparent" });
    expect(relate(ctx, "me", "cousin")).toMatchObject({ kind: "blood", term: "first cousin" });
    expect(relate(ctx, "me", "sister")).toMatchObject({ kind: "blood", term: "sibling" });
  });

  it("answers in German", () => {
    expect(relate(ctx, "me", "grandma", { lang: "de" }).term).toBe("Großelternteil");
  });

  it("recognises the same person", () => {
    expect(relate(ctx, "me", "me")).toMatchObject({ kind: "self", path: [] });
  });

  it("returns a path alongside the term", () => {
    const found = relate(ctx, "me", "grandma");
    expect(found.path).toHaveLength(2);
    expect(found.path?.map((hop) => hop.to)).toEqual(["mum", "grandma"]);
    expect(found.path?.every((hop) => hop.label === "parent")).toBe(true);
  });

  it("keeps the raw pair for callers that want it", () => {
    expect(relate(ctx, "me", "cousin").kinship).toMatchObject({ up: 2, down: 2 });
  });
});

describe("blood wins over elective", () => {
  it("calls half-siblings half-siblings, not step-siblings", () => {
    const people = [
      person("mum"),
      person("dad"),
      person("other"),
      person("a", [birth("mum"), birth("dad")]),
      person("b", [birth("mum"), birth("other")]),
    ];
    const unions = [union("u-0001", ["mum", "dad"]), union("u-0002", ["mum", "other"])];

    expect(relate(context(people, unions), "a", "b")).toMatchObject({
      kind: "blood",
      term: "half-sibling",
    });
  });
});

describe("elective ties", () => {
  const people = [
    person("mum"),
    person("stepparent"),
    person("kid", [birth("mum")]),
    person("spouse"),
    person("spouse-parent"),
  ];

  it("names a partner", () => {
    const ctx = context(people, [union("u-0001", ["mum", "stepparent"])]);
    expect(relate(ctx, "mum", "stepparent")).toMatchObject({ kind: "partner", term: "partner" });
  });

  it("names an ex-partner", () => {
    const ended = union("u-0001", ["mum", "stepparent"], { to: "2004", endReason: "divorce" });
    expect(relate(context(people, [ended]), "mum", "stepparent").term).toBe("ex-partner");
  });

  it("names a late partner rather than an ex", () => {
    const widowed = union("u-0001", ["mum", "stepparent"], { to: "2004", endReason: "death" });
    expect(relate(context(people, [widowed]), "mum", "stepparent").term).toBe("late partner");
  });

  it("names a step-parent", () => {
    const ctx = context(people, [union("u-0001", ["mum", "stepparent"])]);
    expect(relate(ctx, "kid", "stepparent")).toMatchObject({ kind: "step", term: "step-parent" });
  });

  it("names a former step-parent", () => {
    const ended = union("u-0001", ["mum", "stepparent"], { to: "2004", endReason: "separation" });
    expect(relate(context(people, [ended]), "kid", "stepparent").term).toBe("former step-parent");
  });

  it("names a parent-in-law", () => {
    const withSpouse = [...people, person("spouse2", [birth("spouse-parent")])];
    const ctx = context(withSpouse, [union("u-0001", ["kid", "spouse2"])]);
    expect(relate(ctx, "kid", "spouse-parent")).toMatchObject({
      kind: "in-law",
      term: "parent-in-law",
    });
  });
});

describe("chosen family", () => {
  const people = [person("a"), person("b"), person("c")];

  it("reports it on its own line, never as the term", () => {
    const chosen = relation("r-0001", "a", "b", { type: "chosen-family" });
    const found = relate(context(people, [], [chosen]), "a", "b");

    expect(found.chosenFamily).toBe(true);
    expect(found.term).toBeNull();
    expect(found.kind).toBe("path");
  });

  it("reports it alongside a blood term without replacing it", () => {
    const kin = [person("p"), person("x", [birth("p")])];
    const chosen = relation("r-0001", "x", "p", { type: "chosen-family" });
    const found = relate(context(kin, [], [chosen]), "x", "p");

    expect(found.term).toBe("parent");
    expect(found.chosenFamily).toBe(true);
  });

  it("ignores a chosen-family tie that ended", () => {
    const chosen = relation("r-0001", "a", "b", { type: "chosen-family", status: "ended" });
    expect(relate(context(people, [], [chosen]), "a", "b").chosenFamily).toBe(false);
  });
});

describe("unrelated people", () => {
  it("says so when nothing connects them", () => {
    const found = relate(context([person("a"), person("b")]), "a", "b");
    expect(found).toMatchObject({ kind: "none", term: "not related", path: null });
  });
});

describe("path costs", () => {
  it("prefers two blood hops over one hop through a friend", () => {
    // a and b are grandparent and grandchild, and also share a mutual friend.
    const people = [person("a"), person("mid", [birth("a")]), person("b", [birth("mid")]), person("f")];
    const relations = [relation("r-0001", "a", "f"), relation("r-0002", "f", "b")];
    const network = networkOf(buildGraph({ people, unions: [], relations, vocab }));

    const path = shortestPath(network, "b", "a");
    expect(path?.map((hop) => hop.to)).toEqual(["mid", "a"]);
  });

  it("prefers a current union over an ended one", () => {
    expect(HOP_COST.partnerCurrent).toBeLessThan(HOP_COST.partnerEnded);
  });

  it("costs an estranged tie more than an active one", () => {
    expect(HOP_COST.relationActive).toBeLessThan(HOP_COST.relationEnded);
  });

  it("labels an asymmetric relation with the inverse when walked backwards", () => {
    const people = [person("teacher"), person("student")];
    const relations = [
      relation("r-0001", "teacher", "student", { type: "mentor", symmetric: false }),
    ];
    const network = networkOf(buildGraph({ people, unions: [], relations, vocab }));

    expect(shortestPath(network, "teacher", "student")?.[0]?.label).toBe("Mentor");
    expect(shortestPath(network, "student", "teacher")?.[0]?.label).toBe("Mentee");
  });

  it("records which union or relation each hop crossed", () => {
    const people = [person("a"), person("b")];
    const network = networkOf(
      buildGraph({ people, unions: [union("u-0007", ["a", "b"])], relations: [], vocab }),
    );

    expect(shortestPath(network, "a", "b")?.[0]).toMatchObject({ via: "u-0007", kind: "partner" });
  });

  it("gives up rather than walking a long chain forever", () => {
    const chain = Array.from({ length: 40 }, (_, index) => person(`p-${index}`));
    const links = Array.from({ length: 39 }, (_, index) =>
      relation(`r-${index}`, `p-${index}`, `p-${index + 1}`),
    );
    const network = networkOf(buildGraph({ people: chain, unions: [], relations: links, vocab }));

    expect(shortestPath(network, "p-0", "p-39")).toBeNull();
    expect(shortestPath(network, "p-0", "p-3")).toHaveLength(3);
  });
});
