/**
 * Letters NFD cannot take apart, so stripping combining marks would otherwise drop them
 * entirely. German umlauts spell out the way German spells them; the rest fall back to the
 * base letter.
 */
const TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/g, "ae"],
  [/ö/g, "oe"],
  [/ü/g, "ue"],
  [/ß/g, "ss"],
  [/æ/g, "ae"],
  [/œ/g, "oe"],
  [/ø/g, "o"],
  [/ł/g, "l"],
  [/đ/g, "d"],
  [/ð/g, "d"],
  [/þ/g, "th"],
];

export class IdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdError";
  }
}

/**
 * Lowercase kebab slug from a display name. German umlauts expand the way German spells
 * them out; every other mark is stripped rather than expanded.
 */
export function slugify(name: string): string {
  let slug = name.toLowerCase();
  for (const [pattern, replacement] of TRANSLITERATIONS) {
    slug = slug.replace(pattern, replacement);
  }
  slug = slug
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug === "") throw new IdError(`no slug can be derived from ${JSON.stringify(name)}`);
  return slug;
}

/**
 * The slug for a new person, suffixed on collision. IDs are permanent, so this runs once at
 * creation and never again when the person's name changes.
 */
export function uniquePersonId(displayName: string, taken: Iterable<string>): string {
  const existing = new Set(taken);
  const base = slugify(displayName);
  if (!existing.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new IdError(`too many people share the slug ${base}`);
}

/**
 * The next `u-NNNN` or `r-NNNN`. Monotonic from the highest existing number so a deleted or
 * merged record never has its id handed to something else.
 */
export function nextSequentialId(prefix: "u" | "r", existing: Iterable<string>): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0;
  let width = 4;

  for (const id of existing) {
    const match = pattern.exec(id);
    if (!match) continue;
    const digits = match[1] ?? "";
    highest = Math.max(highest, Number(digits));
    width = Math.max(width, digits.length);
  }

  const next = String(highest + 1);
  return `${prefix}-${next.padStart(Math.max(width, next.length), "0")}`;
}
