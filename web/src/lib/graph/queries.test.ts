import { describe, expect, it, vi } from "vitest";
import type { GraphFact, GraphNodeRef } from "./facts";
import type { Runner } from "./neo4j";
import { CYPHER, GRAPH_OP_SPEC, MAX_FACTS, mentionTokens, resolveSubject, runOperation } from "./queries";

const node = (id: string, name: string, kind: GraphNodeRef["kind"] = "committee"): GraphNodeRef => ({ id, name, kind, href: null });
const fact = (from: GraphNodeRef, to: GraphNodeRef, amount: number, extra: Partial<Omit<GraphFact, "n">> = {}): Omit<GraphFact, "n"> => ({
  from,
  to,
  rel: "GAVE",
  amount,
  count: null,
  support_oppose: null,
  visibility: "disclosed",
  first_date: null,
  last_date: null,
  source_url: "https://www.fec.gov/x",
  path: null,
  ...extra,
});

/** A Runner that answers by-name lookups with `byName`, by-id lookups with `byId`, and operations with `edges` rows. */
const runner = (opts: { byId?: GraphNodeRef[]; byName?: GraphNodeRef[]; edges?: Omit<GraphFact, "n">[][] } = {}) =>
  vi.fn<Runner>(async (cypher) => {
    if (cypher.includes("$ids")) return (opts.byId ?? []).map((n) => ({ node: n }));
    if (cypher.includes("$tokens")) return (opts.byName ?? []).map((n) => ({ node: n }));
    return (opts.edges ?? []).map((edges) => ({ edges }));
  });

describe("CYPHER allowlist", () => {
  it("has one fixed statement set per operation, parameterised only by $race, $a and $b", () => {
    for (const op of Object.keys(GRAPH_OP_SPEC) as (keyof typeof CYPHER)[]) {
      expect(CYPHER[op].length).toBeGreaterThan(0);
      for (const stmt of CYPHER[op]) {
        const params = [...new Set([...stmt.matchAll(/\$(\w+)/g)].map((m) => m[1]))].sort();
        expect(params.every((p) => ["race", "a", "b"].includes(p))).toBe(true);
        expect(stmt).toContain("race_id: $race");
      }
    }
  });
  it("only reads: no write clauses anywhere", () => {
    for (const stmts of Object.values(CYPHER)) for (const s of stmts) expect(s).not.toMatch(/\b(CREATE|MERGE|DELETE|SET|DROP|REMOVE|LOAD CSV|CALL\s+(?:apoc|db|dbms))\b/i);
  });
  it("money_path only walks GAVE, CAMPAIGN_OF and TARGETED, never PAID or PLACED, so a path cannot go through a vendor", () => {
    const [stmt] = CYPHER.money_path;
    expect(stmt).toContain(":GAVE|CAMPAIGN_OF|TARGETED*1..4");
    expect(stmt).not.toContain("PAID");
    expect(stmt).not.toContain("PLACED");
  });
});

describe("mentionTokens", () => {
  it("lowercases, splits on punctuation, drops one-letter fragments and duplicates", () => {
    expect(mentionTokens("Elon Musk")).toEqual(["elon", "musk"]);
    expect(mentionTokens("MUSK, ELON R.")).toEqual(["musk", "elon"]);
    expect(mentionTokens("the the")).toEqual(["the"]);
    expect(mentionTokens("!!")).toEqual([]);
  });
});

