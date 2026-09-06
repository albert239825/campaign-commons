import neo4j from "neo4j-driver";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrailSubject } from "@campaign-commons/contracts";
import { exploreQuestion, pageCypher, queryHasMoreRows, rowSentence, toCells, validateCypher, type ExploreRow } from "./explore";
import { COMPLETION } from "./queries";

const node = { properties: { id: "C1", name: "ONE NATION", kind: "committee", href: "/races/r/entities/C1" } };
const candidateNode = { properties: { id: "S2PA00661", name: "DAVID MCCORMICK", kind: "candidate", href: "/races/r/candidates/S2PA00661" } };
const relationship = { elementId: "rel-1" };
const fact = {
  n: 1,
  from: { id: "C1", name: "ONE NATION", kind: "committee" as const, href: null },
  to: { id: "C2", name: "CASEY", kind: "candidate" as const, href: null },
  rel: "TARGETED" as const,
  amount: 1234,
  count: null,
  support_oppose: "S" as const,
  visibility: "disclosed" as const,
  first_date: null,
  last_date: null,
  source_url: "https://fec.example/record",
  path: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("validateCypher", () => {
  it.each([
    ["MERGE", "MATCH (x:Entity {race_id: $race}) MERGE (x) RETURN x"],
    ["CALL", "MATCH (x:Entity {race_id: $race}) CALL db.labels() RETURN x"],
    ["missing race", "MATCH (x:Entity) RETURN x"],
    ["extra parameter", "MATCH (x:Entity {race_id: $race}) WHERE x.id = $x RETURN x"],
    ["large limit", "MATCH (x:Entity {race_id: $race}) RETURN x LIMIT 500"],
    ["semicolon", "MATCH (x:Entity {race_id: $race}) RETURN x;"],
  ])("rejects %s", (_, cypher) => {
    expect(validateCypher(cypher).ok).toBe(false);
  });

  it("allows the word house in a string and rejects USE", () => {
    expect(validateCypher("MATCH (x:Entity {race_id: $race}) WHERE x.name CONTAINS 'house of' RETURN x").ok).toBe(true);
    expect(validateCypher("USE neo4j MATCH (x:Entity {race_id: $race}) RETURN x").ok).toBe(false);
  });

  it("adds a limit to a good query", () => {
    expect(validateCypher("MATCH (x:Entity {race_id: $race}) RETURN x")).toEqual({
      ok: true,
      cypher: "MATCH (x:Entity {race_id: $race}) RETURN x\nLIMIT 20",
    });
  });

  it("preserves an allowed limit", () => {
    expect(validateCypher("MATCH (x:Entity {race_id: $race}) RETURN x LIMIT 20")).toEqual({
      ok: true,
      cypher: "MATCH (x:Entity {race_id: $race}) RETURN x LIMIT 20",
    });
  });
});

describe("pageCypher", () => {
  it("bumps a single limit and adds the paging wrapper", () => {
    expect(pageCypher("MATCH (x:Entity {race_id: $race}) RETURN x LIMIT 20", 20)).toBe(
      "CALL {\nMATCH (x:Entity {race_id: $race}) RETURN x LIMIT 40\n}\nRETURN *\nSKIP 20\nLIMIT 20",
    );
  });

  it("bumps every branch limit in a UNION query", () => {
    expect(
      pageCypher(
        "MATCH (x:Entity {race_id: $race}) RETURN x LIMIT 20 UNION MATCH (y:Entity {race_id: $race}) RETURN y LIMIT 10",
        20,
      ),
    ).toBe(
      "CALL {\nMATCH (x:Entity {race_id: $race}) RETURN x LIMIT 40 UNION MATCH (y:Entity {race_id: $race}) RETURN y LIMIT 30\n}\nRETURN *\nSKIP 20\nLIMIT 20",
    );
  });
});

describe("queryHasMoreRows", () => {
  it("detects a full UNION branch as having more rows", () => {
    expect(queryHasMoreRows("RETURN 1 LIMIT 10 UNION RETURN 2 LIMIT 10", 10)).toBe(true);
    expect(queryHasMoreRows("RETURN 1 LIMIT 10 UNION RETURN 2 LIMIT 10", 7)).toBe(false);
  });

  it("treats a full single-limit result as having more rows", () => {
    expect(queryHasMoreRows("RETURN 1 LIMIT 20", 20)).toBe(true);
  });
});

describe("toCells and rowSentence", () => {
  it("converts nodes, relationships, integers and lists and hydrates edges", async () => {
    vi.spyOn(neo4j, "isPath").mockReturnValue(false);
    vi.spyOn(neo4j, "isNode").mockImplementation((value) => value === node);
    vi.spyOn(neo4j, "isRelationship").mockImplementation((value) => value === relationship);
    const result = await toCells(
      [{ spender: node, edge: relationship, amount: neo4j.int(1234), names: ["ONE", "TWO"] }],
      async () => new Map([["rel-1", fact]]),
    );
    expect(result).toMatchObject({
      ok: true,
      columns: ["spender", "edge", "amount", "names"],
      rows: [
        {
          n: 1,
          cells: {
            spender: { t: "node", node: { name: "ONE NATION" } },
            edge: { t: "edge", fact: { n: 1, amount: 1234 } },
            amount: { t: "number", value: 1234 },
            names: { t: "list", values: ["ONE", "TWO"] },
          },
        },
      ],
    });
  });

  it("rejects paths", async () => {
    const path = {};
    vi.spyOn(neo4j, "isPath").mockImplementation((value) => value === path);
    expect(await toCells([{ path }], async () => new Map())).toEqual({ ok: false, reason: "return nodes/relationships, not paths" });
  });

  it("formats rows deterministically", () => {
    const row: ExploreRow = {
      n: 1,
      cells: {
        spender: { t: "text", value: "SENATE LEADERSHIP FUND" },
        dark_dollars: { t: "number", value: 36_000_000 },
        funders: { t: "list", values: ["ONE NATION", "CROSSROADS GPS"] },
      },
    };
    expect(rowSentence(row)).toBe("spender: SENATE LEADERSHIP FUND; dark_dollars: $36,000,000; funders: ONE NATION, CROSSROADS GPS");
  });
});

const completion = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
const subjects: TrailSubject[] = [{ id: "CANDIDATE", kind: "candidate", name: "Bob Casey", aliases: ["casey"], type_label: null, principal_committee_id: "COMMITTEE" }];
const good = "MATCH (x:Entity {race_id: $race}) RETURN x";

function stubResponses(composer: unknown[], narrator: unknown = { narrative: "The query returned 3 records [1]." }) {
  let i = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const body = JSON.parse(init!.body as string) as { response_format: { json_schema: { name: string } } };
    if (body.response_format.json_schema.name === "money_trails_explore_query") return completion(composer[Math.min(i++, composer.length - 1)]);
    return completion(narrator);
  });
  return fetch;
}

