import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LoadError, graphFrom, loadGraph, loadRecords } from "../src/model/load.ts";

let root: string;

const vocab = {
  version: 1,
  relationType: [{ key: "friend", label: "Friend", symmetric: true }],
  parentKind: [{ key: "birth", label: "Birth" }],
  unionType: [{ key: "marriage", label: "Marriage" }],
  unionEnd: [],
  relationStatus: [{ key: "active", label: "Active" }],
  relationEnd: [],
  context: [],
  tag: [],
};

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
  root = await mkdtemp(join(tmpdir(), "graph-load-"));
  await write("vocab.json", vocab);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadRecords", () => {
  it("reads every record type with its source path and stem", async () => {
    await write("people/agnes-vogt.json", { id: "agnes-vogt", names: { display: "Agnes Vogt" }, status: "living", meta });
    await write("unions/u-0001.json", { id: "u-0001", partners: ["agnes-vogt"], type: "marriage" });
    await write("relations/r-0001.json", { id: "r-0001", type: "friend", from: "agnes-vogt", to: "agnes-vogt", symmetric: true, status: "active" });
    await write("notes/agnes-vogt.md", "Longer note.");

    const records = await loadRecords(root);

    expect(records.people).toHaveLength(1);
    expect(records.people[0]?.path).toBe("people/agnes-vogt.json");
    expect(records.people[0]?.stem).toBe("agnes-vogt");
    expect(records.unions[0]?.stem).toBe("u-0001");
    expect(records.relations[0]?.stem).toBe("r-0001");
    expect(records.notes[0]).toMatchObject({ path: "notes/agnes-vogt.md", stem: "agnes-vogt", record: "Longer note." });
    expect(records.vocab.version).toBe(1);
  });

  it("reports the stem even when it disagrees with the id, leaving that to the validator", async () => {
    await write("people/wrong-name.json", { id: "agnes-vogt", names: { display: "Agnes Vogt" }, status: "living", meta });

    const records = await loadRecords(root);

    expect(records.people[0]?.stem).toBe("wrong-name");
    expect(records.people[0]?.record.id).toBe("agnes-vogt");
  });

  it("treats missing record directories as empty", async () => {
    const records = await loadRecords(root);

    expect(records.people).toEqual([]);
    expect(records.unions).toEqual([]);
    expect(records.relations).toEqual([]);
    expect(records.notes).toEqual([]);
  });

  it("ignores files that are not records", async () => {
    await write("people/.gitkeep", "");
    await write("people/README.txt", "not a person");
    await write("notes/agnes-vogt.json", { id: "no" });

    const records = await loadRecords(root);

    expect(records.people).toEqual([]);
    expect(records.notes).toEqual([]);
  });

  it("loads in a stable order", async () => {
    await write("people/c.json", { id: "c", names: { display: "C" }, status: "living", meta });
    await write("people/a.json", { id: "a", names: { display: "A" }, status: "living", meta });
    await write("people/b.json", { id: "b", names: { display: "B" }, status: "living", meta });

    const records = await loadRecords(root);

    expect(records.people.map((file) => file.stem)).toEqual(["a", "b", "c"]);
  });

  it("names the file when its JSON is broken", async () => {
    await write("people/agnes-vogt.json", "{ oops");

    await expect(loadRecords(root)).rejects.toThrow(LoadError);
    await expect(loadRecords(root)).rejects.toThrow("people/agnes-vogt.json");
  });

  it("fails when vocab.json is missing", async () => {
    await rm(join(root, "vocab.json"));

    await expect(loadRecords(root)).rejects.toThrow(LoadError);
    await expect(loadRecords(root)).rejects.toThrow("vocab.json");
  });
});

describe("loadGraph", () => {
  it("attaches sidecar notes and hides tombstones", async () => {
    await write("people/karl-vogt.json", { id: "karl-vogt", names: { display: "Karl Vogt" }, status: "living", notes: "inline", meta });
    await write("people/uncle-karl.json", { id: "uncle-karl", names: { display: "Uncle Karl" }, status: "merged", mergedInto: "karl-vogt", meta });
    await write("people/agnes-vogt.json", { id: "agnes-vogt", names: { display: "Agnes Vogt" }, status: "living", parents: [{ id: "uncle-karl", kind: "birth" }], meta });
    await write("notes/karl-vogt.md", "From the sidecar.");

    const graph = await loadGraph(root);

    expect([...graph.people.keys()]).toEqual(["agnes-vogt", "karl-vogt"].sort());
    expect(graph.people.get("karl-vogt")?.notes).toBe("From the sidecar.");
    expect(graph.people.get("agnes-vogt")?.parents).toEqual([{ id: "karl-vogt", kind: "birth" }]);
    expect(graph.tombstones.has("uncle-karl")).toBe(true);
  });

  it("builds the same graph from already-loaded records", async () => {
    await write("people/agnes-vogt.json", { id: "agnes-vogt", names: { display: "Agnes Vogt" }, status: "living", meta });

    const records = await loadRecords(root);

    expect([...graphFrom(records).people.keys()]).toEqual([...(await loadGraph(root)).people.keys()]);
  });
});

describe("the repository itself", () => {
  // Asserts invariants rather than a record count, so this keeps working once people exist.
  it("loads whatever is committed", async () => {
    const graph = await loadGraph(process.cwd());

    expect(graph.vocab.relationType.some((entry) => entry.key === "friend")).toBe(true);

    for (const [id, person] of graph.people) {
      expect(person.id).toBe(id);
      expect(person.status).not.toBe("merged");
    }
  });
});
