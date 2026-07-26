import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const RESOLVED = new Set(["accepted", "rejected", "superseded"]);

/**
 * Vocabulary keys named by a proposal that is no longer a draft. A key is taken to be
 * addressed if the proposal mentions it anywhere, which is deliberately loose: the point is
 * to stop nagging once someone has written the proposal down, not to police the wording.
 */
export async function readResolvedProposals(root: string, keys: Iterable<string>): Promise<Set<string>> {
  const directory = join(root, "proposals");

  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return new Set();
  }

  const resolved = new Set<string>();
  const candidates = [...keys];

  for (const name of names) {
    const text = await readFile(join(directory, name), "utf8");
    const status = /^status:\s*(\w+)/m.exec(text)?.[1]?.toLowerCase();
    if (status === undefined || !RESOLVED.has(status)) continue;

    for (const key of candidates) {
      if (text.includes(key)) resolved.add(key);
    }
  }

  return resolved;
}
