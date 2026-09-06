import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrailsSchema } from "@campaign-commons/contracts";
import { ASK_LLM_TIMEOUT_MS, buildRequestBody, classify, parseCompletion, validateRoute, XAI_CHAT_COMPLETIONS_URL, XAI_DEFAULT_MODEL } from "./ask-llm";

const trails = TrailsSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "..", "data", "out", "pa-sen-2024", "trails.json"), "utf8")));
const casey = trails.subjects.find((s) => s.name === "Bob Casey")!;
const winsenate = trails.subjects.find((s) => s.name === "WINSENATE")!;

/** A fetch that answers every call with the given chat-completions body (or status). */
const fetchReturning = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const completion = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });
const neverResolving = vi.fn<typeof fetch>(
  (_url, init) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("buildRequestBody", () => {
  it("carries only intents, labels and subject ids/names, constrained by a strict schema over the same closed sets", () => {
    const body = buildRequestBody("who funds winsenate", trails, XAI_DEFAULT_MODEL);
    const text = JSON.stringify(body);
    expect(body.model).toBe(XAI_DEFAULT_MODEL);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    const routeSchema = body.response_format.json_schema.schema.properties.route.anyOf[0];
    expect(routeSchema.properties?.intent.enum).toEqual(["candidate_ad_funding", "candidate_spender", "committee_funding"]);
    expect(routeSchema.properties?.subjectId.enum).toEqual(trails.subjects.map((s) => s.id));
    expect(text).toContain(`${winsenate.id} (committee): WINSENATE`);
    expect(text).toContain("Who funds a committee");
    // no answer content, no aliases, no headline text leaks into the prompt
    expect(text).not.toContain(trails.answers[0].headline);
    expect(text).not.toContain('"aliases"');
  });
});

describe("validateRoute / parseCompletion (layer 2)", () => {
  it("accepts a route whose intent and subject are both in the closed sets", () => {
    expect(validateRoute({ intent: "committee_funding", subjectId: winsenate.id }, trails)).toEqual({ intent: "committee_funding", subjectId: winsenate.id });
  });
  it("rejects a well-formed route with a hallucinated subject id", () => {
    expect(validateRoute({ intent: "committee_funding", subjectId: "C00000000" }, trails)).toBeNull();
  });
  it("rejects an off-set intent", () => {
    expect(validateRoute({ intent: "committee_spending", subjectId: winsenate.id }, trails)).toBeNull();
  });
  it("rejects non-objects and missing fields", () => {
    expect(validateRoute(null, trails)).toBeNull();
    expect(validateRoute("committee_funding", trails)).toBeNull();
    expect(validateRoute({ intent: "committee_funding" }, trails)).toBeNull();
  });
  it("returns null for malformed JSON, empty choices, null route, or non-string content", () => {
    expect(parseCompletion(completion("{not json"), trails)).toBeNull();
    expect(parseCompletion({ choices: [] }, trails)).toBeNull();
    expect(parseCompletion(completion('{"route":null}'), trails)).toBeNull();
    expect(parseCompletion({ choices: [{ message: { content: null } }] }, trails)).toBeNull();
    expect(parseCompletion("garbage", trails)).toBeNull();
  });
});

describe("classify", () => {
  it("returns the validated route from a structured completion and sends the key only as a bearer header", async () => {
    const f = fetchReturning(completion(JSON.stringify({ route: { intent: "candidate_spender", subjectId: casey.id } })));
    const r = await classify("who is going after casey", trails, { apiKey: "test-key", fetch: f });
    expect(r).toEqual({ intent: "candidate_spender", subjectId: casey.id });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(XAI_CHAT_COMPLETIONS_URL);
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(init?.body as string).not.toContain("test-key");
  });
  it("malformed JSON in the completion → null", async () => {
    expect(await classify("q", trails, { apiKey: "k", fetch: fetchReturning(completion("{oops")) })).toBeNull();
  });
  it("hallucinated subject id → null", async () => {
    const f = fetchReturning(completion(JSON.stringify({ route: { intent: "committee_funding", subjectId: "C99999999" } })));
    expect(await classify("q", trails, { apiKey: "k", fetch: f })).toBeNull();
  });
  it("off-set intent → null", async () => {
    const f = fetchReturning(completion(JSON.stringify({ route: { intent: "answer_freely", subjectId: casey.id } })));
    expect(await classify("q", trails, { apiKey: "k", fetch: f })).toBeNull();
  });
  it("provider error status → null", async () => {
    expect(await classify("q", trails, { apiKey: "k", fetch: fetchReturning({ error: "rate limited" }, 429) })).toBeNull();
  });
  it("non-JSON response body → null", async () => {
    expect(await classify("q", trails, { apiKey: "k", fetch: fetchReturning("<html>502</html>") })).toBeNull();
  });
  it("fetch rejection → null", async () => {
    const f = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network down");
    });
    expect(await classify("q", trails, { apiKey: "k", fetch: f })).toBeNull();
  });
  it("timeout: a never-resolving fetch is aborted within the budget", async () => {
    vi.useFakeTimers();
    const pending = classify("q", trails, { apiKey: "k", fetch: neverResolving, timeoutMs: ASK_LLM_TIMEOUT_MS });
    await vi.advanceTimersByTimeAsync(ASK_LLM_TIMEOUT_MS + 1);
    expect(await pending).toBeNull();
    expect(neverResolving.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("missing XAI_API_KEY → null with no network call", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const f = fetchReturning(completion(JSON.stringify({ route: { intent: "candidate_spender", subjectId: casey.id } })));
    expect(await classify("who is spending against casey", trails, { fetch: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("model comes from opts, then XAI_MODEL, then the default", async () => {
    const f = fetchReturning(completion('{"route":null}'));
    vi.stubEnv("XAI_MODEL", "grok-from-env");
    await classify("q", trails, { apiKey: "k", fetch: f });
    expect(JSON.parse(f.mock.calls[0][1]?.body as string).model).toBe("grok-from-env");
    await classify("q", trails, { apiKey: "k", fetch: f, model: "grok-from-opts" });
    expect(JSON.parse(f.mock.calls[1][1]?.body as string).model).toBe("grok-from-opts");
    vi.unstubAllEnvs();
    await classify("q", trails, { apiKey: "k", fetch: f });
    expect(JSON.parse(f.mock.calls[2][1]?.body as string).model).toBe(XAI_DEFAULT_MODEL);
  });
});
