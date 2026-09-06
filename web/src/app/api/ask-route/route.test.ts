import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrailSubject } from "@campaign-commons/contracts";
import { INTENTS, resolveQuestion, resolveRoute } from "@/lib/ask";
import { MAX_IN_FLIGHT, RATE_PER_MINUTE } from "@/lib/ask-limits";
import { ASK_LLM_TIMEOUT_MS } from "@/lib/ask-llm";
import { seedResolution, type AskRouteResponse } from "@/lib/ask-router";
import { getTrails } from "@/lib/data";
import { POST } from "./route";

const trails = getTrails("pa-sen-2024");
const casey = trails.subjects.find((s) => s.name === "Bob Casey")!;
const winsenate = trails.subjects.find((s) => s.name === "WINSENATE")!;

// Each call comes from its own address so the per-client limiter (tested below) stays out of the way elsewhere;
// addresses are only honoured under VERCEL=1 (see clientKey), which beforeEach sets.
let nextClient = 0;
const post = async (body: unknown, raw = false, client = `10.0.0.${++nextClient}`) => {
  const res = await POST(
    new Request("http://localhost/api/ask-route", {
      method: "POST",
      body: raw ? (body as string) : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": `${client}, 172.16.0.1` },
    }),
  );
  return { status: res.status, body: (await res.json()) as AskRouteResponse & { error?: string } };
};
const ask = (question: string) => post({ raceId: "pa-sen-2024", question });

/** Stub the global fetch classify() uses with a chat completion whose content is `content`. */
const stubCompletion = (content: string) => {
  const f = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { role: "assistant", content } }] }));
  vi.stubGlobal("fetch", f);
  return f;
};
const route = (intent: string, subjectId: string, issueId: string | null = null) => JSON.stringify({ route: { intent, subjectId, issueId } });

beforeEach(() => vi.stubEnv("VERCEL", "1"));
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

