import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRAPH_MAX_IN_FLIGHT, GRAPH_RATE_PER_MINUTE } from "@/lib/graph/limits";
import type { AskGraphResponse } from "@/lib/graph/facts";
import * as neo4j from "@/lib/graph/neo4j";
import type { Runner } from "@/lib/graph/neo4j";
import { getTrails } from "@/lib/data";
import { POST as routePOST } from "../ask-route/route";
import { POST } from "./route";

const trails = getTrails("pa-sen-2024");
const winsenate = trails.subjects.find((s) => s.name === "WINSENATE")!;

let nextClient = 0;
const post = async (body: unknown, raw = false, client = `10.1.0.${++nextClient}`) => {
  const res = await POST(
    new Request("http://localhost/api/ask-graph", {
      method: "POST",
      body: raw ? (body as string) : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": `${client}, 172.16.0.1` },
    }),
  );
  return { status: res.status, headers: res.headers, body: (await res.json()) as AskGraphResponse & { error?: string } };
};
const ask = (question: string) => post({ raceId: "pa-sen-2024", question });

const completion = (content: unknown) => Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(content) } }] });
/** Stub global fetch so the classifier gets `pick` and the narrator gets `narrative`. */
const stubModel = (pick: unknown, narrative: unknown = { narrative: "" }) => {
  const f = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(init!.body as string) as { response_format: { json_schema: { name: string } } };
    return completion(body.response_format.json_schema.name === "money_trails_graph_pick" ? pick : narrative);
  });
  vi.stubGlobal("fetch", f);
  return f;
};
/** Stand in for the Neo4j driver with a Runner over a tiny graph. */
const stubGraph = (run: Runner) => {
  vi.spyOn(neo4j, "getDriver").mockReturnValue({ driver: {} as never });
  vi.spyOn(neo4j, "runnerFor").mockReturnValue(run);
  return run;
};
const w = { id: winsenate.id, name: winsenate.name, kind: "committee", href: null, title: null };
const slf = { id: "C00571703", name: "SENATE LEADERSHIP FUND", kind: "committee", href: null, title: null };
const tinyGraph: Runner = async (cypher) => {
  if (cypher.includes("$ids")) return [{ node: w }];
  if (cypher.includes("$tokens")) return [];
  return [{ edges: [{ from: slf, to: w, rel: "GAVE", amount: 1_000_000, count: 2, support_oppose: null, visibility: "disclosed", first_date: null, last_date: null, source_url: "https://www.fec.gov/x", path: null }] }];
};
const upstream = { op: "upstream", subjects: [{ id: winsenate.id, mention: null }] };

beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("XAI_API_KEY", "k");
  vi.stubEnv("NEO4J_URI", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/ask-graph input", () => {
  it("400 on non-JSON, missing fields, blank or over-long questions", async () => {
    expect((await post("not json", true)).status).toBe(400);
    expect((await post({ raceId: "pa-sen-2024" })).status).toBe(400);
    expect((await post({ question: "who funds winsenate's funders" })).status).toBe(400);
    expect((await ask("   ")).status).toBe(400);
    expect((await ask("x".repeat(501))).status).toBe(400);
  });
  it("404 on a race without trails, before any model or graph call", async () => {
    const f = stubModel(upstream);
    const get = vi.spyOn(neo4j, "getDriver");
    expect((await post({ raceId: "nope-2024", question: "who funds winsenate's funders" })).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask-graph without a graph", () => {
  it("answers 200 with a typed graph_unavailable refusal when NEO4J_URI is unset, calling no model", async () => {
    const f = stubModel(upstream);
    const r = await ask("who funds winsenate's funders");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "unsupported", reason: "graph_unavailable" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask-graph with a graph", () => {
  it("returns facts with sources and the guarded narrative, and never caches", async () => {
    stubGraph(tinyGraph);
    stubModel(upstream, { narrative: "SENATE LEADERSHIP FUND gave $1,000,000 to WINSENATE [1]." });
    const r = await ask("who funds winsenate's funders");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.body).toMatchObject({
      kind: "graph",
      op: "upstream",
      facts: [{ n: 1, source_url: "https://www.fec.gov/x" }],
      narrative: { status: "ok", text: "SENATE LEADERSHIP FUND gave $1,000,000 to WINSENATE [1]." },
    });
  });
  it("turns a driver failure into a typed refusal, not a 500", async () => {
    stubGraph(async () => {
      throw new Error("ServiceUnavailable");
    });
    stubModel(upstream);
    const r = await ask("who funds winsenate's funders");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "unsupported", reason: "query_failed" });
  });
});

describe("POST /api/ask-graph spend guard", () => {
  it(`429 after ${GRAPH_RATE_PER_MINUTE} questions a minute from one address, without calling the model`, async () => {
    stubGraph(tinyGraph);
    const f = stubModel(upstream);
    const from = (q: string) => post({ raceId: "pa-sen-2024", question: q }, false, "203.0.113.77");
    for (let i = 0; i < GRAPH_RATE_PER_MINUTE; i++) expect((await from(`who funds winsenate's funders ${i}`)).status).toBe(200);
    const calls = f.mock.calls.length;
    const limited = await from("again");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(f).toHaveBeenCalledTimes(calls);
    expect((await ask("who funds winsenate's funders")).status).toBe(200);
  });
  it(`429 once ${GRAPH_MAX_IN_FLIGHT} questions are in flight`, async () => {
    const settle: (() => void)[] = [];
    let held = true;
    stubGraph(tinyGraph);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        () =>
          new Promise<Response>((resolve) => {
            const done = () => resolve(completion({ op: "none", subjects: [] }));
            if (held) settle.push(done);
            else done();
          }),
      ),
    );
    const inFlight = Array.from({ length: GRAPH_MAX_IN_FLIGHT }, (_, i) => ask(`who funds winsenate's funders ${i}`));
    await vi.waitFor(() => expect(settle).toHaveLength(GRAPH_MAX_IN_FLIGHT));
    const extra = await ask("one more");
    expect(extra.status).toBe(429);
    held = false;
    settle.forEach((s) => s());
    for (const r of await Promise.all(inFlight)) expect(r.status).toBe(200);
    expect((await ask("after they settle")).status).toBe(200);
  });
});

describe("/api/ask-route is untouched by graph mode", () => {
  it("still answers as a Resolution with via, never opens the graph and never returns graph fields", async () => {
    const get = vi.spyOn(neo4j, "getDriver");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => completion({ route: { intent: "committee_funding", subjectId: winsenate.id, issueId: null } })));
    const res = await routePOST(
      new Request("http://localhost/api/ask-route", { method: "POST", body: JSON.stringify({ raceId: "pa-sen-2024", question: "who funds winsenate" }), headers: { "content-type": "application/json" } }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ kind: "answer", intent: "committee_funding", via: "llm" });
    expect(Object.keys(body).sort()).toEqual(["intent", "issueId", "kind", "matched", "note", "subject", "via"]);
    expect(get).not.toHaveBeenCalled();
  });
});
