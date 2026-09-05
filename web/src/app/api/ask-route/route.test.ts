import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveQuestion } from "@/lib/ask";
import { ASK_LLM_TIMEOUT_MS } from "@/lib/ask-llm";
import type { AskRouteResponse } from "@/lib/ask-router";
import { getTrails } from "@/lib/data";
import { POST } from "./route";

const trails = getTrails("pa-sen-2024");
const casey = trails.subjects.find((s) => s.name === "Bob Casey")!;
const winsenate = trails.subjects.find((s) => s.name === "WINSENATE")!;

const post = async (body: unknown, raw = false) => {
  const res = await POST(new Request("http://localhost/api/ask-route", { method: "POST", body: raw ? (body as string) : JSON.stringify(body), headers: { "content-type": "application/json" } }));
  return { status: res.status, body: (await res.json()) as AskRouteResponse & { error?: string } };
};
const ask = (question: string) => post({ raceId: "pa-sen-2024", question });

/** Stub the global fetch classify() uses with a chat completion whose content is `content`. */
const stubCompletion = (content: string) => {
  const f = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { role: "assistant", content } }] }));
  vi.stubGlobal("fetch", f);
  return f;
};
const route = (intent: string, subjectId: string) => JSON.stringify({ route: { intent, subjectId } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("POST /api/ask-route input", () => {
  it("400 on non-JSON, missing fields, blank or over-long questions", async () => {
    expect((await post("not json", true)).status).toBe(400);
    expect((await post({ raceId: "pa-sen-2024" })).status).toBe(400);
    expect((await post({ question: "who funds winsenate" })).status).toBe(400);
    expect((await ask("   ")).status).toBe(400);
    expect((await ask("x".repeat(501))).status).toBe(400);
  });
  it("404 on a race without trails, without calling the provider", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    const f = stubCompletion(route("committee_funding", winsenate.id));
    expect((await post({ raceId: "nope-2024", question: "who funds winsenate" })).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask-route fallback (via: fallback)", () => {
  it("1. malformed JSON from the model → resolves the raw text deterministically", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    stubCompletion("{route: oops");
    const { status, body } = await ask("who funds WinSenate?");
    expect(status).toBe(200);
    expect(body).toEqual({ ...resolveQuestion("who funds WinSenate?", trails.subjects, trails.examples), via: "fallback" });
    expect(body.kind).toBe("answer");
  });
  it("2. hallucinated subject id → discarded → raw-text resolution", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    stubCompletion(route("committee_funding", "C00000001"));
    const { body } = await ask("who funds the Casey campaign");
    expect(body.via).toBe("fallback");
    expect(body).toEqual({ ...resolveQuestion("who funds the Casey campaign", trails.subjects, trails.examples), via: "fallback" });
  });
  it("3. off-set intent → discarded → raw-text resolution (here: a typed refusal, not an LLM sentence)", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    stubCompletion(route("committee_spending", winsenate.id));
    const { body } = await ask("tell me about winsenate's ads");
    expect(body.via).toBe("fallback");
    expect(body.kind).toBe("unsupported");
    expect(body).toEqual({ ...resolveQuestion("tell me about winsenate's ads", trails.subjects, trails.examples), via: "fallback" });
  });
  it("5. never-resolving provider → aborted at the budget → raw-text resolution", async () => {
    vi.useFakeTimers();
    vi.stubEnv("XAI_API_KEY", "k");
    const f = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", f);
    const pending = ask("who is spending against casey");
    await vi.advanceTimersByTimeAsync(ASK_LLM_TIMEOUT_MS + 1);
    const { body } = await pending;
    expect(f).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ ...resolveQuestion("who is spending against casey", trails.subjects, trails.examples), via: "fallback" });
    expect(body.kind).toBe("answer");
  });
  it("6. missing XAI_API_KEY → no network call → raw-text resolution", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const f = stubCompletion(route("candidate_spender", casey.id));
    const { body } = await ask("who is spending against casey");
    expect(f).not.toHaveBeenCalled();
    expect(body.via).toBe("fallback");
    expect(body.kind).toBe("answer");
  });
});

describe("POST /api/ask-route with a valid route (via: llm)", () => {
  it("4a. candidate + committee_funding is re-seeded through resolveQuestion: lands on the principal committee with the reroute note", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    stubCompletion(route("committee_funding", casey.id));
    const { body } = await ask("who bankrolls bob");
    expect(body.via).toBe("llm");
    expect(body.kind).toBe("answer");
    if (body.kind !== "answer") return;
    expect(body.intent).toBe("committee_funding");
    expect(body.subject.id).toBe(casey.principal_committee_id);
    expect(body.note).toMatch(/Bob Casey/);
    // the deterministic resolver alone could not have answered this question
    expect(resolveQuestion("who bankrolls bob", trails.subjects, trails.examples).kind).toBe("unsupported");
  });
  it("4b. committee + candidate_spender yields the existing refusal/redirect, never an LLM sentence", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    stubCompletion(route("candidate_spender", winsenate.id));
    const { body } = await ask("what is winsenate up to");
    expect(body.via).toBe("llm");
    expect(body).toEqual({ ...resolveQuestion(`candidate_spender ${winsenate.aliases[0]}`, trails.subjects, trails.examples), via: "llm" });
    expect(body.kind).toBe("unsupported");
    if (body.kind !== "unsupported") return;
    expect(body.reason).toBe("wrong_kind");
    expect(body.suggestions.length).toBeGreaterThan(0);
  });
  it("4c. candidate + candidate_ad_funding routes straight to that candidate's ad-funding page", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    stubCompletion(route("candidate_ad_funding", casey.id));
    const { body } = await ask("who's behind the tv spots about the senator");
    expect(body).toEqual({ ...resolveQuestion(`candidate_ad_funding ${casey.aliases[0]}`, trails.subjects, trails.examples), via: "llm" });
    expect(body.kind).toBe("answer");
    if (body.kind !== "answer") return;
    expect(body.intent).toBe("candidate_ad_funding");
    expect(body.subject.id).toBe(casey.id);
  });
  it("the response is exactly a Resolution plus `via`; no model text passes through", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    stubCompletion(route("committee_funding", winsenate.id));
    const { body } = await ask("who funds winsenate");
    expect(Object.keys(body).sort()).toEqual(["intent", "kind", "matched", "note", "subject", "via"]);
  });
});
