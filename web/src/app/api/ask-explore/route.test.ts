import { afterEach, describe, expect, it, vi } from "vitest";
import { graphLimiter } from "@/lib/graph/limits";
import { POST } from "./route";

let nextClient = 0;
const post = async (body: unknown, raw = false, client = `192.0.2.${++nextClient}`) => {
  const response = await POST(
    new Request("http://localhost/api/ask-explore", {
      method: "POST",
      body: raw ? (body as string) : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": client },
    }),
  );
  return { status: response.status, headers: response.headers, body: await response.json() };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/ask-explore", () => {
  it("returns 400 for malformed input and 404 for an unknown race", async () => {
    expect((await post("not json", true)).status).toBe(400);
    expect((await post({ raceId: "pa-sen-2024" })).status).toBe(400);
    expect((await post({ raceId: "nope-2024", question: "who?" })).status).toBe(404);
  });

  it("returns a typed unavailable response without a configured graph", async () => {
    const result = await post({ raceId: "pa-sen-2024", question: "who?" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ kind: "unsupported", reason: "explore_unavailable" });
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 429 when the shared graph limiter is busy", async () => {
    vi.spyOn(graphLimiter, "acquire").mockReturnValue(null);
    const limited = await post({ raceId: "pa-sen-2024", question: "again?" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });
});
