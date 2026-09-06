import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const post = async (body: unknown) => {
  const response = await POST(new Request("http://localhost/api/ask-align-funders", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

beforeEach(() => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("NEO4J_URI", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/ask-align-funders input", () => {
  it("returns 400 for invalid input and 404 for unknown race or candidate", async () => {
    expect((await POST(new Request("http://localhost", { method: "POST", body: "bad" }))).status).toBe(400);
    expect((await post({ raceId: "nope", issueId: "guns", candidateId: "c" })).status).toBe(404);
    expect((await post({ raceId: "pa-sen-2024", issueId: "guns", candidateId: "c" })).status).toBe(404);
  });

  it("returns static funders when the graph is unavailable", async () => {
    const result = await post({ raceId: "pa-sen-2024", issueId: "guns", candidateId: "S6PA00217" });
    expect(result).toMatchObject({ status: 200, body: { via: "static" } });
  });
});
