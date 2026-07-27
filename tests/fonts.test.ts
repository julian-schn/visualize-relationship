import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FACES, FONT_DIR } from "../src/build/build.ts";

/**
 * The shipped faces once turned out to be Google's latin-ext subsets rather than its latin
 * ones: cmap segments running U+0020, U+00A0, U+0100 upwards, so not one ASCII letter and no
 * umlaut in any of them. Nothing failed. The build inlined them, the page opened, and every
 * glyph fell back to system-ui while 58K of base64 rode along painting nothing.
 *
 * Section 9: a rule that can be a validator should be one, because agents forget and CI does
 * not. So the woff2 is decoded far enough to read its character map and the coverage is
 * asserted, rather than the filename being taken at its word.
 */

/** The woff2 known-table list. An index of 63 means the four-byte tag follows inline. */
const TABLE_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

/** Signature, flavor, length, numTables, reserved, totalSfntSize, and the rest of the header. */
const HEADER_BYTES = 48;

interface Cursor {
  offset: number;
}

/** UIntBase128, big-endian, seven bits a byte, high bit continues. */
function readBase128(buffer: Buffer, cursor: Cursor): number {
  let value = 0;

  for (let i = 0; i < 5; i++) {
    const byte = buffer.readUInt8(cursor.offset++);
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }

  throw new Error("malformed UIntBase128");
}

/**
 * The compressed stream holds every table back to back in directory order, so a table is
 * found by summing the lengths of the ones declared before it. glyf and loca inverst the
 * transform flag: for them 0 means transformed, for everything else it means untouched.
 */
function readTable(woff2: Buffer, want: string): Buffer {
  const numTables = woff2.readUInt16BE(12);
  const cursor: Cursor = { offset: HEADER_BYTES };
  const directory: { tag: string; length: number }[] = [];

  for (let i = 0; i < numTables; i++) {
    const flags = woff2.readUInt8(cursor.offset++);
    const index = flags & 0x3f;

    let tag: string;
    if (index === 63) {
      tag = woff2.toString("latin1", cursor.offset, cursor.offset + 4);
      cursor.offset += 4;
    } else {
      tag = TABLE_TAGS[index] ?? `unknown-${index}`;
    }

    const original = readBase128(woff2, cursor);
    const version = (flags >> 6) & 0x3;
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;

    directory.push({ tag, length: transformed ? readBase128(woff2, cursor) : original });
  }

  const tables = brotliDecompressSync(woff2.subarray(cursor.offset));

  let start = 0;
  for (const entry of directory) {
    if (entry.tag === want) return tables.subarray(start, start + entry.length);
    start += entry.length;
  }

  throw new Error(`no ${want} table`);
}

function readFormat4(cmap: Buffer, offset: number, covered: Set<number>): void {
  const segments = cmap.readUInt16BE(offset + 6) / 2;
  const ends = offset + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;

  for (let segment = 0; segment < segments; segment++) {
    const first = cmap.readUInt16BE(starts + segment * 2);
    const last = cmap.readUInt16BE(ends + segment * 2);
    const delta = cmap.readInt16BE(deltas + segment * 2);
    const rangeOffset = cmap.readUInt16BE(ranges + segment * 2);

    // The final segment is the required 0xffff terminator and maps nothing.
    if (first === 0xffff) continue;

    for (let code = first; code <= last; code++) {
      let glyph: number;

      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const at = ranges + segment * 2 + rangeOffset + (code - first) * 2;
        if (at + 1 >= cmap.length) continue;
        glyph = cmap.readUInt16BE(at);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }

      // Glyph 0 is .notdef: the segment spans the codepoint but the font has no shape for it.
      if (glyph !== 0) covered.add(code);
    }
  }
}

function readFormat12(cmap: Buffer, offset: number, covered: Set<number>): void {
  const groups = cmap.readUInt32BE(offset + 12);

  for (let group = 0; group < groups; group++) {
    const at = offset + 16 + group * 12;
    const last = cmap.readUInt32BE(at + 4);
    for (let code = cmap.readUInt32BE(at); code <= last; code++) covered.add(code);
  }
}

export function coveredCodepoints(woff2: Buffer): Set<number> {
  const cmap = readTable(woff2, "cmap");
  const covered = new Set<number>();

  const subtables = cmap.readUInt16BE(2);
  for (let i = 0; i < subtables; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);

    // Unicode (platform 0) or Windows BMP / full repertoire (platform 3, encoding 1 or 10).
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;

    const offset = cmap.readUInt32BE(8 + i * 8);
    const format = cmap.readUInt16BE(offset);

    if (format === 4) readFormat4(cmap, offset, covered);
    else if (format === 12) readFormat12(cmap, offset, covered);
  }

  return covered;
}

/**
 * Everything the viewer can put on screen in a self-hosted face. Printable ASCII covers the
 * names and the English terms; the German set is what terms.de.ts needs and is exactly what
 * latin-ext lacks; the en dash and the curly apostrophe appear in the chrome in style.css.
 */
const REQUIRED = [
  ...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => 0x20 + i),
  ...[..."äöüÄÖÜß–’"].map((character) => character.codePointAt(0) ?? 0),
];

function show(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")} ${String.fromCodePoint(code)}`;
}

describe("the self-hosted faces", () => {
  for (const face of FACES) {
    it(`${face.file} covers what the viewer draws`, async () => {
      const woff2 = await readFile(join(process.cwd(), FONT_DIR, face.file));
      const covered = coveredCodepoints(woff2);

      expect(REQUIRED.filter((code) => !covered.has(code)).map(show)).toEqual([]);
    });
  }
});
