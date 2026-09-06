import { describe, expect, it } from "vitest";
import { sankeyFromRows } from "./sankey";
import type { ExploreRow } from "./explore";

const node = (id: string, name: string) => ({ id, name, kind: "committee" as const, href: null });
const fact = (n: number, from: string, to: string, amount: number, rel: "GAVE" | "PAID" = "GAVE") => ({
  n,
  from: node(from, from),
  to: node(to, to),
  rel,
  amount,
  count: null,
  support_oppose: null,
  visibility: "disclosed" as const,
  first_date: null,
  last_date: null,
  source_url: null,
  path: null,
});
const rows = (...facts: ReturnType<typeof fact>[]): ExploreRow[] => facts.map((f) => ({ n: f.n, cells: { flow: { t: "edge", fact: f } } }));

describe("sankeyFromRows", () => {
  it("layers a two-edge chain from left to right", () => {
    const result = sankeyFromRows(rows(fact(1, "A", "B", 10), fact(2, "B", "C", 5)));
    expect(result).toMatchObject({ ok: true, layers: 3, nodes: [{ id: "A", layer: 0 }, { id: "B", layer: 1 }, { id: "C", layer: 2 }] });
  });

  it("refuses rows without edges or positive amounts", () => {
    expect(sankeyFromRows([{ n: 1, cells: { name: { t: "text", value: "A" }, amount: { t: "number", value: 10 } } }])).toMatchObject({ ok: false, reason: "no_edges" });
    expect(sankeyFromRows(rows(fact(1, "A", "B", 0)))).toMatchObject({ ok: false, reason: "no_amounts" });
  });

  it("refuses cycles", () => {
    expect(sankeyFromRows(rows(fact(1, "A", "B", 10), fact(2, "B", "A", 5)))).toMatchObject({ ok: false, reason: "cyclic" });
  });

  it("collapses duplicate links while keeping the first citation", () => {
    const result = sankeyFromRows(rows(fact(7, "A", "B", 10), fact(3, "A", "B", 20)));
    expect(result).toMatchObject({ ok: true, links: [{ n: 7, source: "A", target: "B", amount: 10 }] });
  });
});