describe("exploreQuestion", () => {
  it("runs a validated page without calling the composer and numbers rows after the offset", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const run = vi.fn(async () => ({ records: [{ amount: 3 }, { amount: 2 }], queryType: "r" }));
    const result = await exploreQuestion("race", "how much?", subjects, { run, llm: { apiKey: "key", fetch } }, "answer", {
      cypher: good,
      offset: 20,
    });
    expect(result).toMatchObject({
      kind: "explore",
      rows: [{ n: 21 }, { n: 22 }],
      narrative: { status: "withheld", reason: "paged" },
      diagram: null,
      context: [],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(pageCypher(`${good}\nLIMIT 20`, 20), { race: "race" }, { timeoutMs: 8000 });
  });

  it("rejects an invalid page query without calling the composer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const run = vi.fn();
    const result = await exploreQuestion("race", "how much?", subjects, { run, llm: { apiKey: "key", fetch } }, "answer", {
      cypher: "MATCH (x:Entity) RETURN x",
      offset: 20,
    });
    expect(result).toEqual({ kind: "unsupported", reason: "rejected_query", message: "The exploratory query did not meet the graph's read-only rules." });
    expect(fetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("retries a rejected query and narrates the returned rows", async () => {
    const fetch = stubResponses([{ cypher: "MATCH (x:Entity {race_id: $race}) MERGE (x) RETURN x", description: "bad" }, { cypher: good, description: "A good result." }]);
    const run = vi.fn(async () => ({ records: [{ amount: 3 }], queryType: "r" }));
    const result = await exploreQuestion("race", "how much?", subjects, { run, llm: { apiKey: "key", fetch } });
    expect(result).toMatchObject({ kind: "explore", description: "A good result.", rows: [{ n: 1 }], narrative: { status: "ok" }, diagram: null });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("builds a Sankey diagram only in graph mode", async () => {
    vi.spyOn(neo4j, "isPath").mockReturnValue(false);
    vi.spyOn(neo4j, "isRelationship").mockImplementation((value) => value === relationship);
    const fetch = stubResponses([{ cypher: good, description: "A flow." }], { narrative: "The query returned $1,234 [1]." });
    const run = vi.fn(async (cypher: string) => {
      if (cypher === COMPLETION) return { records: [{ edge: fact }], queryType: "r" };
      if (cypher.includes("elementId(r)")) return { records: [{ eid: "rel-1", edge: fact }], queryType: "r" };
      return { records: [{ edge: relationship }], queryType: "r" };
    });
    const result = await exploreQuestion("race", "show flows", subjects, { run, llm: { apiKey: "key", fetch } }, "graph");
    expect(result).toMatchObject({ kind: "explore", context: [{ n: 2, amount: 1234 }], diagram: { ok: true, links: [{ n: 1, amount: 1234 }] } });
    expect(run).toHaveBeenCalledWith(COMPLETION, { race: "race", ids: ["C1"], cands: ["C2"] }, { timeoutMs: 8000 });
  });

  it("limits completion to candidates mentioned in the rows", async () => {
    vi.spyOn(neo4j, "isPath").mockReturnValue(false);
    vi.spyOn(neo4j, "isNode").mockImplementation((value) => value === node || value === candidateNode);
    const fetch = stubResponses([{ cypher: good, description: "A result." }], { narrative: "The query returned 1 record [1]." });
    const run = vi.fn(async (cypher: string) => {
      if (cypher === COMPLETION) return { records: [], queryType: "r" };
      return { records: [{ committee: node, candidate: candidateNode }], queryType: "r" };
    });
    await exploreQuestion("race", "notable donors of David McCormick", subjects, { run, llm: { apiKey: "key", fetch } }, "graph");
    expect(run).toHaveBeenCalledWith(COMPLETION, { race: "race", ids: ["C1"], cands: ["S2PA00661"] }, { timeoutMs: 8000 });
  });

  it("leaves completion candidates empty when rows mention committees only", async () => {
    vi.spyOn(neo4j, "isPath").mockReturnValue(false);
    vi.spyOn(neo4j, "isNode").mockImplementation((value) => value === node);
    const fetch = stubResponses([{ cypher: good, description: "A result." }], { narrative: "The query returned 1 record [1]." });
    const run = vi.fn(async (cypher: string) => {
      if (cypher === COMPLETION) return { records: [], queryType: "r" };
      return { records: [{ committee: node }], queryType: "r" };
    });
    await exploreQuestion("race", "show committee flows", subjects, { run, llm: { apiKey: "key", fetch } }, "graph");
    expect(run).toHaveBeenCalledWith(COMPLETION, { race: "race", ids: ["C1"], cands: [] }, { timeoutMs: 8000 });
  });

  it("keeps the answer when completion fails and never completes answer mode", async () => {
    const fetch = stubResponses([{ cypher: good, description: "A result." }]);
    const graphRun = vi.fn(async (cypher: string) => {
      if (cypher === COMPLETION) throw new Error("completion unavailable");
      if (cypher.includes("elementId(r)")) return { records: [{ eid: "rel-1", edge: fact }], queryType: "r" };
      return { records: [{ edge: relationship }], queryType: "r" };
    });
    vi.spyOn(neo4j, "isPath").mockReturnValue(false);
    vi.spyOn(neo4j, "isRelationship").mockImplementation((value) => value === relationship);
    const graph = await exploreQuestion("race", "show flows", subjects, { run: graphRun, llm: { apiKey: "key", fetch } }, "graph");
    expect(graph).toMatchObject({ kind: "explore", context: [] });

    const answerRun = vi.fn(async (cypher: string) => {
      void cypher;
      return { records: [{ amount: 3 }], queryType: "r" };
    });
    const answer = await exploreQuestion("race", "how much?", subjects, { run: answerRun, llm: { apiKey: "key", fetch } });
    expect(answer).toMatchObject({ kind: "explore", context: [], diagram: null });
    expect(answerRun.mock.calls.some(([cypher]) => cypher === COMPLETION)).toBe(false);
  });

  it("returns rejected_query after two invalid queries", async () => {
    const fetch = stubResponses([{ cypher: "MATCH (x:Entity {race_id: $race}) MERGE (x) RETURN x", description: "bad" }, { cypher: "MATCH (x:Entity {race_id: $race}) CALL db.labels() RETURN x", description: "bad" }]);
    const result = await exploreQuestion("race", "nope", subjects, { run: vi.fn(), llm: { apiKey: "key", fetch } });
    expect(result).toEqual({ kind: "unsupported", reason: "rejected_query", message: "The exploratory query did not meet the graph's read-only rules." });
  });

  it("handles no query and empty results", async () => {
    let fetch = stubResponses([{ cypher: "", description: "No matching filed record." }]);
    expect(await exploreQuestion("race", "nope", subjects, { run: vi.fn(), llm: { apiKey: "key", fetch } })).toEqual({
      kind: "unsupported",
      reason: "no_query",
      message: "That question cannot be answered from the filed records in this graph. No matching filed record.",
    });

    fetch = stubResponses([{ cypher: good, description: "A result." }]);
    expect(await exploreQuestion("race", "nope", subjects, { run: vi.fn(async () => ({ records: [], queryType: "r" })), llm: { apiKey: "key", fetch } })).toEqual({
      kind: "unsupported",
      reason: "empty",
      message: "The query ran and returned no rows: nothing in this race's filed records matches.",
    });
  });

  it("rejects a non-read query type and withholds an ungrounded narrative", async () => {
    const fetch = stubResponses([{ cypher: good, description: "A result." }]);
    expect(await exploreQuestion("race", "nope", subjects, { run: vi.fn(async () => ({ records: [{ value: 3 }], queryType: "w" })), llm: { apiKey: "key", fetch } })).toMatchObject({
      kind: "unsupported",
      reason: "rejected_query",
    });

    const fetch2 = stubResponses([{ cypher: good, description: "A result." }], { narrative: "The query returned 999 records [1]." });
    const result = await exploreQuestion("race", "nope", subjects, { run: vi.fn(async () => ({ records: [{ value: 3 }], queryType: "r" })), llm: { apiKey: "key", fetch: fetch2 } });
    expect(result).toMatchObject({ kind: "explore", narrative: { status: "withheld", reason: "unknown_number" } });
  });
});
