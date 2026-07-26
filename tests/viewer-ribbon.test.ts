import { describe, expect, it } from "vitest";
import { compile } from "../src/build/compile.ts";
import { relate } from "../src/kinship/relate.ts";
import { buildGraph } from "../src/model/graph.ts";
import type { ParentEdge, Person, Relation, Union, Vocab } from "../src/model/types.ts";
import { contextFor, graphFor, ribbonMidpoint, ribbonNodes } from "../src/viewer/ribbon.ts";

const vocab: Vocab = {
  version: 1,
  relationType: [
    { key: "friend", label: "Friend", symmetric: true },
    { key: "chosen-family", label: "Chosen family", symmetric: true },
  ],
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

function person(id: string, parents: ParentEdge[] = [], extra: Partial<Person> = {}): Person {
  return { id, names: { display: id }, status: "living", parents, meta, ...extra };
}

function compiled(people: Person[], unions: Union[] = [], relations: Relation[] = []) {
  return compile(buildGraph({ people, unions, relations, vocab }));
}

/** gran -> mum, uncle; mum -> me; uncle -> cousin */
const family = compiled(
  [
    person("gran"),
    person("mum", [birth("gran")]),
    person("uncle", [birth("gran")]),
    person("me", [birth("mum")]),
    person("cousin", [birth("uncle")]),
    person("spouse"),
    person("pal"),
  ],
  [{ id: "u-0001", partners: ["me", "spouse"], type: "marriage" }],
  [
    { id: "r-0001", type: "friend", from: "me", to: "pal", symmetric: true, status: "active" },
    {
      id: "r-0002",
      type: "chosen-family",
      from: "me",
      to: "pal",
      symmetric: true,
      status: "active",
    },
  ],
);

describe("the compiled graph adapter", () => {
  it("exposes people by id", () => {
    expect(graphFor(family).people.get("me")?.names.display).toBe("me");
  });

  it("redirects a merged id the way the loader would", () => {
    const withTombstone = compiled([
      person("karl-vogt"),
      person("uncle-karl", [], { status: "merged", mergedInto: "karl-vogt" }),
    ]);

    expect(graphFor(withTombstone).resolve("uncle-karl")).toBe("karl-vogt");
    expect(graphFor(withTombstone).resolve("karl-vogt")).toBe("karl-vogt");
  });

  it("keeps tombstones out of the visible people", () => {
    const withTombstone = compiled([
      person("karl-vogt"),
      person("uncle-karl", [], { status: "merged", mergedInto: "karl-vogt" }),
    ]);

    expect([...graphFor(withTombstone).people.keys()]).toEqual(["karl-vogt"]);
  });
});

describe("the engine runs unchanged on compiled data", () => {
  const context = contextFor(family);

  it("derives a blood term in the browser shape", () => {
    expect(relate(context, "me", "cousin")).toMatchObject({
      kind: "blood",
      term: "first cousin",
    });
  });

  it("derives a partner term", () => {
    expect(relate(context, "me", "spouse")).toMatchObject({ kind: "partner", term: "partner" });
  });

  it("answers in German", () => {
    expect(relate(context, "me", "gran", { lang: "de" }).term).toBe("Großelternteil");
  });

  it("reports chosen family separately from the term", () => {
    const found = relate(context, "me", "pal");
    expect(found.chosenFamily).toBe(true);
    expect(found.term).toBeNull();
  });
});

describe("ribbon geometry", () => {
  const context = contextFor(family);

  it("lists everyone the path touches, starting at the first person", () => {
    const found = relate(context, "me", "cousin");
    expect(ribbonNodes("me", found.path ?? [])).toEqual(["me", "mum", "gran", "uncle", "cousin"]);
  });

  it("is just the person when relating them to themselves", () => {
    const found = relate(context, "me", "me");
    expect(ribbonNodes("me", found.path ?? [])).toEqual(["me"]);
  });

  it("puts the term at the middle of an odd-length ribbon", () => {
    expect(ribbonMidpoint(["me", "mum", "gran", "uncle", "cousin"])).toBe("gran");
  });

  it("takes the later of two middles when the count is even", () => {
    expect(ribbonMidpoint(["me", "mum", "gran", "uncle"])).toBe("gran");
  });

  it("handles a single hop", () => {
    expect(ribbonMidpoint(["me", "mum"])).toBe("mum");
  });

  it("has no midpoint for an empty ribbon", () => {
    expect(ribbonMidpoint([])).toBeNull();
  });
});
