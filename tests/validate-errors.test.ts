import { beforeAll, describe, expect, it } from "vitest";
import type { RawRecords, SourceFile } from "../src/model/load.ts";
import type { Person, Relation, Union, Vocab } from "../src/model/types.ts";
import { checkStructure, type ValidRecords } from "../src/validate/errors.ts";
import { validateRecords } from "../src/validate/index.ts";
import { loadValidators, type Validators } from "../src/validate/schema.ts";

let validators: Validators;

beforeAll(async () => {
  validators = await loadValidators(process.cwd());
});

const vocab: Vocab = {
  version: 1,
  relationType: [
    { key: "friend", label: "Friend", symmetric: true },
    { key: "mentor", label: "Mentor", symmetric: false, inverse: "mentee" },
  ],
  parentKind: [
    { key: "birth", label: "Birth" },
    { key: "adoptive", label: "Adoptive" },
  ],
  unionType: [{ key: "marriage", label: "Marriage" }],
  unionEnd: [{ key: "divorce", label: "Divorce" }],
  relationStatus: [{ key: "active", label: "Active" }],
  context: [{ key: "work", label: "Work" }],
  tag: [{ key: "maternal-side", label: "Maternal side" }],
};

const TODAY = "2026-07-26";

const meta = { created: "2026-07-26", updated: "2026-07-26", author: "agent" as const };

function personFile(id: string, extra: Partial<Person> = {}): SourceFile<Person> {
  return {
    path: `people/${id}.json`,
    stem: id,
    record: { id, names: { display: id }, status: "living", meta, ...extra },
  };
}

function unionFile(id: string, extra: Partial<Union> = {}): SourceFile<Union> {
  return {
    path: `unions/${id}.json`,
    stem: id,
    record: { id, partners: [], type: "marriage", ...extra },
  };
}

function relationFile(id: string, extra: Partial<Relation> = {}): SourceFile<Relation> {
  return {
    path: `relations/${id}.json`,
    stem: id,
    record: {
      id,
      type: "friend",
      from: "a",
      to: "b",
      symmetric: true,
      status: "active",
      ...extra,
    },
  };
}

function check(records: Partial<RawRecords>): ReturnType<typeof validateRecords> {
  return validateRecords(
    { people: [], unions: [], relations: [], notes: [], vocab, ...records },
    validators,
    { today: TODAY },
  );
}

const rules = (records: Partial<RawRecords>): string[] =>
  check(records)
    .filter((finding) => finding.level === "error")
    .map((finding) => finding.rule);

describe("clean data", () => {
  it("reports nothing for a valid set of records", () => {
    const findings = check({
      people: [
        personFile("karl-vogt", { birth: { date: "1930" } }),
        personFile("agnes-vogt", {
          birth: { date: "1962-03-04" },
          parents: [{ id: "karl-vogt", kind: "birth" }],
        }),
      ],
      unions: [unionFile("u-0001", { partners: ["karl-vogt", "agnes-vogt"] })],
      relations: [
        relationFile("r-0001", { from: "karl-vogt", to: "agnes-vogt", context: ["work"] }),
      ],
    });

    expect(findings.filter((finding) => finding.level === "error")).toEqual([]);
  });
});

describe("schema errors", () => {
  it("reports a record that does not match its schema", () => {
    const broken = personFile("agnes-vogt");
    // pronouns must be an array of non-empty strings
    (broken.record as unknown as Record<string, unknown>)["pronouns"] = "she/her";

    const findings = check({ people: [broken] });

    expect(findings[0]?.rule).toBe("schema");
    expect(findings[0]?.where).toBe("people/agnes-vogt.json");
  });

  it("skips later rules for a record that failed its schema", () => {
    const broken = personFile("wrong-name");
    (broken.record as unknown as Record<string, unknown>)["sex"] = "female";

    // The filename disagrees with the id too, but the record never reaches that rule.
    expect(rules({ people: [broken] })).toEqual(["schema"]);
  });

  it("reports a broken vocabulary and skips the rules that depend on it", () => {
    // The union itself is schema-valid, so its unknown type would normally be reported.
    const findings = validateRecords(
      {
        people: [personFile("a")],
        unions: [unionFile("u-0001", { partners: ["a"], type: "not-a-key" })],
        relations: [],
        notes: [],
        vocab: { version: 1 } as unknown as Vocab,
      },
      validators,
      { today: TODAY },
    );

    expect(findings.every((finding) => finding.rule === "schema")).toBe(true);
    expect(findings.every((finding) => finding.where === "vocab.json")).toBe(true);
    expect(findings.some((finding) => finding.rule === "unknown-vocabulary")).toBe(false);
  });
});