describe("resolveSubject", () => {
  it("resolves a closed-list id to its graph node by id, never by name", async () => {
    const run = runner({ byId: [node("C1", "WINSENATE")] });
    const r = await resolveSubject(run, "pa-sen-2024", { id: "C1", mention: null });
    expect(r).toEqual({ ok: true, subject: { name: "WINSENATE", kind: "committee", ids: ["C1"], href: null } });
    expect(run.mock.calls[0][1]).toEqual({ race: "pa-sen-2024", ids: ["C1"] });
    expect(run.mock.calls[0][0]).not.toContain("C1");
  });
  it("reports not_found when the id is not in the graph or the mention has no tokens", async () => {
    expect(await resolveSubject(runner(), "r", { id: "C9", mention: null })).toEqual({ ok: false, reason: "not_found", matches: [] });
    expect(await resolveSubject(runner(), "r", { id: null, mention: "?" })).toEqual({ ok: false, reason: "not_found", matches: [] });
  });
  it("passes a mention to the graph only as tokens, never spliced into the statement", async () => {
    const run = runner({ byName: [node("ind:MUSK_ELON|1", "MUSK, ELON", "individual")] });
    await resolveSubject(run, "r", { id: null, mention: "Elon Musk') DETACH DELETE (x" });
    expect(run.mock.calls[0][0]).not.toContain("DETACH");
    expect(run.mock.calls[0][1]).toEqual({ race: "r", tokens: ["elon", "musk", "detach", "delete"] });
  });
  it("groups nodes that share a name into one subject with several ids", async () => {
    const run = runner({ byName: [node("ind:YASS_JEFF|1", "YASS, JEFF", "individual"), node("ind:YASS_JEFF|2", "YASS, JEFF", "individual")] });
    const r = await resolveSubject(run, "r", { id: null, mention: "Jeff Yass" });
    expect(r).toEqual({ ok: true, subject: { name: "YASS, JEFF", kind: "individual", ids: ["ind:YASS_JEFF|1", "ind:YASS_JEFF|2"], href: null } });
  });
  it("among several matching names, takes the one made only of the mention's words", async () => {
    const run = runner({ byName: [node("a", "MUSK, ELON", "individual"), node("b", "MUSK, ELON REEVE", "individual")] });
    const r = await resolveSubject(run, "r", { id: null, mention: "Elon Musk" });
    expect(r.ok && r.subject.ids).toEqual(["a"]);
  });
  it("reports the candidate names as ambiguous when no single name is covered by the mention", async () => {
    const run = runner({ byName: [node("a", "SMITH, JOHN A", "individual"), node("b", "SMITH, JOHN B", "individual")] });
    const r = await resolveSubject(run, "r", { id: null, mention: "John Smith" });
    expect(r).toEqual({ ok: false, reason: "ambiguous", matches: [node("a", "SMITH, JOHN A", "individual"), node("b", "SMITH, JOHN B", "individual")] });
  });
  it("propagates a driver error instead of inventing a result", async () => {
    const run = vi.fn<Runner>(async () => {
      throw new Error("ServiceUnavailable");
    });
    await expect(resolveSubject(run, "r", { id: "C1", mention: null })).rejects.toThrow("ServiceUnavailable");
  });
});

describe("runOperation", () => {
  const a = node("A", "A");
  const b = node("B", "B");
  const f = node("F", "F", "individual");
  it("passes subject ids as $a/$b, flattens rows, dedupes edges and numbers the facts from 1", async () => {
    const run = runner({ edges: [[fact(f, a, 10), fact(f, b, 5)], [fact(f, a, 10), fact(f, b, 5)]] });
    const facts = await runOperation(run, "r", "shared_funders", [
      { name: "A", kind: "committee", ids: ["A"], href: null },
      { name: "B", kind: "committee", ids: ["B", "B2"], href: null },
    ]);
    expect(run).toHaveBeenCalledTimes(CYPHER.shared_funders.length);
    expect(run.mock.calls[0][1]).toEqual({ race: "r", a: ["A"], b: ["B", "B2"] });
    expect(facts.map((x) => [x.n, x.from.id, x.to.id])).toEqual([
      [1, "F", "A"],
      [2, "F", "B"],
    ]);
  });
  it("keeps the same hop on different money paths as distinct facts, and support and oppose as distinct facts", async () => {
    const run = runner({ edges: [[fact(f, a, 1, { path: 0 }), fact(f, a, 1, { path: 1 })], [fact(a, b, 2, { rel: "TARGETED", support_oppose: "S" }), fact(a, b, 3, { rel: "TARGETED", support_oppose: "O" })]] });
    const facts = await runOperation(run, "r", "money_path", [{ name: "F", kind: "individual", ids: ["F"], href: null }, { name: "B", kind: "committee", ids: ["B"], href: null }]);
    expect(facts).toHaveLength(4);
  });
  it(`caps a result at ${MAX_FACTS} facts`, async () => {
    const many = Array.from({ length: MAX_FACTS + 20 }, (_, i) => fact(node(`F${i}`, `F${i}`), a, i));
    const facts = await runOperation(runner({ edges: [many] }), "r", "upstream", [{ name: "A", kind: "committee", ids: ["A"], href: null }]);
    expect(facts).toHaveLength(MAX_FACTS);
    expect(facts.at(-1)!.n).toBe(MAX_FACTS);
  });
});
