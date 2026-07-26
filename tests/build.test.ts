import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphPage } from "../src/build/build.ts";
import { compile } from "../src/build/compile.ts";
import { verifyOffline } from "../src/build/verify.ts";
import { buildGraph } from "../src/model/graph.ts";
import type { ParentEdge, Person, Vocab } from "../src/model/types.ts";

const TODAY = "2026-07-26";
const meta = { created: "2026-07-26", updated: "2026-07-26", author: "agent" as const };
const birth = (id: string): ParentEdge => ({ id, kind: "birth" });

let root: string;

async function write(relative: string, contents: unknown): Promise<void> {
  const path = join(root, relative);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(
    path,
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2),
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "graph-build-"));
  for (const path of ["schema", "src/viewer"]) {
    await cp(join(process.cwd(), path), join(root, path), { recursive: true });
  }
  await cp(join(process.cwd(), "src/build"), join(root, "src/build"), { recursive: true });
  await cp(join(process.cwd(), "src/model"), join(root, "src/model"), { recursive: true });
  await cp(join(process.cwd(), "src/kinship"), join(root, "src/kinship"), { recursive: true });
  await cp(join(process.cwd(), "vocab.json"), join(root, "vocab.json"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the offline gate", () => {
  it("passes a self-contained page", () => {
    expect(verifyOffline("<html><script>const a = 1;</script></html>")).toEqual([]);
  });

  it("catches a fetch", () => {
    const found = verifyOffline("<script>fetch('graph.json')</script>");
    expect(found.map((v) => v.rule)).toContain("no-fetch");
  });

  it("catches other ways to reach the network", () => {
    expect(verifyOffline("<script>new XMLHttpRequest()</script>")[0]?.rule).toBe("no-network");
    expect(verifyOffline("<script>new WebSocket('x')</script>")[0]?.rule).toBe("no-network");
  });

  it("catches an external script or stylesheet", () => {
    expect(verifyOffline('<script src="/bundle.js"></script>')[0]?.rule).toBe(
      "no-external-reference",
    );
    expect(verifyOffline('<link href="style.css">')[0]?.rule).toBe("no-external-reference");
  });

  it("catches a remote URL", () => {
    expect(verifyOffline("<script>const u = 'https://example.com/f.js'</script>")[0]?.rule).toBe(
      "no-remote-url",
    );
  });

  it("allows a data URI and a fragment link", () => {
    expect(verifyOffline('<img src="data:image/png;base64,AAAA"><a href="#main">x</a>')).toEqual([]);
  });

  it("allows a URL inside a comment, which section 12.2 exempts", () => {
    expect(verifyOffline("<script>/* see https://example.com */</script>")).toEqual([]);
    expect(verifyOffline("<!-- https://example.com -->")).toEqual([]);
  });

  it("allows a URL inside the inlined data, which is not code", () => {
    const html = `<script type="application/json" id="graph">{"u":"https://example.com"}</script>`;
    expect(verifyOffline(html)).toEqual([]);
  });
});

describe("compile", () => {
  const vocab: Vocab = {
    version: 1,
    relationType: [],
    parentKind: [],
    unionType: [],
    unionEnd: [],
    relationStatus: [],
    relationEnd: [],
    context: [],
    tag: [],
  };

  const person = (id: string, parents: ParentEdge[] = []): Person => ({
    id,
    names: { display: id },
    status: "living",
    parents,
    meta,
  });

  const graphOf = (people: Person[]) =>
    compile(buildGraph({ people, unions: [], relations: [], vocab }));

  it("emits both directions of the parentage index", () => {
    const compiled = graphOf([person("parent"), person("child", [birth("parent")])]);

    expect(compiled.parentsOf["child"]).toEqual(["parent"]);
    expect(compiled.childrenOf["parent"]).toEqual(["child"]);
  });

  it("parses dates once so the viewer never sees a raw string", () => {
    const dated: Person = { ...person("a"), birth: { date: "1890~" } };
    const compiled = compile(buildGraph({ people: [dated], unions: [], relations: [], vocab }));

    expect(compiled.people[0]?.birthInterval).toMatchObject({
      earliest: "1889-01-01",
      display: "c. 1890",
    });
  });

  it("records redirects so an old id still resolves", () => {
    const compiled = graphOf([
      person("karl-vogt"),
      { ...person("uncle-karl"), status: "merged", mergedInto: "karl-vogt" },
    ]);

    expect(compiled.redirects).toEqual({ "uncle-karl": "karl-vogt" });
    expect(compiled.people.map((p) => p.id)).toEqual(["karl-vogt"]);
  });

  it("is deterministic regardless of input order", () => {
    const forwards = graphOf([person("a"), person("b"), person("c")]);
    const backwards = graphOf([person("c"), person("b"), person("a")]);

    expect(JSON.stringify(forwards)).toBe(JSON.stringify(backwards));
  });

  it("survives JSON round-tripping, which is how it reaches the page", () => {
    const compiled = graphOf([person("a")]);
    expect(JSON.parse(JSON.stringify(compiled))).toEqual(compiled);
  });
});

describe("buildGraphPage", () => {
  it("inlines the graph rather than fetching it", async () => {
    await write("people/agnes-vogt.json", {
      id: "agnes-vogt",
      names: { display: "Agnes Vogt" },
      status: "living",
      meta,
    });

    const { html, graph } = await buildGraphPage(root, TODAY);

    expect(html).toContain('<script type="application/json" id="graph">');
    expect(html).not.toContain("fetch(");
    expect(graph.builtFrom.people).toBe(1);
  });

  it("produces a page whose inlined graph parses back", async () => {
    await write("people/a.json", { id: "a", names: { display: "A" }, status: "living", meta });

    const { html } = await buildGraphPage(root, TODAY);
    const block = /<script type="application\/json" id="graph">([\s\S]*?)<\/script>/.exec(html);
    const parsed = JSON.parse(block?.[1] ?? "") as { people: { id: string }[] };

    expect(parsed.people[0]?.id).toBe("a");
  });

  it("does not let a closing script tag in the data break out of the block", async () => {
    await write("people/a.json", {
      id: "a",
      names: { display: "A" },
      status: "living",
      notes: "</script><script>alert(1)</script>",
      meta,
    });

    const { html } = await buildGraphPage(root, TODAY);
    const block = /<script type="application\/json" id="graph">([\s\S]*?)<\/script>/.exec(html);
    const parsed = JSON.parse(block?.[1] ?? "") as { people: { notes?: string }[] };

    expect(parsed.people[0]?.notes).toBe("</script><script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("refuses to build when validation fails", async () => {
    await write("people/wrong-name.json", {
      id: "a",
      names: { display: "A" },
      status: "living",
      meta,
    });

    await expect(buildGraphPage(root, TODAY)).rejects.toThrow(/validation failed/);
  });

  it("is byte-identical across two builds of the same data", async () => {
    await write("people/a.json", { id: "a", names: { display: "A" }, status: "living", meta });

    const first = await buildGraphPage(root, TODAY);
    const second = await buildGraphPage(root, TODAY);

    expect(first.html).toBe(second.html);
  });

  it("passes its own offline gate", async () => {
    await write("people/a.json", { id: "a", names: { display: "A" }, status: "living", meta });

    const { html } = await buildGraphPage(root, TODAY);
    expect(verifyOffline(html)).toEqual([]);
  });
});
