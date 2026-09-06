import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrailsSchema } from "@campaign-commons/contracts";
import { ASK_LLM_TIMEOUT_MS, XAI_CHAT_COMPLETIONS_URL } from "../ask-llm";
import { factSentence, type GraphFact, type GraphNodeRef } from "./facts";
import { allowedNumbers, buildClassifyBody, buildNarrateBody, checkNarrative, classifyGraph, narrate, NARRATE_TIMEOUT_MS, NARRATIVE_MAX_CHARS, validatePick } from "./llm";

const trails = TrailsSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "..", "data", "out", "pa-sen-2024", "trails.json"), "utf8")));
const casey = trails.subjects.find((s) => s.name === "Bob Casey")!;
const winsenate = trails.subjects.find((s) => s.name === "WINSENATE")!;

const completion = (content: unknown) => ({ choices: [{ message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }] });
const fetchReturning = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const neverResolving = vi.fn<typeof fetch>(
  (_url, init) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
);

const node = (id: string, name: string, kind: GraphNodeRef["kind"] = "committee"): GraphNodeRef => ({ id, name, kind, href: null });
const musk = node("ind:MUSK_ELON|1", "MUSK, ELON", "individual");
const slf = node("C00571703", "SENATE LEADERSHIP FUND");
const thune = node("C1", "2024 THUNE REPUBLICAN SENATE VICTORY");
const caseyNode = node(casey.id, "Bob Casey", "candidate");
const facts: GraphFact[] = [
  { n: 1, from: musk, to: slf, rel: "GAVE", amount: 10_000_000, count: 2, support_oppose: null, visibility: "disclosed", first_date: "2024-07-01", last_date: "2024-10-03", source_url: "https://www.fec.gov/a", path: null },
  { n: 2, from: slf, to: caseyNode, rel: "TARGETED", amount: 52_799_240, count: null, support_oppose: "O", visibility: "disclosed", first_date: null, last_date: null, source_url: "https://www.fec.gov/b", path: null },
  { n: 3, from: thune, to: slf, rel: "GAVE", amount: 150_590.5, count: null, support_oppose: null, visibility: "inferable", first_date: null, last_date: null, source_url: null, path: null },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("buildClassifyBody", () => {
  it("constrains the pick to the fixed operations plus none, and ids to the race's closed list; carries no graph data", () => {
    const body = buildClassifyBody("who funds winsenate's funders", trails.subjects, "grok-4.5");
    expect(body.response_format.json_schema.strict).toBe(true);
    const schema = body.response_format.json_schema.schema;
    expect(schema.properties.op.enum).toEqual(["shared_funders", "money_path", "funder_reach", "upstream", "none"]);
    expect(schema.properties.subjects.items.properties.id.anyOf[0].enum).toEqual(trails.subjects.map((s) => s.id));
    expect(schema.properties.subjects.maxItems).toBe(2);
    const text = JSON.stringify(body);
    expect(text).toContain(`${winsenate.id} (committee): WINSENATE`);
    expect(text).not.toContain(trails.answers[0].headline);
    expect(text).not.toContain("MATCH");
  });
});

describe("validatePick (closed-set layer)", () => {
  it("accepts a known op with the right number of subjects, each an on-list id or a bounded mention", () => {
    expect(validatePick({ op: "shared_funders", subjects: [{ id: winsenate.id, mention: null }, { id: null, mention: " Women Vote " }] }, trails.subjects)).toEqual({
      op: "shared_funders",
      subjects: [
        { id: winsenate.id, mention: null },
        { id: null, mention: "Women Vote" },
      ],
    });
  });
  it("rejects op none, an unknown op, and non-objects", () => {
    expect(validatePick({ op: "none", subjects: [] }, trails.subjects)).toBeNull();
    expect(validatePick({ op: "delete_everything", subjects: [{ id: winsenate.id, mention: null }] }, trails.subjects)).toBeNull();
    expect(validatePick(null, trails.subjects)).toBeNull();
    expect(validatePick("upstream", trails.subjects)).toBeNull();
  });
  it("rejects the wrong number of subjects for the op", () => {
    expect(validatePick({ op: "upstream", subjects: [] }, trails.subjects)).toBeNull();
    expect(validatePick({ op: "upstream", subjects: [{ id: winsenate.id, mention: null }, { id: casey.id, mention: null }] }, trails.subjects)).toBeNull();
    expect(validatePick({ op: "money_path", subjects: [{ id: null, mention: "Elon Musk" }] }, trails.subjects)).toBeNull();
  });
  it("rejects a well-formed but off-list id, and an empty or oversized mention", () => {
    expect(validatePick({ op: "upstream", subjects: [{ id: "C00000000", mention: null }] }, trails.subjects)).toBeNull();
    expect(validatePick({ op: "upstream", subjects: [{ id: null, mention: "   " }] }, trails.subjects)).toBeNull();
    expect(validatePick({ op: "upstream", subjects: [{ id: null, mention: "x".repeat(121) }] }, trails.subjects)).toBeNull();
    expect(validatePick({ op: "upstream", subjects: [{ id: null, mention: null }] }, trails.subjects)).toBeNull();
  });
  it("an id wins over a mention on the same subject; the mention is dropped", () => {
    expect(validatePick({ op: "upstream", subjects: [{ id: winsenate.id, mention: "something else" }] }, trails.subjects)).toEqual({ op: "upstream", subjects: [{ id: winsenate.id, mention: null }] });
  });
});

describe("classifyGraph", () => {
  it("returns null without a network call when no API key is set", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const f = fetchReturning(completion({ op: "upstream", subjects: [{ id: winsenate.id, mention: null }] }));
    expect(await classifyGraph("who funds winsenate's funders", trails.subjects, { fetch: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("posts to the xAI endpoint with the key only in the header and returns the validated pick", async () => {
    const f = fetchReturning(completion({ op: "upstream", subjects: [{ id: winsenate.id, mention: null }] }));
    const pick = await classifyGraph("who funds winsenate's funders", trails.subjects, { apiKey: "k-test", fetch: f });
    expect(pick).toEqual({ op: "upstream", subjects: [{ id: winsenate.id, mention: null }] });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(XAI_CHAT_COMPLETIONS_URL);
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer k-test");
    expect(init!.body).not.toContain("k-test");
  });
  it("returns null on malformed JSON, a non-2xx status, an off-list id, and a provider error", async () => {
    const opts = (f: typeof fetch) => ({ apiKey: "k", fetch: f });
    expect(await classifyGraph("q", trails.subjects, opts(fetchReturning(completion("{not json"))))).toBeNull();
    expect(await classifyGraph("q", trails.subjects, opts(fetchReturning({ error: "rate limited" }, 429)))).toBeNull();
    expect(await classifyGraph("q", trails.subjects, opts(fetchReturning(completion({ op: "upstream", subjects: [{ id: "C00000000", mention: null }] }))))).toBeNull();
    expect(
      await classifyGraph(
        "q",
        trails.subjects,
        opts(
          vi.fn<typeof fetch>(async () => {
            throw new TypeError("fetch failed");
          }),
        ),
      ),
    ).toBeNull();
  });
  it("aborts at the classifier budget and returns null", async () => {
    vi.useFakeTimers();
    const p = classifyGraph("q", trails.subjects, { apiKey: "k", fetch: neverResolving });
    await vi.advanceTimersByTimeAsync(ASK_LLM_TIMEOUT_MS + 1);
    expect(await p).toBeNull();
  });
});

describe("factSentence / allowedNumbers", () => {
  it("writes independent spending as spending against a candidate, never as money to them", () => {
    expect(factSentence(facts[1])).toBe("SENATE LEADERSHIP FUND spent $52,799,240 opposing Bob Casey (independent spending; none of it goes to the candidate).");
    expect(factSentence(facts[0])).toBe("MUSK, ELON gave $10,000,000 to SENATE LEADERSHIP FUND (2 contributions).");
    expect(factSentence(facts[2])).toBe("2024 THUNE REPUBLICAN SENATE VICTORY gave $150,591 to SENATE LEADERSHIP FUND [inferable].");
  });
  it("allows amounts, counts, years, digits in names and the fact count", () => {
    const allowed = allowedNumbers(facts);
    for (const n of [10_000_000, 52_799_240, 150_591, 150_590.5, 2, 2024, 3]) expect(allowed).toContain(n);
    expect(allowed).not.toContain(7);
  });
});

describe("checkNarrative (narrative guard)", () => {
  it("accepts text whose every number is a fact number and whose every numeric sentence is cited", () => {
    expect(checkNarrative("Elon Musk gave $10,000,000 to Senate Leadership Fund [1]. That committee spent $52,799,240 opposing Bob Casey [2].", facts)).toEqual({ ok: true });
    expect(checkNarrative("Musk gave $10 million to the fund, which spent $52.8 million against Casey [1][2].", facts)).toEqual({ ok: true });
    expect(checkNarrative("Musk gave $10,000,000 to the fund. [1] It spent $52,799,240 opposing Casey. [2]", facts)).toEqual({ ok: true });
  });
  it("does not split a sentence at the periods inside a filed name", () => {
    expect(checkNarrative("NAU, JOHN L. MR. III gave $10,000,000 to SENATE LEADERSHIP FUND [1].", facts)).toEqual({ ok: true });
  });
  it("rejects an uncited number", () => {
    expect(checkNarrative("Musk gave $10,000,000 to the fund. It spent $52,799,240 opposing Casey [2].", facts)).toEqual({ ok: false, reason: "uncited_number" });
  });
  it("rejects a number that is not in the facts, including sums and rounded-away figures", () => {
    expect(checkNarrative("In all, $62,799,240 moved [1][2].", facts)).toEqual({ ok: false, reason: "unknown_number" });
    expect(checkNarrative("Musk gave about $11 million [1].", facts)).toEqual({ ok: false, reason: "unknown_number" });
    expect(checkNarrative("The fund ran 40 ads [2].", facts)).toEqual({ ok: false, reason: "unknown_number" });
  });
  it("allows a digit that is part of a fact's name", () => {
    expect(checkNarrative("2024 THUNE REPUBLICAN SENATE VICTORY gave $150,591 to the fund [3].", facts)).toEqual({ ok: true });
  });
  it("rejects a citation to a fact that does not exist, and text with no citation at all", () => {
    expect(checkNarrative("Musk gave $10,000,000 [4].", facts)).toEqual({ ok: false, reason: "bad_citation" });
    expect(checkNarrative("Musk gave $10,000,000 [0].", facts)).toEqual({ ok: false, reason: "bad_citation" });
    expect(checkNarrative("Money moved between these committees.", facts)).toEqual({ ok: false, reason: "bad_citation" });
  });
  it("rejects URLs, empty text and text over the length cap", () => {
    expect(checkNarrative("See https://example.com [1].", facts)).toEqual({ ok: false, reason: "url" });
    expect(checkNarrative("   ", facts)).toEqual({ ok: false, reason: "empty" });
    expect(checkNarrative(`${"x".repeat(NARRATIVE_MAX_CHARS)} [1].`, facts)).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("narrate", () => {
  it("hands the model only the numbered fact sentences and the question, under a strict one-field schema", () => {
    const body = buildNarrateBody("Does Musk's money reach Casey?", facts, "grok-4.5");
    const user = body.messages[1].content;
    expect(user).toContain(`[1] ${factSentence(facts[0])}`);
    expect(user).toContain(`[2] ${factSentence(facts[1])}`);
    expect(user).not.toContain("fec.gov");
    expect(body.response_format.json_schema.schema.required).toEqual(["narrative"]);
  });
  it("is unavailable without facts or without a key, making no network call", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const f = fetchReturning(completion({ narrative: "x [1]." }));
    expect(await narrate("q", [], { apiKey: "k", fetch: f })).toEqual({ status: "unavailable" });
    expect(await narrate("q", facts, { fetch: f })).toEqual({ status: "unavailable" });
    expect(f).not.toHaveBeenCalled();
  });
  it("returns the text when the guard accepts it, withholds it with the reason when not, and is unavailable on a bad response", async () => {
    expect(await narrate("q", facts, { apiKey: "k", fetch: fetchReturning(completion({ narrative: " Musk gave $10,000,000 to the fund [1]. " })) })).toEqual({ status: "ok", text: "Musk gave $10,000,000 to the fund [1]." });
    expect(await narrate("q", facts, { apiKey: "k", fetch: fetchReturning(completion({ narrative: "Musk gave $99 to the fund [1]." })) })).toEqual({ status: "withheld", reason: "unknown_number" });
    expect(await narrate("q", facts, { apiKey: "k", fetch: fetchReturning(completion({ summary: "wrong field" })) })).toEqual({ status: "unavailable" });
    expect(await narrate("q", facts, { apiKey: "k", fetch: fetchReturning("<html>", 502) })).toEqual({ status: "unavailable" });
  });
  it("aborts at the narrator budget and is unavailable", async () => {
    vi.useFakeTimers();
    const p = narrate("q", facts, { apiKey: "k", fetch: neverResolving });
    await vi.advanceTimersByTimeAsync(NARRATE_TIMEOUT_MS + 1);
    expect(await p).toEqual({ status: "unavailable" });
  });
});
