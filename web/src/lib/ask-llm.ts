/**
 * LLM routing for Money Trails (D-75). Grok reads the typed question and picks a route `(intent, subjectId)` from the
 * closed set this race's trails.json defines; it never sees an answer and nothing it writes is rendered. Two layers keep
 * it honest: the response is constrained to a JSON schema whose enums are exactly the intents and subject ids, and the
 * parsed values are checked against the same sets again before use. Any failure (no key, timeout, provider error,
 * malformed body, off-set value) returns null and the caller falls back to the deterministic resolver in ./ask.ts.
 *
 * Server-only: reads `process.env.XAI_API_KEY` / `XAI_MODEL`. Never import from a client component.
 */
import { ISSUE_IDS, ISSUES, type IssueId, type TrailSubject } from "@campaign-commons/contracts";
import { ASK_INTENTS, INTENT_LABELS, isAskIntent, type AskIntent } from "./ask";

export const XAI_CHAT_COMPLETIONS_URL = "https://api.x.ai/v1/chat/completions";
/** Listed with structured-output support at docs.x.ai/developers/models (checked 2026-09). Override with XAI_MODEL. */
export const XAI_DEFAULT_MODEL = "grok-4.5";
/** grok-4.5 reasons by default ("high"); routing a one-line question needs the least of it, and latency is the budget. */
export const XAI_REASONING_EFFORT = "low";
/** Measured grok-4.5/low on PA-Sen questions: 2.3–5.0s end to end; a budget below that falls back on most asks. */
export const ASK_LLM_TIMEOUT_MS = 6000;

export type Route = { intent: AskIntent; subjectId: string; issueId: IssueId | null };

export type TrailsView = { subjects: readonly TrailSubject[] };

export type ClassifyOptions = {
  /** Defaults to process.env.XAI_API_KEY; undefined or empty means "no LLM", no network call is made. */
  apiKey?: string;
  /** Defaults to process.env.XAI_MODEL, then XAI_DEFAULT_MODEL. */
  model?: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
};

const SYSTEM_PROMPT = [
  "You route questions about campaign money in one US election race to a precomputed answer page.",
  "You are given the closed list of supported question kinds (intents) and the closed list of subjects (candidates and committees) with their ids.",
  "The intent spender_issue is for questions that name a policy issue (from the closed issue list) together with a candidate — it asks where the groups spending for or against that candidate stand on the issue; for it, set issueId to the matching issue id, otherwise set issueId to null.",
  "A question that names an issue is never routed to candidate_ad_funding or candidate_spender.",
  "If the question asks for a breakdown the pages do not provide — dark or undisclosed money, individual people or donors behind a candidate, vendors, paths or connections between entities, comparisons of two subjects, geography or sector — return null for the route even if a subject is named.",
  "Return the single best route as {intent, subjectId, issueId}, using only ids and intents from those lists exactly as written.",
  "If the question is not about exactly one listed subject, or does not fit any listed intent, return null for the route.",
  "Never answer the question, never add commentary, never invent an id.",
].join(" ");

function schemaFor(subjects: readonly TrailSubject[]) {
  return {
    name: "money_trails_route",
    strict: true,
    schema: {
      type: "object",
      properties: {
        route: {
          anyOf: [
            {
              type: "object",
              properties: {
                intent: { type: "string", enum: [...ASK_INTENTS] },
                subjectId: { type: "string", enum: subjects.map((s) => s.id) },
                issueId: { anyOf: [{ type: "string", enum: [...ISSUE_IDS] }, { type: "null" }] },
              },
              required: ["intent", "subjectId", "issueId"],
              additionalProperties: false,
            },
            { type: "null" },
          ],
        },
      },
      required: ["route"],
      additionalProperties: false,
    },
  };
}

/** The exact chat-completions request body; exported so tests can assert what leaves the server. */
export function buildRequestBody(question: string, trails: TrailsView, model: string) {
  const issues = ISSUES.map((issue) => `- ${issue.id}: ${issue.label}`).join("\n");
  const subjects = trails.subjects.map((s) => `- ${s.id} (${s.kind}): ${s.name}`).join("\n");
  return {
    model,
    temperature: 0,
    reasoning_effort: XAI_REASONING_EFFORT,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Intents:\n${ASK_INTENTS.map((i) => `- ${i}: ${INTENT_LABELS[i]}`).join("\n")}\n\nIssues:\n${issues}\n\nSubjects:\n${subjects}\n\nQuestion: ${question}` },
    ],
    response_format: { type: "json_schema", json_schema: schemaFor(trails.subjects) },
  };
}

/** Layer 2: a candidate route is accepted only if both values are in the closed sets for this race. */
export function validateRoute(value: unknown, trails: TrailsView): Route | null {
  if (typeof value !== "object" || value === null) return null;
  const { intent, subjectId } = value as Record<string, unknown>;
  const issueId = (value as Record<string, unknown>).issueId;
  if (typeof intent !== "string" || !isAskIntent(intent)) return null;
  if (typeof subjectId !== "string" || !trails.subjects.some((s) => s.id === subjectId)) return null;
  if (issueId !== null && (typeof issueId !== "string" || !(ISSUE_IDS as readonly string[]).includes(issueId))) return null;
  if (intent === "spender_issue" && issueId === null) return null;
  return { intent, subjectId, issueId: intent === "spender_issue" ? (issueId as IssueId) : null };
}

/** Pulls `choices[0].message.content` out of a chat-completions body and parses `{ route }` from it. */
export function parseCompletion(body: unknown, trails: TrailsView): Route | null {
  try {
    if (typeof body !== "object" || body === null) return null;
    const choices = (body as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const message = (choices[0] as { message?: { content?: unknown } }).message;
    const content = message?.content;
    if (typeof content !== "string") return null;
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return null;
    return validateRoute((parsed as { route?: unknown }).route, trails);
  } catch {
    return null;
  }
}

export async function classify(question: string, trails: TrailsView, opts: ClassifyOptions = {}): Promise<Route | null> {
  const apiKey = opts.apiKey ?? process.env.XAI_API_KEY;
  if (!apiKey) return null;
  const model = opts.model ?? process.env.XAI_MODEL ?? XAI_DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? ASK_LLM_TIMEOUT_MS;
  const doFetch = opts.fetch ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(XAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildRequestBody(question, trails, model)),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parseCompletion(await res.json(), trails);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
