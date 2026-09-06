import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TrailsSchema } from "@campaign-commons/contracts";
import { XAI_CHAT_COMPLETIONS_URL } from "../ask-llm";
import { answerGraphQuestion } from "./ask-graph";
import type { GraphFact, GraphNodeRef } from "./facts";
import type { Runner } from "./neo4j";

const trails = TrailsSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "..", "data", "out", "pa-sen-2024", "trails.json"), "utf8")));
const casey = trails.subjects.find((s) => s.name === "Bob Casey")!;
const caseyCommittee = trails.subjects.find((s) => s.id === casey.principal_committee_id)!;
const winsenate = trails.subjects.find((s) => s.name === "WINSENATE")!;

const node = (id: string, name: string, kind: GraphNodeRef["kind"] = "committee"): GraphNodeRef => ({ id, name, kind, href: null });
const musk = node("ind:MUSK_ELON|1", "MUSK, ELON", "individual");
const slf = node("C00571703", "SENATE LEADERSHIP FUND");
const edge = (from: GraphNodeRef, to: GraphNodeRef, amount: number, extra: Partial<Omit<GraphFact, "n">> = {}): Omit<GraphFact, "n"> => ({
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

/** A graph with a few named nodes and a canned operation result. */
const graph = (nodes: GraphNodeRef[], edges: Omit<GraphFact, "n">[] = []) =>
  vi.fn<Runner>(async (cypher, params) => {
    if (cypher.includes("$ids")) return nodes.filter((n) => (params.ids as string[]).includes(n.id)).map((n) => ({ node: n }));
    if (cypher.includes("$tokens")) return nodes.filter((n) => (params.tokens as string[]).every((t) => n.name.toLowerCase().includes(t))).map((n) => ({ node: n }));
    return [{ edges }];
  });

/** A model that answers the classifier with `pick` and the narrator with `narrative`, recording what it was asked. */
const model = (pick: unknown, narrative: unknown = { narrative: "" }) => {
  const f = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(init!.body as string) as { response_format: { json_schema: { name: string } } };
    const content = body.response_format.json_schema.name === "money_trails_graph_pick" ? pick : narrative;
    return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(content) } }] });
  });
  return f;
};
const llm = (f: typeof fetch) => ({ apiKey: "k", fetch: f });
const ask = (question: string, run: Runner | null, f: typeof fetch) => answerGraphQuestion("pa-sen-2024", question, trails.subjects, { run, llm: llm(f) });

describe("answerGraphQuestion: refusals before any model or graph call", () => {
  it("refuses deterministically when Neo4j is not configured, without calling the model", async () => {
    const f = model({ op: "upstream", subjects: [{ id: winsenate.id, mention: null }] });
    const r = await ask("who funds winsenate's funders", null, f);
    expect(r).toMatchObject({ kind: "unsupported", reason: "graph_unavailable" });
    expect(f).not.toHaveBeenCalled();
  });
  it("refuses deterministically when no API key is set, without touching the graph", async () => {
    const run = graph([]);
    const r = await answerGraphQuestion("pa-sen-2024", "q", trails.subjects, { run, llm: { apiKey: "", fetch: model({}) } });
    expect(r).toMatchObject({ kind: "unsupported", reason: "graph_unavailable" });
    expect(run).not.toHaveBeenCalled();
  });
  it("refuses with no_operation when the model picks none or something off the list, and does not query the graph", async () => {
    for (const pick of [{ op: "none", subjects: [] }, { op: "count_everything", subjects: [{ id: winsenate.id, mention: null }] }, "not json"]) {
      const run = graph([]);
      const r = await ask("what is the weather in pittsburgh", run, model(pick));
      expect(r).toMatchObject({ kind: "unsupported", reason: "no_operation" });
      expect(run).not.toHaveBeenCalled();
    }
  });
});

