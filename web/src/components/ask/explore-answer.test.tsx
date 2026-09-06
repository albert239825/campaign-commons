import { afterEach, describe, expect, it, vi } from "vitest";
import { appendExplorePage, canPageExploreResult, fetchExplorePage } from "./explore-answer";
import type { ExploreResult } from "@/lib/graph/explore";

const row = (n: number) => ({ n, cells: { amount: { t: "number" as const, value: n } } });
const result = (truncated: boolean): ExploreResult => ({
  kind: "explore",
  cypher: "MATCH (x:Entity {race_id: $race}) RETURN x LIMIT 20",
  description: "A result.",
  columns: ["amount"],
  rows: Array.from({ length: 20 }, (_, i) => row(i + 1)),
  narrative: { status: "withheld", reason: "unknown_number" },
  truncated,
  diagram: null,
  context: [],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExploreAnswer paging", () => {
  it("shows Show more only for a truncated answer", () => {
    expect(canPageExploreResult(result(true), 20)).toBe(true);
    expect(canPageExploreResult(result(true), 1)).toBe(true);
    expect(canPageExploreResult(result(false), 20)).toBe(false);
    expect(canPageExploreResult(result(true), 200)).toBe(false);
  });

  it("fetches and appends a page of rows", async () => {
    const next = { ...result(false), rows: [row(21), row(22)], truncated: true };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(next)));
    const fetched = await fetchExplorePage("race", "question", result(true).cypher, 20);
    expect(fetched).toMatchObject({ kind: "explore", rows: [{ n: 21 }, { n: 22 }] });
    if (fetched.kind !== "explore") throw new Error("expected explore response");
    expect(appendExplorePage(result(true).rows, result(true).columns, fetched)).toMatchObject({
      rows: expect.arrayContaining([expect.objectContaining({ n: 1 }), expect.objectContaining({ n: 21 }), expect.objectContaining({ n: 22 })]),
      truncated: true,
      addedRange: { from: 21, to: 22 },
    });
  });

  it("drops rows duplicated across a page boundary and stops when all rows repeat", () => {
    const current = result(true).rows.slice(0, 2);
    const duplicatePage = { ...result(true), rows: [current[1], row(3)], truncated: true };
    expect(appendExplorePage(current, ["amount"], duplicatePage)).toMatchObject({
      rows: [current[0], current[1], row(3)],
      truncated: true,
      addedRange: { from: 3, to: 3 },
    });

    const repeatedPage = { ...result(true), rows: [current[0], current[1]], truncated: true };
    expect(appendExplorePage(current, ["amount"], repeatedPage)).toMatchObject({
      rows: current,
      truncated: false,
      addedRange: null,
    });
  });
});
