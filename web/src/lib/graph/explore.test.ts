import neo4j from "neo4j-driver";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrailSubject } from "@campaign-commons/contracts";
import { exploreQuestion, rowSentence, toCells, validateCypher, type ExploreRow } from "./explore";

const node = { properties: { id: "C1", name: "ONE NATION", kind: "committee", href: "/races/r/entities/C1" } };
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
    const run = vi.fn(async (cypher: string) =>
      cypher.includes("elementId(r)")
        ? { records: [{ eid: "rel-1", edge: fact }], queryType: "r" }
        : { records: [{ edge: relationship }], queryType: "r" },
    );
    const result = await exploreQuestion("race", "show flows", subjects, { run, llm: { apiKey: "key", fetch } }, "graph");
    expect(result).toMatchObject({ kind: "explore", diagram: { ok: true, links: [{ n: 1, amount: 1234 }] } });
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
