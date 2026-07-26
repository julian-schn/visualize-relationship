import { describe, expect, it } from "vitest";
import { compile, type CompiledGraph } from "../src/build/compile.ts";
import { buildGraph } from "../src/model/graph.ts";
import type { ParentEdge, Person, Relation, Union, Vocab } from "../src/model/types.ts";
import { DEFAULT_DEPTH, MAX_DEPTH, egoGraph } from "../src/viewer/ego.ts";
import { nameFormsOf, searchPeople } from "../src/viewer/search.ts";

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
const birth = (id: string): ParentEdge => ({ id, kind: "birth" });

function person(id: string, parents: ParentEdge[] = [], names: Partial<Person["names"]> = {}) {
  return {
    id,
    names: { display: id, ...names },
    status: "living" as const,
    parents,
    meta,
  };
}

function graphOf(people: Person[], unions: Union[] = [], relations: Relation[] = []): CompiledGraph {
  return compile(buildGraph({ people, unions, relations, vocab }));
}

/** great-gran -> gran -> parent -> me -> kid, plus a partner and an unrelated friend */
const line = graphOf(
  [
    person("great-gran"),
    person("gran", [birth("great-gran")]),
    person("parent", [birth("gran")]),
    person("me", [birth("parent")]),
    person("kid", [birth("me")]),
    person("partner"),
    person("friend"),
  ],
  [{ id: "u-0001", partners: ["me", "partner"], type: "marriage" }],
  [
    {
      id: "r-0001",
      type: "friend",
      from: "me",
      to: "friend",
      symmetric: true,
      status: "active",
    },
  ],
);

describe("ego graph", () => {
  it("includes the focus person at distance zero", () => {
    const ego = egoGraph(line, "me", { depth: 1 });
    expect(ego.distance.get("me")).toBe(0);
  });

  it("reaches one generation each way at depth 1", () => {
    const ego = egoGraph(line, "me", { depth: 1 });
    expect([...ego.ids].sort()).toEqual(["kid", "me", "parent", "partner"]);
  });

  it("widens with depth", () => {
    expect(egoGraph(line, "me", { depth: 2 }).ids.has("gran")).toBe(true);
    expect(egoGraph(line, "me", { depth: 2 }).ids.has("great-gran")).toBe(false);
    expect(egoGraph(line, "me", { depth: 3 }).ids.has("great-gran")).toBe(true);
  });

  it("records how far out each person sits, for fading", () => {
    const ego = egoGraph(line, "me", { depth: 3 });
    expect(ego.distance.get("parent")).toBe(1);
    expect(ego.distance.get("gran")).toBe(2);
    expect(ego.distance.get("great-gran")).toBe(3);
  });

  it("leaves social ties out of the lineage shell by default", () => {
    expect(egoGraph(line, "me", { depth: 1 }).ids.has("friend")).toBe(false);
  });

  it("includes them when asked", () => {
    const ego = egoGraph(line, "me", { depth: 1, kinds: ["parentage", "union", "relation"] });
    expect(ego.ids.has("friend")).toBe(true);
  });

  it("clamps depth to the slider's range", () => {
    expect(egoGraph(line, "me", { depth: 99 }).ids).toEqual(
      egoGraph(line, "me", { depth: MAX_DEPTH }).ids,
    );
    expect(egoGraph(line, "me", { depth: 0 }).ids).toEqual(
      egoGraph(line, "me", { depth: 1 }).ids,
    );
  });

  it("never renders the whole graph just because depth is high", () => {
    const ego = egoGraph(line, "great-gran", { depth: MAX_DEPTH });
    expect(ego.ids.has("kid")).toBe(false);
  });

  it("returns just the person when they have no ties", () => {
    const alone = graphOf([person("nobody")]);
    expect([...egoGraph(alone, "nobody", { depth: DEFAULT_DEPTH }).ids]).toEqual(["nobody"]);
  });

  it("returns an empty shell for someone who does not exist", () => {
    expect(egoGraph(line, "ghost", { depth: 2 }).ids).toEqual(new Set(["ghost"]));
  });
});

describe("search", () => {
  const people = graphOf([
    person("agnes-vogt", [], {
      display: "Agnes Vogt",
      given: "Agnes",
      family: "Vogt",
      nicknames: ["Aggie"],
      aka: ["A. Vogt"],
      former: [{ display: "Agnes Bauer", until: "2014" }],
    }),
    person("karl-vogt", [], { display: "Karl Vogt", given: "Karl", family: "Vogt" }),
    person("juergen-mueller", [], { display: "Jürgen Müller" }),
    person("bea-adler", [], { display: "Bea Adler" }),
  ]).people;

  const ids = (query: string) => searchPeople(people, query).map((hit) => hit.id);

  it("finds an exact display name", () => {
    expect(ids("Agnes Vogt")[0]).toBe("agnes-vogt");
  });

  it("finds by prefix", () => {
    expect(ids("agn")[0]).toBe("agnes-vogt");
  });

  it("finds by nickname and says which form matched", () => {
    const hit = searchPeople(people, "aggie")[0];
    expect(hit?.id).toBe("agnes-vogt");
    expect(hit?.matched).toBe("Aggie");
  });

  it("finds by aka and by a former name", () => {
    expect(ids("A. Vogt")).toContain("agnes-vogt");
    expect(searchPeople(people, "bauer")[0]?.matched).toBe("Agnes Bauer");
  });

  it("matches across accents in both directions", () => {
    expect(ids("jurgen")).toContain("juergen-mueller");
    expect(ids("Jürgen")).toContain("juergen-mueller");
    expect(ids("muller")).toContain("juergen-mueller");
  });

  it("ranks a whole name above a scattered match", () => {
    const hits = searchPeople(people, "vogt");
    expect(hits[0]?.id).toBe("agnes-vogt");
    expect(hits.map((hit) => hit.id)).toContain("karl-vogt");
  });

  it("returns nothing for an empty query", () => {
    expect(searchPeople(people, "   ")).toEqual([]);
  });

  it("returns nothing when nobody matches", () => {
    expect(searchPeople(people, "zzzzz")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchPeople(people, "e", 2)).toHaveLength(2);
  });

  it("is stable for the same query", () => {
    expect(searchPeople(people, "vo")).toEqual(searchPeople(people, "vo"));
  });

  it("collects every name form", () => {
    const agnes = people.find((p) => p.id === "agnes-vogt");
    expect(agnes && nameFormsOf(agnes)).toEqual([
      "Agnes Vogt",
      "Agnes",
      "Vogt",
      "Aggie",
      "A. Vogt",
      "Agnes Bauer",
    ]);
  });
});
