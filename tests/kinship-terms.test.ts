import { describe, expect, it } from "vitest";
import type { Kinship } from "../src/kinship/derive.ts";
import { termFor } from "../src/kinship/term.ts";
import { de } from "../src/kinship/terms.de.ts";
import { en } from "../src/kinship/terms.en.ts";

const tie = (up: number, down: number, extra: Partial<Kinship> = {}): Kinship => ({
  up,
  down,
  through: [],
  full: true,
  byBirth: true,
  ...extra,
});

const term = (up: number, down: number, extra: Partial<Kinship> = {}) =>
  termFor(tie(up, down, extra));

const german = (up: number, down: number, extra: Partial<Kinship> = {}) =>
  termFor(tie(up, down, extra), { lang: "de" });

describe("the direct line", () => {
  it("names ancestors", () => {
    expect(term(1, 0)).toBe("parent");
    expect(term(2, 0)).toBe("grandparent");
    expect(term(3, 0)).toBe("great-grandparent");
    expect(term(4, 0)).toBe("great-great-grandparent");
  });

  it("names descendants", () => {
    expect(term(0, 1)).toBe("child");
    expect(term(0, 2)).toBe("grandchild");
    expect(term(0, 3)).toBe("great-grandchild");
  });

  it("names them in German", () => {
    expect(german(1, 0)).toBe("Elternteil");
    expect(german(2, 0)).toBe("Großelternteil");
    expect(german(3, 0)).toBe("Urgroßelternteil");
    expect(german(4, 0)).toBe("Ururgroßelternteil");
    expect(german(5, 0)).toBe("Urururgroßelternteil");
    expect(german(0, 1)).toBe("Kind");
    expect(german(0, 2)).toBe("Enkelkind");
    expect(german(0, 3)).toBe("Urenkelkind");
    expect(german(0, 4)).toBe("Ururenkelkind");
  });
});

describe("siblings", () => {
  it("distinguishes full from half", () => {
    expect(term(1, 1)).toBe("sibling");
    expect(term(1, 1, { full: false })).toBe("half-sibling");
  });

  it("does so in German", () => {
    expect(german(1, 1)).toBe("Geschwisterteil");
    expect(german(1, 1, { full: false })).toBe("Halbgeschwisterteil");
  });
});

describe("the collateral line", () => {
  it("names a parent's sibling and their descendants", () => {
    expect(term(2, 1)).toBe("parent's sibling");
    expect(term(3, 1)).toBe("grandparent's sibling");
    expect(term(4, 1)).toBe("great-grandparent's sibling");
    expect(term(1, 2)).toBe("sibling's child");
    expect(term(1, 3)).toBe("sibling's grandchild");
  });

  it("uses paired forms in German, which has no neutral singular here", () => {
    expect(german(2, 1)).toBe("Tante oder Onkel");
    expect(german(3, 1)).toBe("Großtante oder Großonkel");
    expect(german(4, 1)).toBe("Urgroßtante oder Urgroßonkel");
    expect(german(1, 2)).toBe("Nichte oder Neffe");
    expect(german(1, 3)).toBe("Großnichte oder Großneffe");
    expect(german(1, 4)).toBe("Urgroßnichte oder Urgroßneffe");
  });
});

describe("cousins", () => {
  it("counts degree and remove", () => {
    expect(term(2, 2)).toBe("first cousin");
    expect(term(3, 3)).toBe("second cousin");
    expect(term(4, 4)).toBe("third cousin");
    expect(term(3, 2)).toBe("first cousin once removed");
    expect(term(2, 3)).toBe("first cousin once removed");
    expect(term(4, 2)).toBe("first cousin twice removed");
    expect(term(4, 3)).toBe("second cousin once removed");
    expect(term(5, 2)).toBe("first cousin three times removed");
  });

  it("counts them in German", () => {
    expect(german(2, 2)).toBe("Cousine oder Cousin ersten Grades");
    expect(german(3, 3)).toBe("Cousine oder Cousin zweiten Grades");
    expect(german(3, 2)).toBe("Cousine oder Cousin ersten Grades, eine Generation entfernt");
    expect(german(4, 2)).toBe("Cousine oder Cousin ersten Grades, zwei Generationen entfernt");
  });

  it("stays sane far out", () => {
    expect(term(9, 9)).toBe("eighth cousin");
    expect(term(10, 10)).toBe("9th cousin");
  });
});

