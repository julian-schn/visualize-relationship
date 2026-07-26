export type DatePrecision =
  | "day"
  | "month"
  | "year"
  | "approximate"
  | "range"
  | "before"
  | "after"
  | "unknown";

/**
 * A date as an inclusive interval. `earliest` and `latest` are `YYYY-MM-DD`, so they sort
 * lexicographically; either is null when that end is open. Downstream code compares
 * intervals and never re-reads the raw string.
 */
export interface ParsedDate {
  earliest: string | null;
  latest: string | null;
  display: string;
  precision: DatePrecision;
}

export class DateParseError extends Error {
  constructor(raw: unknown) {
    super(`unparseable date: ${JSON.stringify(raw)}`);
    this.name = "DateParseError";
  }
}

const UNKNOWN: ParsedDate = {
  earliest: null,
  latest: null,
  display: "unknown",
  precision: "unknown",
};

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_LENGTHS[month - 1] ?? 0;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

interface Bounds {
  earliest: string;
  latest: string;
  precision: "day" | "month" | "year";
}

/** Bounds of one precise token: `1962-03-04`, `1962-03` or `1962`. */
function bounds(token: string): Bounds | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
  if (day) {
    const [, y = "", m = "", d = ""] = day;
    const year = Number(y);
    const month = Number(m);
    const date = Number(d);
    if (year < 1 || month < 1 || month > 12) return null;
    if (date < 1 || date > daysInMonth(year, month)) return null;
    return { earliest: token, latest: token, precision: "day" };
  }

  const month = /^(\d{4})-(\d{2})$/.exec(token);
  if (month) {
    const [, y = "", m = ""] = month;
    const year = Number(y);
    const monthNumber = Number(m);
    if (year < 1 || monthNumber < 1 || monthNumber > 12) return null;
    return {
      earliest: `${y}-${m}-01`,
      latest: `${y}-${m}-${pad(daysInMonth(year, monthNumber), 2)}`,
      precision: "month",
    };
  }

  const year = /^(\d{4})$/.exec(token);
  if (year) {
    const [, y = ""] = year;
    if (Number(y) < 1) return null;
    return { earliest: `${y}-01-01`, latest: `${y}-12-31`, precision: "year" };
  }

  return null;
}

/** Returns null when `raw` is outside the EDTF subset in AGENTS.md section 7. */
export function tryParseDate(raw: string | null | undefined): ParsedDate | null {
  if (raw === null || raw === undefined) return UNKNOWN;
  if (raw === "" || raw !== raw.trim()) return null;

  if (raw.endsWith("~")) {
    const year = /^(\d{4})$/.exec(raw.slice(0, -1));
    if (!year) return null;
    const [, y = ""] = year;
    const value = Number(y);
    // Spanning a year either side must not reach back past year 1.
    if (value < 2) return null;
    return {
      earliest: `${pad(value - 1, 4)}-01-01`,
      latest: `${pad(value + 1, 4)}-12-31`,
      display: `c. ${y}`,
      precision: "approximate",
    };
  }

  if (raw.startsWith("..")) {
    const token = raw.slice(2);
    const end = bounds(token);
    if (!end) return null;
    return {
      earliest: null,
      latest: end.latest,
      display: `before ${token}`,
      precision: "before",
    };
  }

  if (raw.endsWith("..")) {
    const token = raw.slice(0, -2);
    const start = bounds(token);
    if (!start) return null;
    return {
      earliest: start.earliest,
      latest: null,
      display: `after ${token}`,
      precision: "after",
    };
  }

  if (raw.includes("/")) {
    const parts = raw.split("/");
    if (parts.length !== 2) return null;
    const [from = "", to = ""] = parts;
    const start = bounds(from);
    const end = bounds(to);
    if (!start || !end) return null;
    if (start.earliest > end.latest) return null;
    return {
      earliest: start.earliest,
      latest: end.latest,
      display: `${from}–${to}`,
      precision: "range",
    };
  }

  const precise = bounds(raw);
  if (!precise) return null;
  return {
    earliest: precise.earliest,
    latest: precise.latest,
    display: raw,
    precision: precise.precision,
  };
}

export function parseDate(raw: string | null | undefined): ParsedDate {
  const parsed = tryParseDate(raw);
  if (!parsed) throw new DateParseError(raw);
  return parsed;
}