describe("answerGraphQuestion: subject validation", () => {
  it("refuses a mention that is not in the race's records", async () => {
    const r = await ask("where did Nobody's money go", graph([musk]), model({ op: "funder_reach", subjects: [{ id: null, mention: "Nobody At All" }] }));
    expect(r).toMatchObject({ kind: "unsupported", reason: "subject_not_found" });
  });
  it("refuses an ambiguous mention and returns the names for the asker to choose from", async () => {
    const a = node("a", "SMITH, JOHN A", "individual");
    const b = node("b", "SMITH, JOHN B", "individual");
    const r = await ask("where did John Smith's money go", graph([a, b]), model({ op: "funder_reach", subjects: [{ id: null, mention: "John Smith" }] }));
    expect(r).toEqual({ kind: "unsupported", reason: "ambiguous_subject", message: expect.stringContaining("More than one name"), matches: [a, b] });
  });
  it("refuses a subject of the wrong kind for its position (a person cannot be the 'to' of a money path)", async () => {
    const r = await ask("does WinSenate's money reach Musk", graph([musk, node(winsenate.id, winsenate.name)]), model({ op: "money_path", subjects: [{ id: winsenate.id, mention: null }, { id: null, mention: "Elon Musk" }] }));
    expect(r).toMatchObject({ kind: "unsupported", reason: "wrong_kind" });
  });
  it("refuses the same subject twice", async () => {
    const w = node(winsenate.id, winsenate.name);
    const r = await ask("what do WinSenate and WinSenate share", graph([w]), model({ op: "shared_funders", subjects: [{ id: winsenate.id, mention: null }, { id: winsenate.id, mention: null }] }));
    expect(r).toMatchObject({ kind: "unsupported", reason: "wrong_kind" });
  });
  it("reads a candidate as their campaign committee for funding-side operations and says so", async () => {
    const cc = node(caseyCommittee.id, caseyCommittee.name);
    const run = graph([cc, node(casey.id, casey.name, "candidate")], [edge(slf, cc, 5000)]);
    const r = await ask("who funds Casey's funders", run, model({ op: "upstream", subjects: [{ id: casey.id, mention: null }] }));
    expect(r).toMatchObject({ kind: "graph", op: "upstream", subjects: [{ ids: [caseyCommittee.id] }], note: `${casey.name} is read as their campaign committee.` });
    const opCall = run.mock.calls.find(([c]) => !c.includes("$ids") && !c.includes("$tokens"))!;
    expect(opCall[1]).toMatchObject({ a: [caseyCommittee.id] });
  });
  it("keeps a candidate as the candidate node for a money path, where the answer is who spent for or against them", async () => {
    const cand = node(casey.id, casey.name, "candidate");
    const run = graph([musk, cand], [edge(musk, slf, 10_000_000, { path: 0 }), edge(slf, cand, 52_799_240, { rel: "TARGETED", support_oppose: "O", path: 0 })]);
    const r = await ask("does Musk's money reach Casey", run, model({ op: "money_path", subjects: [{ id: null, mention: "Elon Musk" }, { id: casey.id, mention: null }] }, { narrative: "" }));
    expect(r).toMatchObject({ kind: "graph", op: "money_path", note: null, subjects: [{ ids: [musk.id] }, { ids: [casey.id] }] });
    expect(r.kind === "graph" && r.facts.map((f) => f.rel)).toEqual(["GAVE", "TARGETED"]);
  });
});

describe("answerGraphQuestion: facts and narration", () => {
  it("returns typed query_failed when the graph errors, and never narrates", async () => {
    const run = vi.fn<Runner>(async () => {
      throw new Error("ServiceUnavailable");
    });
    const f = model({ op: "upstream", subjects: [{ id: winsenate.id, mention: null }] }, { narrative: "anything [1]." });
    const r = await ask("who funds winsenate's funders", run, f);
    expect(r).toMatchObject({ kind: "unsupported", reason: "query_failed" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("narrates only after the facts are in hand and only from them; the response carries facts, sources and the narrative", async () => {
    const w = node(winsenate.id, winsenate.name);
    const run = graph([w], [edge(slf, w, 1_000_000, { count: 3, first_date: "2024-01-02", last_date: "2024-09-30" })]);
    const f = model({ op: "upstream", subjects: [{ id: winsenate.id, mention: null }] }, { narrative: "SENATE LEADERSHIP FUND gave $1,000,000 to WINSENATE [1]." });
    const r = await ask("who funds winsenate's funders", run, f);
    expect(r).toEqual({
      kind: "graph",
      op: "upstream",
      subjects: [{ name: winsenate.name, kind: "committee", ids: [winsenate.id], href: null }],
      note: null,
      facts: [expect.objectContaining({ n: 1, from: slf, to: w, amount: 1_000_000, source_url: "https://www.fec.gov/x" })],
      narrative: { status: "ok", text: "SENATE LEADERSHIP FUND gave $1,000,000 to WINSENATE [1]." },
    });
    // second model call is the narrator, made after the operation ran, with the fact sentence and no graph internals
    expect(f).toHaveBeenCalledTimes(2);
    const narratorBody = JSON.parse(f.mock.calls[1][1]!.body as string) as { messages: { content: string }[] };
    expect(narratorBody.messages[1].content).toContain("[1] SENATE LEADERSHIP FUND gave $1,000,000 to WINSENATE (3 contributions).");
    expect(narratorBody.messages[1].content).not.toContain("fec.gov");
    expect(f.mock.calls[1][0]).toBe(XAI_CHAT_COMPLETIONS_URL);
    expect(run.mock.invocationCallOrder[run.mock.invocationCallOrder.length - 1]).toBeLessThan(f.mock.invocationCallOrder[1]);
  });
  it("withholds a narrative that states a number the facts do not contain; the facts still come back", async () => {
    const w = node(winsenate.id, winsenate.name);
    const run = graph([w], [edge(slf, w, 1_000_000)]);
    const r = await ask("who funds winsenate's funders", run, model({ op: "upstream", subjects: [{ id: winsenate.id, mention: null }] }, { narrative: "SLF gave $1,000,000 to WinSenate [1], one of 12 gifts [1]." }));
    expect(r).toMatchObject({ kind: "graph", facts: [expect.objectContaining({ n: 1 })], narrative: { status: "withheld", reason: "unknown_number" } });
  });
  it("returns an empty fact list with the narrator skipped when nothing connects the subjects", async () => {
    const w = node(winsenate.id, winsenate.name);
    const f = model({ op: "money_path", subjects: [{ id: null, mention: "Elon Musk" }, { id: winsenate.id, mention: null }] }, { narrative: "Nothing [1]." });
    const r = await ask("does Musk's money reach WinSenate", graph([musk, w], []), f);
    expect(r).toMatchObject({ kind: "graph", facts: [], narrative: { status: "unavailable" } });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