describe("adoptive kin", () => {
  it("uses the plain term by default", () => {
    expect(termFor(tie(1, 0, { byBirth: false }))).toBe("parent");
  });

  it("marks the distinction only when asked", () => {
    expect(termFor(tie(1, 0, { byBirth: false }), { distinguishNotByBirth: true })).toBe(
      "parent (not by birth)",
    );
    expect(termFor(tie(1, 0, { byBirth: false }), { distinguishNotByBirth: true, lang: "de" })).toBe(
      "Elternteil (nicht leiblich)",
    );
  });

  it("does not mark a birth tie", () => {
    expect(termFor(tie(1, 0), { distinguishNotByBirth: true })).toBe("parent");
  });
});

describe("elective and ended ties", () => {
  it("names partners and ex-partners", () => {
    expect(en.partner("current")).toBe("partner");
    expect(en.partner("former")).toBe("ex-partner");
    expect(de.partner("current")).toBe("Partnerin oder Partner");
    expect(de.partner("former")).toBe("Ex-Partnerin oder Ex-Partner");
  });

  it("names step relations and former ones", () => {
    expect(en.step("parent", false)).toBe("step-parent");
    expect(en.step("parent", true)).toBe("former step-parent");
    expect(en.step("sibling", false)).toBe("step-sibling");
    expect(de.step("parent", false)).toBe("Stiefelternteil");
    expect(de.step("parent", true)).toBe("Ex-Stiefelternteil");
    expect(de.step("child", true)).toBe("Ex-Stiefkind");
  });

  it("names in-laws", () => {
    expect(en.inLaw("parent")).toBe("parent-in-law");
    expect(en.inLaw("sibling")).toBe("sibling-in-law");
    expect(de.inLaw("parent")).toBe("Schwiegerelternteil");
    expect(de.inLaw("child")).toBe("Schwiegerkind");
    expect(de.inLaw("sibling")).toBe("Schwägerin oder Schwager");
  });
});

describe("no term carries a gender", () => {
  const gendered = [
    "brother", "sister", "aunt", "uncle", "niece", "nephew",
    "mother", "father", "son", "daughter", "husband", "wife",
    "grandmother", "grandfather", "grandson", "granddaughter",
  ];

  it("avoids gendered English words", () => {
    const produced = [
      ...[1, 2, 3, 4].flatMap((n) => [term(n, 0), term(0, n), term(n, 1), term(1, n)]),
      term(1, 1),
      term(1, 1, { full: false }),
      term(2, 2),
      term(3, 2),
      en.partner("current"),
      en.partner("former"),
      en.step("parent", false),
      en.inLaw("parent"),
      en.chosenFamily,
    ];

    for (const phrase of produced) {
      for (const word of gendered) {
        expect(phrase.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("pairs both forms in German wherever it cannot be neutral", () => {
    // If a German term mentions one of a gendered pair it must mention the other.
    const pairs: [string, string][] = [
      ["Tante", "Onkel"],
      ["Nichte", "Neffe"],
      ["Cousine", "Cousin"],
      ["Schwägerin", "Schwager"],
      ["Partnerin", "Partner"],
    ];

    const produced = [
      ...[1, 2, 3, 4].flatMap((n) => [german(n, 0), german(0, n), german(n, 1), german(1, n)]),
      german(1, 1),
      german(2, 2),
      german(3, 2),
      de.partner("current"),
      de.partner("former"),
      de.inLaw("sibling"),
    ];

    for (const phrase of produced) {
      for (const [feminine, masculine] of pairs) {
        if (!phrase.includes(feminine)) continue;
        expect(phrase).toContain(masculine);
      }
    }
  });
});
