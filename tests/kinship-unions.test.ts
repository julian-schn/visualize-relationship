import { describe, expect, it } from "vitest";
import { parentageOf } from "../src/kinship/derive.ts";
import { de } from "../src/kinship/terms.de.ts";
import { en } from "../src/kinship/terms.en.ts";
import { electiveTieBetween, partnerState, unionIndexOf } from "../src/kinship/unions.ts";
import { buildGraph } from "../src/model/graph.ts";
import type { ParentEdge, Person, Union, Vocab } from "../src/model/types.ts";

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

function person(id: string, parents: ParentEdge[] = []): Person {
  return { id, names: { display: id }, status: "living", parents, meta };
}

const birth = (id: string): ParentEdge => ({ id, kind: "birth" });

function union(id: string, partners: string[], extra: Partial<Union> = {}): Union {
  return { id, partners, type: "marriage", ...extra };
}

function context(people: Person[], unions: Union[]) {
  const graph = buildGraph({ people, unions, relations: [], vocab });
  return { parentage: parentageOf(graph), unions: unionIndexOf(graph) };
}

function tie(people: Person[], unions: Union[], a: string, b: string) {
  const { parentage, unions: index } = context(people, unions);
  return electiveTieBetween(parentage, index, a, b);
}

describe("partners", () => {
  const two = [person("a"), person("b")];

  it("finds a current partner", () => {
    expect(tie(two, [union("u-0001", ["a", "b"])], "a", "b")).toEqual({
      kind: "partner",
      state: "current",
    });
  });

  it("calls a partner from an ended union an ex", () => {
    const ended = union("u-0001", ["a", "b"], { to: "2004", endReason: "divorce" });
    expect(tie(two, [ended], "a", "b")).toEqual({ kind: "partner", state: "former" });
  });

  it("does not call a widowed partner an ex", () => {
    const bereaved = union("u-0001", ["a", "b"], { to: "2004", endReason: "death" });
    expect(tie(two, [bereaved], "a", "b")).toEqual({ kind: "partner", state: "late" });
  });

  it("treats an end date alone as ended", () => {
    expect(partnerState(union("u-0001", ["a", "b"], { to: "2004" }))).toBe("former");
  });

  it("treats an end reason alone as ended", () => {
    expect(partnerState(union("u-0001", ["a", "b"], { endReason: "drift" }))).toBe("former");
  });

  it("works in a three-person union", () => {
    const three = [person("a"), person("b"), person("c")];
    const poly = [union("u-0001", ["a", "b", "c"])];

    expect(tie(three, poly, "a", "c")).toEqual({ kind: "partner", state: "current" });
    expect(tie(three, poly, "b", "c")).toEqual({ kind: "partner", state: "current" });
  });
});

describe("step relations", () => {
  // mum + dad -> kid; mum later partners with stepdad, who brings their own child
  const people = [
    person("mum"),
    person("dad"),
    person("stepparent"),
    person("kid", [birth("mum"), birth("dad")]),
    person("stepkid", [birth("stepparent")]),
  ];
  const unions = [
    union("u-0001", ["mum", "dad"], { to: "2004", endReason: "divorce" }),
    union("u-0002", ["mum", "stepparent"]),
  ];

  it("finds a step-parent", () => {
    expect(tie(people, unions, "kid", "stepparent")).toEqual({
      kind: "step",
      relation: "parent",
      ended: false,
    });
  });

  it("finds a step-child in the other direction", () => {
    expect(tie(people, unions, "stepparent", "kid")).toEqual({
      kind: "step",
      relation: "child",
      ended: false,
    });
  });

  it("finds a step-sibling", () => {
    expect(tie(people, unions, "kid", "stepkid")).toEqual({
      kind: "step",
      relation: "sibling",
      ended: false,
    });
  });

  it("calls it former once the union has ended", () => {
    const separated = [
      union("u-0001", ["mum", "dad"], { to: "2004", endReason: "divorce" }),
      union("u-0002", ["mum", "stepparent"], { to: "2015", endReason: "separation" }),
    ];

    expect(tie(people, separated, "kid", "stepparent")).toEqual({
      kind: "step",
      relation: "parent",
      ended: true,
    });
  });

  it("keeps the step tie when the union ended in death", () => {
    const widowed = [
      union("u-0001", ["mum", "dad"], { to: "2004", endReason: "divorce" }),
      union("u-0002", ["mum", "stepparent"], { to: "2015", endReason: "death" }),
    ];

    expect(tie(people, widowed, "kid", "stepparent")).toEqual({
      kind: "step",
      relation: "parent",
      ended: false,
    });
  });

  it("does not call an actual parent a step-parent", () => {
    expect(tie(people, unions, "kid", "dad")).toBeNull();
    expect(tie(people, unions, "kid", "mum")).toBeNull();
  });

  it("does not call half-siblings step-siblings", () => {
    const halfs = [
      person("mum"),
      person("dad"),
      person("other"),
      person("kid", [birth("mum"), birth("dad")]),
      person("half", [birth("mum"), birth("other")]),
    ];
    const remarried = [union("u-0001", ["mum", "dad"]), union("u-0002", ["mum", "other"])];

    expect(tie(halfs, remarried, "kid", "half")).toBeNull();
  });
});

