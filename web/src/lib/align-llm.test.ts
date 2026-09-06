import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALIGN_LLM_TIMEOUT_MS,
  XAI_RESPONSES_URL,
  alignCandidate,
  buildAlignRequestBody,
  clearAlignCache,
  parseStatements,
} from "./align-llm";

const output = (statements: unknown[]) =>
  Response.json({
    id: "resp_1",
    citations: statements.map((item) => (item as { source_url?: string }).source_url).filter(Boolean),
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ statements }) }] }],
  });

afterEach(() => {
  clearAlignCache();
  vi.restoreAllMocks();
});

describe("parseStatements", () => {
  it("drops malformed URLs and quotes, caps six, dedupes, and nulls invalid directions", () => {
    const statements = [
      { quote: "Quote 0", source_url: "https://example.com/0", publisher: "Example", published_at: null, direction: 1 },
      { quote: "Quote 1", source_url: "http://bad.test", publisher: "Example", published_at: null, direction: 1 },
      { quote: "", source_url: "https://example.com/2", publisher: "Example", published_at: null, direction: 1 },
      { quote: "Quote 3", source_url: "https://example.com/3", publisher: "Example", published_at: null, direction: 9 },
      { quote: "Quote 4", source_url: "https://example.com/4", publisher: "Example", published_at: null, direction: 1.5 },
      { quote: "Quote 5", source_url: "https://example.com/5", publisher: "Example", published_at: null, direction: 1 },
      { quote: "Quote 6", source_url: "https://example.com/6", publisher: "Example", published_at: null, direction: 1 },
      { quote: "Quote 7", source_url: "https://example.com/7", publisher: "Example", published_at: null, direction: 1 },
      { quote: "Quote duplicate", source_url: "https://example.com/0", publisher: "Example", published_at: null, direction: 1 },
    ];
    const parsed = parseStatements({
      output: [{ content: [{ type: "output_text", text: JSON.stringify({ statements }) }] }],
    });
    expect(parsed).toHaveLength(6);
    expect(parsed.map((item) => item.source_url)).toEqual(["https://example.com/0", "https://example.com/3", "https://example.com/4", "https://example.com/5", "https://example.com/6", "https://example.com/7"]);
    expect(parsed.find((item) => item.source_url.endsWith("/3"))?.direction).toBe(null);
  });

  it("keeps only URLs opened by web search when citations are present", () => {
    const body = {
      citations: ["https://example.com/kept"],
      output: [{ content: [{ type: "output_text", text: JSON.stringify({ statements: [
        { quote: "kept", source_url: "https://example.com/kept", publisher: "X", published_at: null, direction: 0 },
        { quote: "dropped", source_url: "https://example.com/not-opened", publisher: "X", published_at: null, direction: 0 },
      ] }) }] }],
    };
    expect(parseStatements(body)).toHaveLength(1);
  });
});

describe("alignCandidate", () => {
  it("does not call the provider without a key", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await alignCandidate("PA Senate", "Bob Casey", "r", "guns", "c", { apiKey: "", fetch: fetcher });
    expect(result).toMatchObject({ via: "unavailable", statements: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the Responses API request shape and caches successful results", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(XAI_RESPONSES_URL);
      expect((init?.body as string)).toContain('"tools":[{"type":"web_search"}]');
      return output([{ quote: "A statement", source_url: "https://example.com/a", publisher: "Example", published_at: "2024-01-01", direction: 2 }]);
    });
    const first = await alignCandidate("PA Senate", "Bob Casey", "r", "guns", "c", { apiKey: "k", fetch: fetcher });
    const second = await alignCandidate("PA Senate", "Bob Casey", "r", "guns", "c", { apiKey: "k", fetch: fetcher });
    expect(first).toMatchObject({ via: "llm", cached: false, model: "grok-4.5", statements: [{ direction: 2 }] });
    expect(second).toMatchObject({ via: "llm", cached: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keys successful cache entries by model", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      output([{ quote: "A statement", source_url: "https://example.com/a", publisher: "Example", published_at: null, direction: 2 }]),
    );
    const first = await alignCandidate("PA Senate", "Bob Casey", "r", "guns", "c", { apiKey: "k", model: "grok-one", fetch: fetcher });
    const second = await alignCandidate("PA Senate", "Bob Casey", "r", "guns", "c", { apiKey: "k", model: "grok-two", fetch: fetcher });
    expect(first).toMatchObject({ via: "llm", cached: false, model: "grok-one" });
    expect(second).toMatchObject({ via: "llm", cached: false, model: "grok-two" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable on malformed provider JSON", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ output: [{ content: [{ type: "output_text", text: "{bad" }] }] }));
    const result = await alignCandidate("PA Senate", "Bob Casey", "r", "guns", "bad", { apiKey: "k", fetch: fetcher });
    expect(result).toMatchObject({ via: "unavailable", statements: [] });
    expect(ALIGN_LLM_TIMEOUT_MS).toBe(12_000);
  });
});

describe("buildAlignRequestBody", () => {
  it("limits the prompt to the supplied in-memory race, candidate, issue, axis, and cutoff", () => {
    const body = buildAlignRequestBody("PA Senate", "Bob Casey", "guns", "test-model");
    expect(body.model).toBe("test-model");
    expect(JSON.stringify(body)).toContain("statements from 2023-01-01 to today");
    expect(JSON.stringify(body)).toContain("Firearms regulation");
  });
});