describe("filenames and ids", () => {
  it("reports a filename that does not equal the id", () => {
    const file = personFile("agnes-vogt");
    file.stem = "agnes";
    file.path = "people/agnes.json";

    expect(rules({ people: [file] })).toContain("filename-id-mismatch");
  });

  it("reports a duplicate id", () => {
    const first = personFile("agnes-vogt");
    const second = personFile("agnes-vogt");
    second.path = "people/agnes-vogt-copy.json";
    second.stem = "agnes-vogt-copy";

    expect(rules({ people: [first, second] })).toContain("duplicate-id");
  });
});

describe("references", () => {
  it("reports a dangling parent", () => {
    expect(
      rules({ people: [personFile("a", { parents: [{ id: "ghost", kind: "birth" }] })] }),
    ).toContain("dangling-reference");
  });

  it("reports a dangling partner", () => {
    expect(rules({ unions: [unionFile("u-0001", { partners: ["ghost"] })] })).toContain(
      "dangling-reference",
    );
  });

  it("reports dangling relation endpoints", () => {
    const findings = check({
      people: [personFile("a")],
      relations: [relationFile("r-0001", { from: "a", to: "ghost" })],
    });

    expect(findings.filter((f) => f.rule === "dangling-reference")).toHaveLength(1);
  });

  it("reports a dangling merge target", () => {
    expect(
      rules({ people: [personFile("a", { status: "merged", mergedInto: "ghost" })] }),
    ).toContain("dangling-reference");
  });

  it("accepts a reference to a tombstone", () => {
    expect(
      rules({
        people: [
          personFile("karl-vogt"),
          personFile("uncle-karl", { status: "merged", mergedInto: "karl-vogt" }),
          personFile("agnes", { parents: [{ id: "uncle-karl", kind: "birth" }] }),
        ],
      }),
    ).toEqual([]);
  });

  it("reports a self-merge", () => {
    expect(rules({ people: [personFile("a", { status: "merged", mergedInto: "a" })] })).toContain(
      "self-merge",
    );
  });

  it("reports a merge cycle", () => {
    expect(
      rules({
        people: [
          personFile("a", { status: "merged", mergedInto: "b" }),
          personFile("b", { status: "merged", mergedInto: "a" }),
        ],
      }),
    ).toContain("merge-cycle");
  });
});

describe("people as their own kin", () => {
  it("reports someone listed as their own parent", () => {
    expect(rules({ people: [personFile("a", { parents: [{ id: "a", kind: "birth" }] })] })).toContain(
      "self-parent",
    );
  });

  it("reports two partners who are the same person after merging", () => {
    expect(
      rules({
        people: [
          personFile("karl-vogt"),
          personFile("uncle-karl", { status: "merged", mergedInto: "karl-vogt" }),
        ],
        unions: [unionFile("u-0001", { partners: ["karl-vogt", "uncle-karl"] })],
      }),
    ).toContain("self-partner");
  });

  it("reports a parent who is the person themselves after merging", () => {
    expect(
      rules({
        people: [
          personFile("karl-vogt", { parents: [{ id: "uncle-karl", kind: "birth" }] }),
          personFile("uncle-karl", { status: "merged", mergedInto: "karl-vogt" }),
        ],
      }),
    ).toContain("self-parent");
  });
});

describe("rules the schema already enforces", () => {
  // The schema rejects these outright, so records carrying them never reach checkStructure
  // through validateRecords. Calling it directly keeps the net in place if the schema is
  // ever relaxed.
  const structural = (records: Partial<ValidRecords>): string[] =>
    checkStructure({ people: [], unions: [], relations: [], vocab, ...records }).map((f) => f.rule);

  it("reports a union with no partners", () => {
    expect(structural({ unions: [unionFile("u-0001", { partners: [] })] })).toContain(
      "empty-union",
    );
  });

  it("reports the same id listed twice in one union", () => {
    expect(
      structural({
        people: [personFile("a")],
        unions: [unionFile("u-0001", { partners: ["a", "a"] })],
      }),
    ).toContain("self-partner");
  });

  it("is caught by the schema through the normal path", () => {
    expect(rules({ unions: [unionFile("u-0001", { partners: [] })] })).toEqual(["schema"]);
  });
});

describe("unions", () => {
  it("accepts a union with one partner", () => {
    expect(
      rules({ people: [personFile("a")], unions: [unionFile("u-0001", { partners: ["a"] })] }),
    ).toEqual([]);
  });

  it("accepts a union with three partners", () => {
    expect(
      rules({
        people: [personFile("a"), personFile("b"), personFile("c")],
        unions: [unionFile("u-0001", { partners: ["a", "b", "c"] })],
      }),
    ).toEqual([]);
  });
});