describe("in-laws", () => {
  // me + spouse; spouse has a parent and a sibling; I have a sibling and a child
  const people = [
    person("spouse-parent"),
    person("spouse", [birth("spouse-parent")]),
    person("spouse-sibling", [birth("spouse-parent")]),
    person("my-parent"),
    person("me", [birth("my-parent")]),
    person("my-sibling", [birth("my-parent")]),
    person("my-kid", [birth("me")]),
    person("kids-partner"),
    person("siblings-partner"),
  ];
  const unions = [
    union("u-0001", ["me", "spouse"]),
    union("u-0002", ["my-kid", "kids-partner"]),
    union("u-0003", ["my-sibling", "siblings-partner"]),
  ];

  it("finds a parent-in-law", () => {
    expect(tie(people, unions, "me", "spouse-parent")).toEqual({
      kind: "in-law",
      relation: "parent",
    });
  });

  it("finds a sibling-in-law through a partner", () => {
    expect(tie(people, unions, "me", "spouse-sibling")).toEqual({
      kind: "in-law",
      relation: "sibling",
    });
  });

  it("finds a sibling-in-law through a sibling's partner", () => {
    expect(tie(people, unions, "me", "siblings-partner")).toEqual({
      kind: "in-law",
      relation: "sibling",
    });
  });

  it("finds a child-in-law", () => {
    expect(tie(people, unions, "me", "kids-partner")).toEqual({
      kind: "in-law",
      relation: "child",
    });
  });

  it("returns null for two people with no tie", () => {
    expect(tie(people, unions, "spouse-parent", "my-parent")).toBeNull();
  });
});

describe("closeness ordering", () => {
  it("prefers partner over in-law when someone is both", () => {
    // Two siblings partner two siblings; each is both partner and sibling-in-law.
    const people = [
      person("p"),
      person("q"),
      person("a", [birth("p")]),
      person("b", [birth("p")]),
      person("x", [birth("q")]),
      person("y", [birth("q")]),
    ];
    const unions = [union("u-0001", ["a", "x"]), union("u-0002", ["b", "y"])];

    expect(tie(people, unions, "a", "x")).toMatchObject({ kind: "partner" });
    expect(tie(people, unions, "a", "y")).toEqual({ kind: "in-law", relation: "sibling" });
  });
});

describe("the terms these produce", () => {
  it("reads correctly in English", () => {
    expect(en.partner("current")).toBe("partner");
    expect(en.partner("former")).toBe("ex-partner");
    expect(en.partner("late")).toBe("late partner");
    expect(en.step("parent", true)).toBe("former step-parent");
  });

  it("reads correctly in German", () => {
    expect(de.partner("current")).toBe("Partnerin oder Partner");
    expect(de.partner("former")).toBe("Ex-Partnerin oder Ex-Partner");
    expect(de.partner("late")).toBe("verstorbene Partnerin oder verstorbener Partner");
    expect(de.step("parent", true)).toBe("Ex-Stiefelternteil");
  });
});
