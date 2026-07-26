import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { format, hasErrors, validateRepo } from "../src/validate/index.ts";
import { error, warning } from "../src/validate/report.ts";

const TODAY = "2026-07-26";

let root: string;

const meta = { created: "2026-07-26", updated: "2026-07-26", author: "agent" };

async function write(relative: string, contents: unknown): Promise<void> {
  const path = join(root, relative);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(
    path,
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2),
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "graph-validate-"));
  await cp(join(process.cwd(), "schema"), join(root, "schema"), { recursive: true });
  await cp(join(process.cwd(), "vocab.json"), join(root, "vocab.json"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("validateRepo", () => {
  it("passes a small, sound corpus", async () => {
    await write("people/karl-vogt.json", {
      id: "karl-vogt",
      names: { display: "Karl Vogt", nicknames: ["Karli"] },
      pronouns: ["he/him"],
      birth: { date: "1930~" },
      status: "deceased",
      death: { date: "2005-11-02" },
      meta,
    });
    await write("people/agnes-vogt.json", {
      id: "agnes-vogt",
      names: { display: "Agnes Vogt", aka: ["Agnes V."] },
      pronouns: ["she/her", "they/them"],
      birth: { date: "1962-03-04" },
      status: "living",
      parents: [{ id: "karl-vogt", kind: "birth", confidence: "certain" }],
      meta,
    });

    const findings = await validateRepo(root, TODAY);

    expect(findings).toEqual([]);
    expect(hasErrors(findings)).toBe(false);
  });

  it("catches a filename that does not match its id on disk", async () => {
    await write("people/karl.json", {
      id: "karl-vogt",
      names: { display: "Karl Vogt" },
      status: "living",
      meta,
    });

    const findings = await validateRepo(root, TODAY);

    expect(findings.some((f) => f.rule === "filename-id-mismatch")).toBe(true);
    expect(findings.some((f) => f.where === "people/karl.json")).toBe(true);
    expect(hasErrors(findings)).toBe(true);
  });

  it("catches a value that is not in the real vocab.json", async () => {
    await write("people/a.json", { id: "a", names: { display: "A" }, status: "living", meta });
    await write("people/b.json", {
      id: "b",
      names: { display: "B" },
      status: "living",
      parents: [{ id: "a", kind: "co-parent" }],
      meta,
    });

    const findings = await validateRepo(root, TODAY);

    expect(findings.some((f) => f.rule === "unknown-vocabulary")).toBe(true);
  });

  it("warns without failing when only warnings are present", async () => {
    await write("people/lonely.json", {
      id: "lonely",
      names: { display: "Lonely" },
      status: "living",
      meta,
    });

    const findings = await validateRepo(root, TODAY);

    expect(findings.some((f) => f.rule === "island")).toBe(true);
    expect(hasErrors(findings)).toBe(false);
  });

  it("stops warning about a provisional entry once a proposal is resolved", async () => {
    await write("vocab.json", {
      version: 1,
      relationType: [{ key: "friend", label: "Friend", symmetric: true }],
      parentKind: [{ key: "birth", label: "Birth" }],
      unionType: [{ key: "marriage", label: "Marriage" }],
      unionEnd: [],
      relationStatus: [{ key: "active", label: "Active" }],
      context: [{ key: "climbing", label: "Climbing", provisional: true, added: "2026-01-01" }],
      tag: [],
    });

    const before = await validateRepo(root, TODAY);
    expect(before.some((f) => f.rule === "stale-provisional-vocabulary")).toBe(true);

    await write(
      "proposals/001-climbing.md",
      "---\nstatus: accepted\n---\n\nAdd a climbing context.\n",
    );

    const after = await validateRepo(root, TODAY);
    expect(after.some((f) => f.rule === "stale-provisional-vocabulary")).toBe(false);
  });

  it("keeps warning while the proposal is still a draft", async () => {
    await write("vocab.json", {
      version: 1,
      relationType: [{ key: "friend", label: "Friend", symmetric: true }],
      parentKind: [{ key: "birth", label: "Birth" }],
      unionType: [{ key: "marriage", label: "Marriage" }],
      unionEnd: [],
      relationStatus: [{ key: "active", label: "Active" }],
      context: [{ key: "climbing", label: "Climbing", provisional: true, added: "2026-01-01" }],
      tag: [],
    });
    await write("proposals/001-climbing.md", "---\nstatus: draft\n---\n\nAdd climbing.\n");

    const findings = await validateRepo(root, TODAY);

    expect(findings.some((f) => f.rule === "stale-provisional-vocabulary")).toBe(true);
  });

  it("validates the repository itself", async () => {
    const findings = await validateRepo(process.cwd(), TODAY);
    expect(hasErrors(findings)).toBe(false);
  });
});

describe("format", () => {
  it("says so when there is nothing to report", () => {
    expect(format([])).toBe("validate: nothing to report\n");
  });

  it("groups by rule and counts both levels", () => {
    const output = format([
      error("duplicate-id", "people/a.json", "id a is already used by people/b.json"),
      error("duplicate-id", "people/c.json", "id c is already used by people/d.json"),
      warning("island", "people/e.json", "e has no relations of any kind"),
    ]);

    expect(output).toContain("error: duplicate-id");
    expect(output).toContain("warning: island");
    expect(output.match(/error: duplicate-id/g)).toHaveLength(1);
    expect(output).toContain("2 error(s), 1 warning(s)");
  });
});
