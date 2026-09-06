import { describe, expect, it } from "vitest";
import { sankeyFromRows } from "./sankey";
import type { ExploreRow } from "./explore";

const node = (id: string, name: string) => ({ id, name, kind: "committee" as const, href: null, title: null });
const fact = (
  n: number,
  from: string,
  to: string,
  amount: number,
  rel: "GAVE" | "PAID" | "CAMPAIGN_OF" = "GAVE",
  visibility: "disclosed" | "inferable" | "dark" = "disclosed",
) => ({
  n,
  from: node(from, from),
  to: node(to, to),
  rel,
  amount,
  count: null,
  support_oppose: null,
  visibility,
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

  it("merges parties with different ids but the same kind and name", () => {
    const first = { ...fact(1, "A-1", "B", 10), from: { ...node("A-1", "SAME PARTY") } };
    const second = { ...fact(2, "A-2", "C", 5), from: { ...node("A-2", "SAME PARTY") } };
    const result = sankeyFromRows(rows(first, second));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nodes.find((n) => n.id === "A-1")).toMatchObject({ id: "A-1", name: "SAME PARTY" });
      expect(result.nodes).toHaveLength(3);
    }
  });

  it("keeps a dark duplicate label when collapsing links", () => {
    const dark = fact(2, "A", "B", 10, "GAVE", "dark");
    const result = sankeyFromRows(rows(fact(1, "A", "B", 10), dark));
    expect(result).toMatchObject({ ok: true, links: [{ n: 1, visibility: "dark" }] });
  });

  it("draws campaign ownership with the money that reached the committee", () => {
    const gave = fact(1, "A", "C", 100);
    const ownership = {
      ...fact(2, "C", "D", 0, "CAMPAIGN_OF"),
      from: { id: "C", name: "COMMITTEE", kind: "committee" as const, href: null, title: null },
      to: { id: "D", name: "CANDIDATE", kind: "candidate" as const, href: null, title: null },
    };
    const result = sankeyFromRows(rows(gave), [ownership]);
    expect(result).toMatchObject({ ok: true, links: [{ rel: "GAVE", amount: 100 }, { rel: "CAMPAIGN_OF", amount: 100 }] });
  });

  it("does not draw campaign ownership when no money reached the committee", () => {
    const ownership = {
      ...fact(2, "C", "D", 0, "CAMPAIGN_OF"),
      from: { id: "C", name: "COMMITTEE", kind: "committee" as const, href: null, title: null },
      to: { id: "D", name: "CANDIDATE", kind: "candidate" as const, href: null, title: null },
    };
    const result = sankeyFromRows(rows(fact(1, "A", "B", 100)), [ownership]);
    expect(result).toMatchObject({ ok: true, links: [{ rel: "GAVE", amount: 100 }] });
    if (result.ok) expect(result.links.some((link) => link.rel === "CAMPAIGN_OF")).toBe(false);
  });
});
