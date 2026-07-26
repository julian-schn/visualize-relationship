import { describe, expect, it } from "vitest";
import { DateParseError, parseDate, tryParseDate } from "../src/model/date.ts";

describe("the section 7 table", () => {
  it("reads an exact day", () => {
    expect(parseDate("1962-03-04")).toEqual({
      earliest: "1962-03-04",
      latest: "1962-03-04",
      display: "1962-03-04",
      precision: "day",
    });
  });

  it("spans a month", () => {
    expect(parseDate("1962-03")).toEqual({
      earliest: "1962-03-01",
      latest: "1962-03-31",
      display: "1962-03",
      precision: "month",
    });
  });

  it("spans a year", () => {
    expect(parseDate("1962")).toEqual({
      earliest: "1962-01-01",
      latest: "1962-12-31",
      display: "1962",
      precision: "year",
    });
  });

  it("spans one calendar year either side of an approximate year", () => {
    expect(parseDate("1890~")).toEqual({
      earliest: "1889-01-01",
      latest: "1891-12-31",
      display: "c. 1890",
      precision: "approximate",
    });
  });

  it("reads a range", () => {
    expect(parseDate("1890/1895")).toEqual({
      earliest: "1890-01-01",
      latest: "1895-12-31",
      display: "1890–1895",
      precision: "range",
    });
  });

  it("leaves the earliest end open for before", () => {
    expect(parseDate("..1900")).toEqual({
      earliest: null,
      latest: "1900-12-31",
      display: "before 1900",
      precision: "before",
    });
  });

  it("leaves the latest end open for after", () => {
    expect(parseDate("1900..")).toEqual({
      earliest: "1900-01-01",
      latest: null,
      display: "after 1900",
      precision: "after",
    });
  });

  it("treats null and a missing field as unknown", () => {
    const unknown = {
      earliest: null,
      latest: null,
      display: "unknown",
      precision: "unknown",
    };
    expect(parseDate(null)).toEqual(unknown);
    expect(parseDate(undefined)).toEqual(unknown);
  });
});

describe("month lengths", () => {
  it("ends February on the 28th in a common year", () => {
    expect(parseDate("1900-02").latest).toBe("1900-02-28");
  });

  it("ends February on the 29th in a leap year", () => {
    expect(parseDate("2000-02").latest).toBe("2000-02-29");
    expect(parseDate("1996-02").latest).toBe("1996-02-29");
  });

  it("accepts a real leap day and rejects a fake one", () => {
    expect(parseDate("2000-02-29").precision).toBe("day");
    expect(tryParseDate("1900-02-29")).toBeNull();
    expect(tryParseDate("2001-02-30")).toBeNull();
    expect(tryParseDate("2001-04-31")).toBeNull();
  });
});

describe("ranges", () => {
  it("accepts a single-year range", () => {
    expect(parseDate("1890/1890")).toMatchObject({
      earliest: "1890-01-01",
      latest: "1890-12-31",
    });
  });

  it("accepts precise endpoints", () => {
    expect(parseDate("1890-03/1895-06-15")).toMatchObject({
      earliest: "1890-03-01",
      latest: "1895-06-15",
    });
  });

  it("rejects a range that runs backwards", () => {
    expect(tryParseDate("1895/1890")).toBeNull();
  });

  it("rejects more than two endpoints", () => {
    expect(tryParseDate("1890/1895/1900")).toBeNull();
  });
});

describe("everything outside the subset is unparseable", () => {
  const rejected = [
    "",
    " ",
    " 1962",
    "1962 ",
    "62",
    "19620304",
    "1962-3-4",
    "04.03.1962",
    "March 1962",
    "1890..1895",
    "..",
    "~",
    "1890-03~",
    "0000",
    "0000-01-01",
    "1962-13",
    "1962-00",
    "circa 1890",
    "before 1900",
    "1890?",
  ];

  for (const raw of rejected) {
    it(`rejects ${JSON.stringify(raw)}`, () => {
      expect(tryParseDate(raw)).toBeNull();
    });
  }

  it("throws from parseDate and names the input", () => {
    expect(() => parseDate("circa 1890")).toThrow(DateParseError);
    expect(() => parseDate("circa 1890")).toThrow('"circa 1890"');
  });
});

describe("intervals sort as strings", () => {
  it("orders bounds lexicographically", () => {
    const dates = ["1962-03-04", "1890/1895", "1900..", "1889-12-31"];
    const earliest = dates
      .map((raw) => parseDate(raw).earliest)
      .filter((value): value is string => value !== null)
      .sort();
    expect(earliest).toEqual([
      "1889-12-31",
      "1890-01-01",
      "1900-01-01",
      "1962-03-04",
    ]);
  });
});
