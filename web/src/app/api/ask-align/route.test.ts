import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALIGN_RATE_PER_MINUTE } from "@/lib/align-limits";
import { POST } from "./route";

let nextClient = 0;
const post = async (body: unknown, client = `10.2.0.${++nextClient}`) => {
  const response = await POST(new Request("http://localhost/api/ask-align", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": client },
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("XAI_API_KEY", "k");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("400s malformed requests and 404s unknown races and candidates", async () => {
  expect((await POST(new Request("http://localhost", { method: "POST", body: "nope" }))).status).toBe(400);
  expect((await post({ raceId: "pa-sen-2024", issueId: "guns", candidateId: "S6PA00217", question: "x".repeat(201) })).status).toBe(400);
  expect((await post({ raceId: "nope", issueId: "guns", candidateId: "c" })).status).toBe(404);
  expect((await post({ raceId: "pa-sen-2024", issueId: "guns", candidateId: "nope" })).status).toBe(404);
});

it("returns unavailable without a provider call when the key is absent", async () => {
  vi.stubEnv("XAI_API_KEY", "");
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  const result = await post({ raceId: "pa-sen-2024", issueId: "guns", candidateId: "S6PA00217" });
  expect(result).toMatchObject({ status: 200, body: { via: "unavailable", statements: [] } });
  expect(fetcher).not.toHaveBeenCalled();
});

it("returns a valid provider response and applies the limiter", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      output: [{
        content: [{
          type: "output_text",
          text: JSON.stringify({
            statements: [
              { quote: "A statement", source_url: "https://example.com/a", publisher: "Example", published_at: null, direction: 1 },
            ],
          }),
        }],
      }],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await post({ raceId: "pa-sen-2024", issueId: "guns", candidateId: "S6PA00217" });
  expect(result).toMatchObject({ status: 200, body: { via: "llm", statements: [{ source_url: "https://example.com/a" }] } });
  for (let i = 0; i < ALIGN_RATE_PER_MINUTE; i++) await post({ raceId: "pa-sen-2024", issueId: "guns", candidateId: "S6PA00217" }, "203.0.113.10");
  expect((await post({ raceId: "pa-sen-2024", issueId: "guns", candidateId: "S6PA00217" }, "203.0.113.10")).status).toBe(429);
});
