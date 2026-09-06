import { ISSUE_AXES, ISSUE_BY_ID, IssueIdSchema, type IssueId } from "@campaign-commons/contracts";
import { z } from "zod";

export const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";
export const ALIGN_LLM_TIMEOUT_MS = 12_000;
export const ALIGN_DEFAULT_MODEL = "grok-4.5";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const directionValues = [-2, -1, 0, 1, 2] as const;
export const StatementSchema = z.object({
  quote: z.string(),
  source_url: z.string().url().refine((url) => url.startsWith("https://"), "source_url must use HTTPS"),
  publisher: z.string(),
  published_at: z.string().nullable(),
  direction: z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]).nullable(),
});
export type Statement = z.infer<typeof StatementSchema>;

export const AskAlignRequest = z.object({
  raceId: z.string().min(1).max(64),
  issueId: IssueIdSchema,
  candidateId: z.string().min(1),
});

export const AskAlignResponseSchema = z.object({
  statements: z.array(StatementSchema),
  via: z.enum(["llm", "unavailable"]),
  cached: z.boolean(),
  model: z.string().nullable(),
  retrieved_at: z.string(),
});
export type AskAlignResponse = z.infer<typeof AskAlignResponseSchema>;

export type AlignOptions = {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

type CachePayload = Omit<AskAlignResponse, "cached">;
const cache = new Map<string, { expires: number; payload: CachePayload }>();

const SYSTEM_PROMPT = [
  "Find recent news, press, or official statements made BY the named candidate about the named issue.",
  "Return only statements directly attributable to the candidate, with each quote copied verbatim from its source page and no quote longer than 400 characters.",
  "Use the exact HTTPS page URL, publisher, and publication date in YYYY-MM-DD format when available, otherwise null.",
  "Code direction on the supplied issue axis from -2 to 2, or null when the statement cannot be coded.",
  "Never summarize, add commentary, or return an item without a URL.",
].join(" ");

function schema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["statements"],
    properties: {
      statements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["quote", "source_url", "publisher", "published_at", "direction"],
          properties: {
            quote: { type: "string", maxLength: 400 },
            source_url: { type: "string" },
            publisher: { type: "string" },
            published_at: { type: ["string", "null"] },
            direction: { anyOf: [{ type: "integer", enum: [...directionValues] }, { type: "null" }] },
          },
        },
      },
    },
  };
}