describe("vocabulary", () => {
  it("reports an unknown parent kind", () => {
    expect(
      rules({
        people: [personFile("a"), personFile("b", { parents: [{ id: "a", kind: "invented" }] })],
      }),
    ).toContain("unknown-vocabulary");
  });

  it("reports an unknown union type, end reason, tag and context", () => {
    const findings = check({
      people: [personFile("a", { tags: ["invented"] }), personFile("b")],
      unions: [
        unionFile("u-0001", { partners: ["a"], type: "invented", endReason: "invented" }),
      ],
      relations: [relationFile("r-0001", { from: "a", to: "b", context: ["invented"] })],
    });

    expect(findings.filter((f) => f.rule === "unknown-vocabulary")).toHaveLength(4);
  });

  it("accepts a null end reason on an ongoing union", () => {
    expect(
      rules({
        people: [personFile("a")],
        unions: [unionFile("u-0001", { partners: ["a"], endReason: null })],
      }),
    ).toEqual([]);
  });
});

describe("symmetry", () => {
  it("reports a relation that disagrees with its vocabulary entry", () => {
    expect(
      rules({
        people: [personFile("a"), personFile("b")],
        relations: [relationFile("r-0001", { type: "mentor", symmetric: true })],
      }),
    ).toContain("symmetry-mismatch");
  });

  it("accepts two opposing asymmetric views of the same tie", () => {
    expect(
      rules({
        people: [personFile("a"), personFile("b")],
        relations: [
          relationFile("r-0001", { type: "mentor", from: "a", to: "b", symmetric: false }),
          relationFile("r-0002", { type: "mentor", from: "b", to: "a", symmetric: false }),
        ],
      }),
    ).toEqual([]);
  });

  it("does not add a symmetry finding on top of an unknown type", () => {
    const findings = check({
      people: [personFile("a"), personFile("b")],
      relations: [relationFile("r-0001", { type: "invented", symmetric: false })],
    });

    expect(findings.map((f) => f.rule)).toEqual(["unknown-vocabulary"]);
  });
});

describe("dates", () => {
  it("reports an unparseable birth date", () => {
    expect(rules({ people: [personFile("a", { birth: { date: "around 1890" } })] })).toContain(
      "unparseable-date",
    );
  });

  it("reports an unparseable union and relation date", () => {
    const findings = check({
      people: [personFile("a"), personFile("b")],
      unions: [unionFile("u-0001", { partners: ["a"], from: "spring 1988" })],
      relations: [relationFile("r-0001", { since: "ages ago" })],
    });

    expect(findings.filter((f) => f.rule === "unparseable-date")).toHaveLength(2);
  });

  it("reports an unparseable former-name date", () => {
    expect(
      rules({
        people: [
          personFile("a", { names: { display: "A", former: [{ display: "B", until: "later" }] } }),
        ],
      }),
    ).toContain("unparseable-date");
  });

  it("accepts every form in the section 7 table", () => {
    expect(
      rules({
        people: [
          personFile("a", { birth: { date: "1890~" }, death: { date: "1962-03-04" } }),
          personFile("b", { birth: { date: "1890/1895" }, death: { date: null } }),
          personFile("c", { birth: { date: "..1900" } }),
          personFile("d", { birth: { date: "1900.." } }),
        ],
      }),
    ).toEqual([]);
  });
});

describe("parentage cycles", () => {
  it("reports a person who is their own grandparent", () => {
    expect(
      rules({
        people: [
          personFile("a", { parents: [{ id: "b", kind: "birth" }] }),
          personFile("b", { parents: [{ id: "c", kind: "birth" }] }),
          personFile("c", { parents: [{ id: "a", kind: "birth" }] }),
        ],
      }),
    ).toContain("parentage-cycle");
  });

  it("reports a cycle once rather than once per member", () => {
    const findings = check({
      people: [
        personFile("a", { parents: [{ id: "b", kind: "birth" }] }),
        personFile("b", { parents: [{ id: "a", kind: "birth" }] }),
      ],
    });

    expect(findings.filter((f) => f.rule === "parentage-cycle")).toHaveLength(1);
  });

  it("accepts a diamond, which is not a cycle", () => {
    expect(
      rules({
        people: [
          personFile("grandparent"),
          personFile("mother", { parents: [{ id: "grandparent", kind: "birth" }] }),
          personFile("father", { parents: [{ id: "grandparent", kind: "birth" }] }),
          personFile("child", {
            parents: [
              { id: "mother", kind: "birth" },
              { id: "father", kind: "birth" },
            ],
          }),
        ],
      }),
    ).toEqual([]);
  });
});

describe("report shape", () => {
  it("puts errors before warnings and is stable across runs", () => {
    const records: Partial<RawRecords> = {
      people: [personFile("b", { parents: [{ id: "ghost", kind: "birth" }] }), personFile("a")],
    };

    const first = check(records);
    const second = check(records);

    expect(first).toEqual(second);
    const levels = first.map((finding) => finding.level);
    expect([...levels].sort((x, y) => (x === "error" ? -1 : 1) - (y === "error" ? -1 : 1))).toEqual(
      levels,
    );
  });
});
