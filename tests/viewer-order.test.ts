import { describe, expect, it } from "vitest";
import { seatPartners, type Placed } from "../src/viewer/order.ts";

const row = (...ids: string[]): Placed[] =>
  ids.map((id, index) => ({ id, x: index * 100, y: 0 }));

const partners = (...pairs: [string, string][]): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as [string, string][]) {
      const existing = map.get(from);
      if (existing) existing.add(to);
      else map.set(from, new Set([to]));
    }
  }
  return map;
};

/** The order a rank ends up in, left to right. */
function seating(placed: Placed[], links: Map<string, Set<string>>): string[] {
  const moved = seatPartners(placed, links);
  return placed
    .map((node) => ({ id: node.id, x: moved.get(node.id) ?? node.x }))
    .sort((a, b) => a.x - b.x)
    .map((node) => node.id);
}

describe("seating partners", () => {
  it("moves a spouse next to their partner", () => {
    // dagre left "spouse" stranded on the far side of two siblings.
    const placed = row("agnes", "sister", "brother", "spouse");
    expect(seating(placed, partners(["agnes", "spouse"]))).toEqual([
      "agnes",
      "spouse",
      "sister",
      "brother",
    ]);
  });

  it("leaves a rank alone when partners are already adjacent", () => {
    const placed = row("agnes", "spouse", "sister");
    expect(seating(placed, partners(["agnes", "spouse"]))).toEqual(["agnes", "spouse", "sister"]);
  });

  it("reuses the slots the rank already had, inventing no new positions", () => {
    const placed = row("a", "b", "c", "d");
    const moved = seatPartners(placed, partners(["a", "d"]));

    const used = [...moved.values()].sort((x, y) => x - y);
    expect(used).toEqual([0, 100, 200, 300].slice(0, used.length));
  });

  it("keeps everyone, losing nobody to a collision", () => {
    const placed = row("a", "b", "c", "d", "e");
    const seated = seating(placed, partners(["a", "e"], ["b", "d"]));

    expect([...seated].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(new Set(seated).size).toBe(5);
  });

  it("seats all of a three-person union together", () => {
    const placed = row("a", "x", "b", "y", "c");
    const seated = seating(placed, partners(["a", "b"], ["b", "c"], ["a", "c"]));

    const positions = ["a", "b", "c"].map((id) => seated.indexOf(id)).sort((m, n) => m - n);
    expect(positions[2]! - positions[0]!).toBe(2);
  });

  it("ignores ranks too short to have an ordering problem", () => {
    expect(seatPartners(row("a", "b"), partners(["a", "b"])).size).toBe(0);
  });

  it("treats each rank separately", () => {
    const placed: Placed[] = [
      ...row("a", "sib", "spouse"),
      { id: "kid", x: 0, y: 100 },
      { id: "other", x: 100, y: 100 },
      { id: "third", x: 200, y: 100 },
    ];

    const moved = seatPartners(placed, partners(["a", "spouse"]));
    // Nothing on the lower rank is partnered, so nothing there moves.
    expect(moved.has("kid")).toBe(true);
    expect(moved.get("kid")).toBe(0);
  });

  it("tolerates a floating point wobble in a rank's y", () => {
    const placed: Placed[] = [
      { id: "a", x: 0, y: 100 },
      { id: "sib", x: 100, y: 100.0000001 },
      { id: "spouse", x: 200, y: 99.9999999 },
    ];

    expect(seating(placed, partners(["a", "spouse"]))).toEqual(["a", "spouse", "sib"]);
  });

  it("does nothing when nobody is partnered", () => {
    expect(seatPartners(row("a", "b", "c"), new Map()).size).toBe(3);
  });
});
