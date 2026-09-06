import { afterEach, expect, it, vi } from "vitest";
import * as data from "./data";
import { getLedger } from "./data";
import { alignFunders } from "./align-funders";
import type { GraphFact } from "./graph/facts";
import type { Runner } from "./graph/neo4j";

const edge = (fromId: string, fromName: string, amount: number, toId = "C00431056", source = "https://example.com/source"): Omit<GraphFact, "n"> => ({
  from: { id: fromId, name: fromName, kind: "organization", href: null },
  to: { id: toId, name: "BOB CASEY FOR SENATE INC", kind: "committee", href: null },
  rel: "GAVE",
  amount,
  count: null,
  support_oppose: null,
  visibility: "disclosed",
  class_basis: null,
  first_date: null,
  last_date: null,
  source_url: source,
  path: null,
  tag: { issue_id: "guns", layer: "position", label: null },
});

afterEach(() => vi.restoreAllMocks());

it("static path reads the real race artifacts and caps both lists at five", async () => {
  const result = await alignFunders("pa-sen-2024", "S6PA00217", "guns", { run: null });
  expect(result.via).toBe("static");
  expect(result.candidate.length).toBeLessThanOrEqual(5);
  expect(result.race.length).toBeLessThanOrEqual(5);
  expect([...result.candidate, ...result.race].every((item) => item.source_url !== null)).toBe(true);
});

it("graph path aggregates funders and hydrates a position", async () => {
  vi.spyOn(data, "hasEntity").mockReturnValue(true);
  vi.spyOn(data, "getEntity").mockReturnValue({
    issue_positions: [{ issue_id: "guns", direction: 1, quote: "A position", source_url: "https://example.com/position" }],
  } as never);
  const run: Runner = vi.fn(async (cypher) => {
    const facts = cypher.includes("sum(g.amount)")
      ? [edge("F2", "Funder Two", 20)]
      : [edge("F1", "Funder One", 30, "C00431056"), edge("F1", "Funder One", 12, "C00851980")];
    return [{ edges: facts }];
  });
  const result = await alignFunders("pa-sen-2024", "S6PA00217", "guns", { run });
  expect(result.via).toBe("graph");
  expect(result.candidate).toEqual([expect.objectContaining({ entity_id: "F1", amount: 42, tag_layer: "position" })]);
  expect(result.race).toEqual([expect.objectContaining({ entity_id: "F2", amount: 20 })]);
  expect(run).toHaveBeenCalledTimes(2);
});

it("falls back to static artifacts when graph queries fail", async () => {
  const run: Runner = vi.fn(async () => {
    throw new Error("down");
  });
  const result = await alignFunders("pa-sen-2024", "S6PA00217", "guns", { run });
  expect(result.via).toBe("static");
});

it("does not invent static funders when entities are not tagged", () => {
  const ledger = getLedger("pa-sen-2024");
  expect(ledger.top_outside_spenders.length).toBeGreaterThan(0);
});
