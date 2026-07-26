import { describe, expect, it } from "vitest";
import { IdError, nextSequentialId, slugify, uniquePersonId } from "../src/model/id.ts";

describe("slugify", () => {
  it("makes a lowercase kebab slug", () => {
    expect(slugify("Agnes Vogt")).toBe("agnes-vogt");
  });

  it("spells out German umlauts", () => {
    expect(slugify("Jürgen Müller")).toBe("juergen-mueller");
    expect(slugify("Käthe Schröder")).toBe("kaethe-schroeder");
    expect(slugify("Weiß")).toBe("weiss");
    expect(slugify("Änne Öhler Übel")).toBe("aenne-oehler-uebel");
  });

  it("strips combining diacritics rather than expanding them", () => {
    expect(slugify("Zoë Renée")).toBe("zoe-renee");
    expect(slugify("Åsa Håkansson")).toBe("asa-hakansson");
  });

  it("keeps letters NFD cannot decompose", () => {
    expect(slugify("Łukasz Kowalczyk")).toBe("lukasz-kowalczyk");
    expect(slugify("Søren Kjær")).toBe("soren-kjaer");
    expect(slugify("Þóra Eðvarðsdóttir")).toBe("thora-edvardsdottir");
  });

  it("collapses punctuation and whitespace", () => {
    expect(slugify("  Anna-Maria  O'Brien ")).toBe("anna-maria-o-brien");
    expect(slugify("Dr. Karl Vogt jr.")).toBe("dr-karl-vogt-jr");
  });

  it("keeps digits", () => {
    expect(slugify("Karl Vogt II 2")).toBe("karl-vogt-ii-2");
  });

  it("refuses a name with nothing sluggable in it", () => {
    expect(() => slugify("...")).toThrow(IdError);
    expect(() => slugify("")).toThrow(IdError);
    expect(() => slugify("你好")).toThrow(IdError);
  });
});

describe("uniquePersonId", () => {
  it("uses the bare slug when it is free", () => {
    expect(uniquePersonId("Karl Vogt", [])).toBe("karl-vogt");
  });

  it("suffixes from 2 on collision", () => {
    expect(uniquePersonId("Karl Vogt", ["karl-vogt"])).toBe("karl-vogt-2");
    expect(uniquePersonId("Karl Vogt", ["karl-vogt", "karl-vogt-2"])).toBe("karl-vogt-3");
  });

  it("skips a suffix that is already taken", () => {
    expect(uniquePersonId("Karl Vogt", ["karl-vogt", "karl-vogt-3"])).toBe("karl-vogt-2");
  });
});

describe("nextSequentialId", () => {
  it("starts at four padded digits", () => {
    expect(nextSequentialId("u", [])).toBe("u-0001");
    expect(nextSequentialId("r", [])).toBe("r-0001");
  });

  it("counts from the highest existing number, not the count", () => {
    expect(nextSequentialId("u", ["u-0001", "u-0007", "u-0003"])).toBe("u-0008");
  });

  it("never reuses the id of a removed record", () => {
    expect(nextSequentialId("r", ["r-0001", "r-0009"])).toBe("r-0010");
  });

  it("ignores ids belonging to the other prefix", () => {
    expect(nextSequentialId("u", ["r-0042", "u-0002"])).toBe("u-0003");
  });

  it("grows past four digits without renumbering", () => {
    expect(nextSequentialId("r", ["r-9999"])).toBe("r-10000");
    expect(nextSequentialId("r", ["r-10000"])).toBe("r-10001");
  });
});