describe("POST /api/ask-route spend guard", () => {
  it(`429 after ${RATE_PER_MINUTE} questions a minute from one address, without calling the provider`, async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    const f = stubCompletion(route("committee_funding", winsenate.id));
    const from = (q: string) => post({ raceId: "pa-sen-2024", question: q }, false, "203.0.113.9");
    for (let i = 0; i < RATE_PER_MINUTE; i++) expect((await from(`who funds winsenate ${i}`)).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(RATE_PER_MINUTE);
    const limited = await from("who funds winsenate again");
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: expect.stringContaining("try again") });
    expect(f).toHaveBeenCalledTimes(RATE_PER_MINUTE);
    // another address is unaffected
    expect((await ask("who funds winsenate")).status).toBe(200);
  });
  it("off Vercel, a caller rotating forged x-forwarded-for addresses cannot pick its own bucket", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("XAI_API_KEY", "k");
    const f = stubCompletion(route("committee_funding", winsenate.id));
    let status = 200;
    for (let i = 0; i < RATE_PER_MINUTE + 1 && status === 200; i++) {
      status = (await post({ raceId: "pa-sen-2024", question: `who funds winsenate ${i}` }, false, `203.0.113.${i}`)).status;
    }
    expect(status).toBe(429);
    expect(f.mock.calls.length).toBeLessThanOrEqual(RATE_PER_MINUTE);
    // a fresh forged address is still turned away
    expect((await post({ raceId: "pa-sen-2024", question: "who funds winsenate" }, false, "198.51.100.1")).status).toBe(429);
  });
  it(`429 once ${MAX_IN_FLIGHT} questions are in flight, and slots free up when they settle`, async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    const settle: Array<() => void> = [];
    const f = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => settle.push(() => resolve(Response.json({ choices: [{ message: { content: route("committee_funding", winsenate.id) } }] })))));
    vi.stubGlobal("fetch", f);
    const held = Array.from({ length: MAX_IN_FLIGHT }, (_, i) => ask(`who funds winsenate ${i}`));
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(MAX_IN_FLIGHT));
    // one client turned away as "busy" RATE_PER_MINUTE times keeps its own quota
    const from = (q: string) => post({ raceId: "pa-sen-2024", question: q }, false, "203.0.113.77");
    for (let i = 0; i < RATE_PER_MINUTE; i++) expect((await from(`one more ${i}`)).body).toEqual({ error: expect.stringContaining("busy") });
    expect(f).toHaveBeenCalledTimes(MAX_IN_FLIGHT);
    settle.forEach((s) => s());
    for (const h of held) expect((await h).status).toBe(200);
    stubCompletion(route("committee_funding", winsenate.id));
    expect((await from("who funds winsenate")).status).toBe(200);
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
    expect(body).toEqual({ ...resolveRoute("candidate_spender", winsenate, trails.subjects), via: "llm" });
    expect(body.kind).toBe("unsupported");
    if (body.kind !== "unsupported") return;
    expect(body.reason).toBe("wrong_kind");
    expect(body.suggestions.length).toBeGreaterThan(0);
  });
  it("4c. candidate + candidate_ad_funding routes straight to that candidate's ad-funding page", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    stubCompletion(route("candidate_ad_funding", casey.id));
    const { body } = await ask("who's behind the tv spots about the senator");
    expect(body).toEqual({ ...resolveRoute("candidate_ad_funding", casey, trails.subjects), via: "llm" });
    expect(body.kind).toBe("answer");
    if (body.kind !== "answer") return;
    expect(body.intent).toBe("candidate_ad_funding");
    expect(body.subject.id).toBe(casey.id);
  });
  it("4d. candidate + spender_issue carries the closed issue id", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    stubCompletion(route("spender_issue", casey.id, "abortion"));
    const { body } = await ask("where do the groups spending for Casey stand on abortion");
    expect(body).toEqual({ ...resolveRoute("spender_issue", casey, trails.subjects, casey.id, "abortion"), via: "llm" });
    expect(body).toMatchObject({ kind: "answer", intent: "spender_issue", issueId: "abortion", via: "llm" });
  });
  it("every valid (intent, subject) on the ledger seeds to that subject (or its principal committee), never to an ambiguity", () => {
    for (const subject of trails.subjects) {
      for (const intent of INTENTS) {
        const r = seedResolution("irrelevant", { intent, subjectId: subject.id, issueId: null }, trails);
        expect(r.via).toBe("llm");
        if (r.kind === "answer") {
          expect([subject.id, subject.principal_committee_id]).toContain(r.subject.id);
          expect(r.intent).toBe(intent);
        } else {
          expect(r.reason).toBe("wrong_kind");
        }
      }
    }
  });
  it("a validated subject whose alias is another subject's alias is not re-matched by text, so it cannot land elsewhere", () => {
    const america: TrailSubject = { id: "C00000002", kind: "committee", name: "AMERICA PAC", aliases: ["america pac", "america"], type_label: "Super PAC", principal_committee_id: null };
    const working: TrailSubject = { id: "C00000003", kind: "committee", name: "WORKING AMERICA", aliases: ["america", "working america"], type_label: "Super PAC", principal_committee_id: null };
    const t = { subjects: [...trails.subjects, america, working], examples: trails.examples };
    // re-seeding by text (the old `"<intent> <aliases[0]>"`) lands on the other subject; the routed path cannot
    const byText = resolveQuestion(`committee_funding ${working.aliases[0]}`, t.subjects);
    expect(byText.kind === "answer" && byText.subject.id).toBe(america.id);
    const r = seedResolution("who backs working america", { intent: "committee_funding", subjectId: working.id, issueId: null }, t);
    expect(r).toEqual({ kind: "answer", intent: "committee_funding", subject: working, matched: working.id, note: null, issueId: null, via: "llm" });
  });
  it("the response is exactly a Resolution plus `via`; no model text passes through", async () => {
    vi.stubEnv("XAI_API_KEY", "k");
    stubCompletion(route("committee_funding", winsenate.id));
    const { body } = await ask("who funds winsenate");
    expect(Object.keys(body).sort()).toEqual(["intent", "issueId", "kind", "matched", "note", "subject", "via"]);
  });
});
