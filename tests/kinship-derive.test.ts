import { describe, expect, it } from "vitest";
import { ancestorsOf, kinshipBetween, parentageOf } from "../src/kinship/derive.ts";
import { buildGraph } from "../src/model/graph.ts";
import type { ParentEdge, Person, Vocab } from "../src/model/types.ts";

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
const adopted = (id: string): ParentEdge => ({ id, kind: "adoptive" });

function parentage(people: Person[]) {
  return parentageOf(buildGraph({ people, unions: [], relations: [], vocab }));
}

/**
 * grandma + grandpa
 *   -> mum, uncle
 * mum + dad            -> me, sister
 * mum + second-husband -> half-brother
 * uncle + aunt         -> cousin
 * sister + sisters-partner -> niece
 */
const family = [
  person("grandma"),
  person("grandpa"),
  person("mum", [birth("grandma"), birth("grandpa")]),
  person("uncle", [birth("grandma"), birth("grandpa")]),
  person("dad"),
  person("second-husband"),
  person("aunt"),
  person("sisters-partner"),
  person("me", [birth("mum"), birth("dad")]),
  person("sister", [birth("mum"), birth("dad")]),
  person("half-brother", [birth("mum"), birth("second-husband")]),
  person("cousin", [birth("uncle"), birth("aunt")]),
  person("niece", [birth("sister"), birth("sisters-partner")]),
];

const pair = (a: string, b: string) => {
  const found = kinshipBetween(parentage(family), a, b);
  return found === null ? null : { up: found.up, down: found.down, full: found.full };
};

describe("the section 8 pairs", () => {
  it("reads (1,0) as a parent", () => {
    expect(pair("me", "mum")).toEqual({ up: 1, down: 0, full: false });
  });

  it("reads (0,1) as a child", () => {
    expect(pair("mum", "me")).toEqual({ up: 0, down: 1, full: false });
  });

  it("reads (1,1) as a sibling", () => {
    expect(pair("me", "sister")).toEqual({ up: 1, down: 1, full: true });
  });

  it("reads (2,0) as a grandparent", () => {
    expect(pair("me", "grandma")).toEqual({ up: 2, down: 0, full: false });
  });

  it("reads (0,2) as a grandchild", () => {
    expect(pair("grandma", "me")).toEqual({ up: 0, down: 2, full: false });
  });

  it("reads (2,1) as a parent's sibling", () => {
    expect(pair("me", "uncle")).toEqual({ up: 2, down: 1, full: false });
  });

  it("reads (1,2) as a sibling's child", () => {
    expect(pair("me", "niece")).toEqual({ up: 1, down: 2, full: false });
  });

  it("reads (2,2) as a first cousin", () => {
    expect(pair("me", "cousin")).toEqual({ up: 2, down: 2, full: false });
  });

  it("reads (3,2) as a first cousin once removed", () => {
    expect(pair("niece", "cousin")).toEqual({ up: 3, down: 2, full: false });
  });
});

describe("full and half siblings", () => {
  it("calls two shared parents full", () => {
    expect(pair("me", "sister")?.full).toBe(true);
  });

  it("calls one shared parent half", () => {
    expect(pair("me", "half-brother")).toEqual({ up: 1, down: 1, full: false });
  });

  it("finds the shared parent of a half sibling", () => {
    expect(kinshipBetween(parentage(family), "me", "half-brother")?.through).toEqual(["mum"]);
  });

  it("finds both shared parents of a full sibling", () => {
    expect(kinshipBetween(parentage(family), "me", "sister")?.through).toEqual(["dad", "mum"]);
  });
});

describe("closest tie wins", () => {
  it("prefers the parent tie over the grandparent one when both exist", () => {
    // A cousin marriage makes grandma reachable from me two ways; mum is still closer.
    expect(pair("me", "mum")).toEqual({ up: 1, down: 0, full: false });
  });

  it("returns null for two people with no shared ancestor", () => {
    expect(pair("dad", "aunt")).toBeNull();
  });

  it("returns null for a person and themselves", () => {
    expect(pair("me", "me")).toBeNull();
  });
});

describe("non-birth parentage", () => {
  const adoptive = [
    person("adoptive-parent"),
    person("birth-parent"),
    person("kid", [adopted("adoptive-parent")]),
    person("other-kid", [birth("birth-parent"), adopted("adoptive-parent")]),
  ];

  it("treats an adoptive parent as kin", () => {
    expect(kinshipBetween(parentage(adoptive), "kid", "adoptive-parent")).toMatchObject({
      up: 1,
      down: 0,
    });
  });

  it("marks the tie as not by birth", () => {
    expect(kinshipBetween(parentage(adoptive), "kid", "adoptive-parent")?.byBirth).toBe(false);
  });

  it("marks a birth tie as by birth", () => {
    expect(kinshipBetween(parentage(adoptive), "other-kid", "birth-parent")?.byBirth).toBe(true);
  });

  it("makes adoptive siblings kin", () => {
    expect(kinshipBetween(parentage(adoptive), "kid", "other-kid")).toMatchObject({
      up: 1,
      down: 1,
    });
  });

  it("treats an unknown parent kind as birth rather than guessing otherwise", () => {
    const people = [person("p"), person("c", [{ id: "p", kind: "unknown" }])];
    expect(kinshipBetween(parentage(people), "c", "p")?.byBirth).toBe(true);
  });
});

describe("ancestors", () => {
  it("includes the person at distance zero", () => {
    expect(ancestorsOf(parentage(family), "me").get("me")).toEqual({
      distance: 0,
      byBirth: true,
    });
  });

  it("reaches every generation above", () => {
    const found = ancestorsOf(parentage(family), "me");
    expect(found.get("mum")?.distance).toBe(1);
    expect(found.get("grandma")?.distance).toBe(2);
  });

  it("does not reach downwards", () => {
    expect(ancestorsOf(parentage(family), "me").has("niece")).toBe(false);
  });
});

describe("degrading on bad data", () => {
  it("stops on a parentage cycle instead of hanging", () => {
    const looped = [
      person("a", [birth("b")]),
      person("b", [birth("c")]),
      person("c", [birth("a")]),
    ];

    const found = ancestorsOf(parentage(looped), "a");
    expect(found.size).toBeGreaterThan(0);
    expect(found.size).toBeLessThan(10);
  });

  it("caps a very deep line rather than walking it forever", () => {
    const chain = Array.from({ length: 200 }, (_, index) =>
      person(`g-${index}`, index === 0 ? [] : [birth(`g-${index - 1}`)]),
    );

    const found = ancestorsOf(parentage(chain), "g-199");
    expect(found.size).toBeLessThanOrEqual(25);
  });

  it("survives a person listed as their own parent", () => {
    const people = [person("a", [birth("a")])];
    expect(ancestorsOf(parentage(people), "a").size).toBe(1);
  });
});
