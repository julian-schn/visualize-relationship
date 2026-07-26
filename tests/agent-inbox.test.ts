import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findPeople } from "../src/agent/find.ts";
import { applyInbox } from "../src/agent/inbox.ts";
import { orderKeys, planPatch, suggestionFrom, type Patch } from "../src/agent/patch.ts";
import type { Person } from "../src/model/types.ts";

const TODAY = "2026-07-26";
const meta = { created: "2026-01-01", updated: "2026-01-01", author: "agent" as const };

let root: string;

async function write(relative: string, contents: unknown): Promise<void> {
  const path = join(root, relative);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(
    path,
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2),
  );
}

const personRecord = (id: string, display: string, extra: Record<string, unknown> = {}) => ({
  id,
  names: { display },
  status: "living",
  meta,
  ...extra,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "graph-inbox-"));
  await cp(join(process.cwd(), "schema"), join(root, "schema"), { recursive: true });
  await cp(join(process.cwd(), "vocab.json"), join(root, "vocab.json"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("find", () => {
  const people = [
    {
      id: "agnes-vogt",
      names: { display: "Agnes Vogt", nicknames: ["Aggie"], former: [{ display: "Agnes Bauer" }] },
      status: "living",
      meta,
    },
    { id: "karl-vogt", names: { display: "Karl Vogt" }, status: "living", meta },
    {
      id: "ruth-kestner",
      names: { display: "Ruth Kestner" },
      status: "living",
      notes: "Met Agnes at school in Stuttgart.",
      meta,
    },
  ] as Person[];

  const notes = new Map([["karl-vogt", "Worked the Stuttgart line."]]);
  const ids = (query: string) => findPeople(people, notes, query).map((hit) => hit.id);

  it("matches an id", () => {
    expect(findPeople(people, notes, "agnes-vogt")[0]).toMatchObject({ where: "id" });
  });

  it("matches a nickname and says so", () => {
    expect(findPeople(people, notes, "aggie")[0]).toMatchObject({
      id: "agnes-vogt",
      where: "name",
      matched: "Aggie",
    });
  });

  it("matches a former name", () => {
    expect(ids("bauer")).toEqual(["agnes-vogt"]);
  });

  it("matches inside a note and quotes the surrounding words", () => {
    const hit = findPeople(people, notes, "school")[0];
    expect(hit?.id).toBe("ruth-kestner");
    expect(hit?.where).toBe("notes");
    expect(hit?.matched).toContain("school");
  });

  it("prefers a sidecar note over the inline one", () => {
    expect(ids("stuttgart")).toEqual(["karl-vogt", "ruth-kestner"]);
  });

  it("folds accents, so a typed name finds a written one", () => {
    const accented = [
      { id: "juergen", names: { display: "Jürgen Müller" }, status: "living", meta },
    ] as Person[];
    expect(findPeople(accented, new Map(), "muller")).toHaveLength(1);
  });

  it("finds nothing for an empty query", () => {
    expect(findPeople(people, notes, "  ")).toEqual([]);
  });
});

describe("planning a patch", () => {
  const existing = new Map([
    ["agnes-vogt", { type: "person" as const, record: personRecord("agnes-vogt", "Agnes Vogt") }],
  ]);

  it("creates a record with today's meta", () => {
    const patch: Patch = { creates: [{ type: "person", record: personRecord("karl-vogt", "Karl") }] };
    const [write] = planPatch(patch, existing, TODAY);

    expect(write?.record["meta"]).toMatchObject({
      created: TODAY,
      updated: TODAY,
      author: "agent",
    });
  });

  it("keeps the original created date on an update", () => {
    const patch: Patch = { updates: [{ type: "person", id: "agnes-vogt", set: { status: "deceased" } }] };
    const [write] = planPatch(patch, existing, TODAY);

    expect(write?.record["meta"]).toMatchObject({ created: "2026-01-01", updated: TODAY });
  });

  it("refuses to create over something that exists", () => {
    const patch: Patch = { creates: [{ type: "person", record: personRecord("agnes-vogt", "x") }] };
    expect(() => planPatch(patch, existing, TODAY)).toThrow(/already exists/);
  });

  it("refuses to update something that does not", () => {
    const patch: Patch = { updates: [{ type: "person", id: "ghost", set: {} }] };
    expect(() => planPatch(patch, existing, TODAY)).toThrow(/does not exist/);
  });

  it("refuses to change an id, which section 6 makes permanent", () => {
    const patch: Patch = { updates: [{ type: "person", id: "agnes-vogt", set: { id: "new" } }] };
    expect(() => planPatch(patch, existing, TODAY)).toThrow(/permanent/);
  });

  it("refuses a create with no id", () => {
    const patch: Patch = { creates: [{ type: "person", record: { names: {} } }] };
    expect(() => planPatch(patch, existing, TODAY)).toThrow(/no id/);
  });

  it("lets a later update refine something created in the same patch", () => {
    const patch: Patch = {
      creates: [{ type: "person", record: personRecord("new-person", "New") }],
      updates: [{ type: "person", id: "new-person", set: { status: "deceased" } }],
    };

    const written = planPatch(patch, existing, TODAY);
    expect(written).toHaveLength(1);
    expect(written[0]?.record["status"]).toBe("deceased");
  });
});

describe("key order", () => {
  it("puts a record's fields in a stable order", () => {
    const jumbled = { meta, status: "living", names: { display: "X" }, id: "x" };
    expect(Object.keys(orderKeys("person", jumbled))).toEqual(["id", "names", "status", "meta"]);
  });

  it("keeps a field it does not recognise rather than dropping it", () => {
    const odd = { id: "x", surprise: 1 };
    expect(orderKeys("person", odd)).toHaveProperty("surprise", 1);
  });
});

describe("open questions", () => {
  it("becomes a suggestions file", () => {
    const patch: Patch = { uncertain: ["Is Uncle Karl the same Karl as karl-vogt?"], notes: "From a voice note." };
    const text = suggestionFrom(patch, "inbox/staged/x.patch.json", TODAY);

    expect(text).toContain("Uncle Karl");
    expect(text).toContain("From a voice note.");
  });

  it("is nothing when the agent had no questions", () => {
    expect(suggestionFrom({}, "x", TODAY)).toBeNull();
  });
});

describe("applying the inbox", () => {
  it("does nothing when nothing is staged", async () => {
    expect(await applyInbox(root, TODAY)).toMatchObject({ applied: [], written: [] });
  });

  it("writes records and moves the patch to processed", async () => {
    await write("inbox/staged/0001.patch.json", {
      creates: [
        { type: "person", record: personRecord("karl-vogt", "Karl Vogt") },
        {
          type: "person",
          record: personRecord("agnes-vogt", "Agnes Vogt", {
            parents: [{ id: "karl-vogt", kind: "birth" }],
          }),
        },
      ],
    });

    const result = await applyInbox(root, TODAY);

    expect(result.written.map((write) => write.path).sort()).toEqual([
      "people/agnes-vogt.json",
      "people/karl-vogt.json",
    ]);
    expect(JSON.parse(await readFile(join(root, "people/karl-vogt.json"), "utf8"))).toMatchObject({
      id: "karl-vogt",
    });
    expect(await readdir(join(root, "inbox/processed"))).toEqual(["0001.patch.json"]);
    expect(await readdir(join(root, "inbox/staged"))).toEqual([]);
  });

  it("writes nothing at all when the result would fail validation", async () => {
    await write("inbox/staged/0001.patch.json", {
      creates: [
        { type: "person", record: personRecord("good-one", "Good") },
        {
          type: "person",
          record: personRecord("bad-one", "Bad", { parents: [{ id: "ghost", kind: "birth" }] }),
        },
      ],
    });

    await expect(applyInbox(root, TODAY)).rejects.toThrow(/nothing was written/);
    await expect(readFile(join(root, "people/good-one.json"), "utf8")).rejects.toThrow();
    expect(await readdir(join(root, "inbox/staged"))).toEqual(["0001.patch.json"]);
  });

  it("refuses a patch that is not shaped like a patch", async () => {
    await write("inbox/staged/0001.patch.json", { creates: "not an array" });
    await expect(applyInbox(root, TODAY)).rejects.toThrow(/staged\/0001/);
  });

  it("turns open questions into a suggestions file", async () => {
    await write("inbox/staged/0001.patch.json", {
      creates: [{ type: "person", record: personRecord("solo", "Solo") }],
      uncertain: ["Which Karl is this?"],
    });

    const result = await applyInbox(root, TODAY);
    expect(result.suggestions).toHaveLength(1);
    const written = await readFile(join(root, result.suggestions[0] ?? ""), "utf8");
    expect(written).toContain("Which Karl is this?");
  });

  it("applies several patches in order", async () => {
    await write("inbox/staged/0001.patch.json", {
      creates: [{ type: "person", record: personRecord("a", "A") }],
    });
    await write("inbox/staged/0002.patch.json", {
      updates: [{ type: "person", id: "a", set: { status: "deceased" } }],
    });

    await applyInbox(root, TODAY);
    const record = JSON.parse(await readFile(join(root, "people/a.json"), "utf8")) as Person;

    expect(record.status).toBe("deceased");
  });
});