export function buildAlignRequestBody(
  raceLabel: string,
  candidateName: string,
  issueId: IssueId,
  model: string,
): Record<string, unknown> {
  const issue = ISSUE_BY_ID[issueId];
  const axis = ISSUE_AXES[issueId];
  return {
    model,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Race: ${raceLabel}`,
          `Candidate: ${candidateName}`,
          `Issue: ${issue.label} — ${issue.description}`,
          `Axis minus: ${axis.minus}`,
          `Axis plus: ${axis.plus}`,
          "Cutoff: statements from 2023-01-01 to today.",
        ].join("\n"),
      },
    ],
    store: false,
    temperature: 0,
    reasoning_effort: "low",
    tools: [{ type: "web_search" }],
    text: {
      format: {
        type: "json_schema",
        name: "candidate_issue_statements",
        strict: true,
        schema: schema(),
      },
    },
  };
}

function outputText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const output = (body as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  const pieces: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      if ((part as { type?: unknown }).type !== "output_text") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") pieces.push(text);
    }
  }
  return pieces.length > 0 ? pieces.join("") : null;
}

function citationUrls(body: unknown): { urls: Set<string>; present: boolean } {
  const urls = new Set<string>();
  let present = false;
  if (typeof body !== "object" || body === null) return { urls, present };
  const top = (body as { citations?: unknown }).citations;
  if (Array.isArray(top)) {
    present = true;
    for (const citation of top) {
      if (typeof citation === "string") urls.add(citation);
      else if (typeof citation === "object" && citation !== null && typeof (citation as { url?: unknown }).url === "string") {
        urls.add((citation as { url: string }).url);
      }
    }
  }
  const output = (body as { output?: unknown }).output;
  if (!Array.isArray(output)) return { urls, present };
  for (const item of output) {
    if (typeof item !== "object" || item === null || !(String((item as { type?: unknown }).type).includes("web_search"))) continue;
    const action = (item as { action?: unknown }).action;
    if (typeof action !== "object" || action === null) continue;
    const url = (action as { url?: unknown }).url;
    const sources = (action as { sources?: unknown }).sources;
    if (typeof url === "string") {
      present = true;
      urls.add(url);
    }
    if (Array.isArray(sources)) {
      present = true;
      for (const source of sources) {
        if (typeof source === "string") urls.add(source);
        else if (typeof source === "object" && source !== null && typeof (source as { url?: unknown }).url === "string") {
          urls.add((source as { url: string }).url);
        }
      }
    }
  }
  return { urls, present };
}

function parsedOutput(body: unknown): unknown {
  const text = outputText(body);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Parse and defensively filter the structured model output. */
export function parseStatements(body: unknown): Statement[] {
  const parsed = parsedOutput(body);
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { statements?: unknown }).statements)) return [];
  const citations = citationUrls(body);
  const seen = new Set<string>();
  const statements: Statement[] = [];
  for (const item of (parsed as { statements: unknown[] }).statements) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.quote !== "string" || row.quote.trim().length === 0 || row.quote.length > 400) continue;
    if (typeof row.source_url !== "string" || !/^https:\/\//.test(row.source_url)) continue;
    let url: URL;
    try {
      url = new URL(row.source_url);
    } catch {
      continue;
    }
    if (citations.present && !citations.urls.has(row.source_url)) continue;
    if (seen.has(url.href)) continue;
    const direction =
      typeof row.direction === "number" && Number.isInteger(row.direction) && directionValues.includes(row.direction as (typeof directionValues)[number])
        ? (row.direction as Statement["direction"])
        : null;
    statements.push({
      quote: row.quote,
      source_url: url.href,
      publisher: typeof row.publisher === "string" ? row.publisher : "",
      published_at: typeof row.published_at === "string" || row.published_at === null ? row.published_at : null,
      direction,
    });
    seen.add(url.href);
    if (statements.length >= 6) break;
  }
  return statements;
}

async function request(body: Record<string, unknown>, opts: AlignOptions, timeoutMs: number): Promise<unknown> {
  const apiKey = opts.apiKey ?? process.env.XAI_API_KEY;
  if (!apiKey) return null;
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(XAI_RESPONSES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const unavailable = (): AskAlignResponse => ({
  statements: [],
  via: "unavailable",
  cached: false,
  model: null,
  retrieved_at: new Date().toISOString(),
});

export function clearAlignCache(): void {
  cache.clear();
}

export async function alignCandidate(
  raceLabel: string,
  candidateName: string,
  raceId: string,
  issueId: IssueId,
  candidateId: string,
  opts: AlignOptions = {},
): Promise<AskAlignResponse> {
  const model = opts.model ?? process.env.XAI_MODEL ?? ALIGN_DEFAULT_MODEL;
  const key = `${model}|${raceId}|${issueId}|${candidateId}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return { ...cached.payload, cached: true };
  if (cached) cache.delete(key);
  const body = await request(buildAlignRequestBody(raceLabel, candidateName, issueId, model), opts, opts.timeoutMs ?? ALIGN_LLM_TIMEOUT_MS);
  if (body === null) return unavailable();
  const parsed = parsedOutput(body);
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { statements?: unknown }).statements)) return unavailable();
  const statements = parseStatements(body);
  const payload: CachePayload = {
    statements,
    via: "llm",
    model,
    retrieved_at: new Date().toISOString(),
  };
  cache.set(key, { expires: now + CACHE_TTL_MS, payload });
  return { ...payload, cached: false };
}
