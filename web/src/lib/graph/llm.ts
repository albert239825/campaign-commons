/**
 * The two model calls of fixed graph mode (D-83) and exploratory mode (D-85), both server-only and both constrained.
 *
 * 1. `classifyGraph` — Grok reads the question and picks one allowlisted operation plus its subjects: a subject id from
 *    the race's closed list (trails.json) when the question names a candidate or committee, else the name as typed, for
 *    the server to resolve against the graph. It never sees the graph and nothing it writes here is shown.
 * 2. `narrate` — only after the server has resolved the subjects, run the operation and got its source-backed facts,
 *    Grok is handed those facts (and nothing else) and asked for a few sentences. `checkNarrative` then rejects the text
 *    unless every number in it is a number from the facts and every sentence with a number cites its fact; a rejected
 *    narrative is withheld and the page shows the facts alone.
 *
 * Shares the endpoint, model and timeout constants with the route classifier (../ask-llm.ts) but is a separate module, so
 * /api/ask-route is untouched by anything here.
 */
import type { TrailSubject } from "@campaign-commons/contracts";
import { ASK_LLM_TIMEOUT_MS, XAI_CHAT_COMPLETIONS_URL, XAI_DEFAULT_MODEL, XAI_REASONING_EFFORT } from "../ask-llm";
import { GRAPH_OPS, factSentence, isGraphOp, type GraphFact, type GraphOp, type WithheldReason } from "./facts";
import { NODE_KINDS } from "./facts";
import type { ExploreRow } from "./explore";
import { rowSentence } from "./explore-format";
import { GRAPH_OP_SPEC } from "./queries";

/** Writing a few sentences takes grok-4.5/low longer than picking a route; measured 6–11s on PA-Sen fact lists. */
export const NARRATE_TIMEOUT_MS = 15_000;

export type LlmOptions = {
  apiKey?: string;
  model?: string;
  /** classifier budget; defaults to ASK_LLM_TIMEOUT_MS */
  timeoutMs?: number;
  /** narrator budget; defaults to NARRATE_TIMEOUT_MS */
  narrateTimeoutMs?: number;
  fetch?: typeof fetch;
};

/** What the classifier may say: an operation and one or two subjects, each an id from the closed list or a name as typed. */
export type SubjectPick = { id: string | null; mention: string | null };
export type GraphPick = { op: GraphOp; subjects: SubjectPick[] };

const CLASSIFY_SYSTEM = [
  "You classify questions about campaign money in one US election race into one of a fixed list of graph operations, or none.",
  "Each operation takes one or two subjects. For each subject, if the question names a candidate or committee from the closed list you are given, return its id in `id` and null in `mention`;",
  "otherwise (a person, company, union or other group not on the list) return null in `id` and the name exactly as the question wrote it in `mention`.",
  "Order subjects the way the operation describes them (e.g. money_path: from, then to). Return op \"none\" if the question does not fit any operation or is about something other than money in this race.",
  "Never answer the question, never add commentary, never invent an id.",
].join(" ");

export function classifySchema(subjects: readonly TrailSubject[]) {
  const pick = {
    type: "object",
    properties: {
      id: { anyOf: [{ type: "string", enum: subjects.map((s) => s.id) }, { type: "null" }] },
      mention: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["id", "mention"],
    additionalProperties: false,
  };
  return {
    name: "money_trails_graph_pick",
    strict: true,
    schema: {
      type: "object",
      properties: {
        op: { type: "string", enum: [...GRAPH_OPS, "none"] },
        subjects: { type: "array", items: pick, minItems: 0, maxItems: 2 },
      },
      required: ["op", "subjects"],
      additionalProperties: false,
    },
  };
}

export function buildClassifyBody(question: string, subjects: readonly TrailSubject[], model: string) {
  const ops = GRAPH_OPS.map((o) => `- ${o} (${GRAPH_OP_SPEC[o].arity} subject${GRAPH_OP_SPEC[o].arity === 2 ? "s" : ""}): ${GRAPH_OP_SPEC[o].describe}`).join("\n");
  const list = subjects.map((s) => `- ${s.id} (${s.kind}): ${s.name}`).join("\n");
  return {
    model,
    temperature: 0,
    reasoning_effort: XAI_REASONING_EFFORT,
    messages: [
      { role: "system", content: CLASSIFY_SYSTEM },
      { role: "user", content: `Operations:\n${ops}\n\nSubjects on the closed list:\n${list}\n\nQuestion: ${question}` },
    ],
    response_format: { type: "json_schema", json_schema: classifySchema(subjects) },
  };
}

/** Closed-set check of a parsed pick: known op, right arity, ids on the list, mentions short and non-empty. */
export function validatePick(value: unknown, subjects: readonly TrailSubject[]): GraphPick | null {
  if (typeof value !== "object" || value === null) return null;
  const { op, subjects: picks } = value as Record<string, unknown>;
  if (typeof op !== "string" || !isGraphOp(op) || !Array.isArray(picks)) return null;
  if (picks.length !== GRAPH_OP_SPEC[op].arity) return null;
  const out: SubjectPick[] = [];
  for (const p of picks) {
    if (typeof p !== "object" || p === null) return null;
    const { id, mention } = p as Record<string, unknown>;
    if (typeof id === "string") {
      if (!subjects.some((s) => s.id === id)) return null;
      out.push({ id, mention: null });
    } else if (typeof mention === "string" && mention.trim().length > 0 && mention.length <= 120) {
      out.push({ id: null, mention: mention.trim() });
    } else {
      return null;
    }
  }
  return { op, subjects: out };
}

function content(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const text = (choices[0] as { message?: { content?: unknown } }).message?.content;
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function complete(body: unknown, opts: LlmOptions, timeoutMs: number): Promise<unknown> {
  const apiKey = opts.apiKey ?? process.env.XAI_API_KEY;
  if (!apiKey) return null;
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(XAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return content(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function modelFor(opts: LlmOptions): string {
  return opts.model ?? process.env.XAI_MODEL ?? XAI_DEFAULT_MODEL;
}

export function hasApiKey(opts: LlmOptions): boolean {
  return Boolean(opts.apiKey ?? process.env.XAI_API_KEY);
}

export async function classifyGraph(question: string, subjects: readonly TrailSubject[], opts: LlmOptions = {}): Promise<GraphPick | null> {
  return validatePick(await complete(buildClassifyBody(question, subjects, modelFor(opts)), opts, opts.timeoutMs ?? ASK_LLM_TIMEOUT_MS), subjects);
}

// ---------------------------------------------------------------------------------------------------------------------
// Facts as sentences (shared by the prompt and the page), the narrator, and the guard.

const NARRATE_SYSTEM = [
  "You explain a short list of numbered facts about campaign money, read from Federal Election Commission filings, to a general reader in plain English.",
  "Write 2 to 4 sentences. Use only the facts given; add no other names, numbers, dates, motives or characterizations.",
  "Every sentence that states a figure must carry the citation(s) of the fact(s) it comes from, written like [1] or [1][3] just before the sentence's final period.",
  "Write every dollar amount exactly as it appears in the facts (full digits with commas, e.g. $10,000,000); do not round, sum, or write amounts in words.",
  "Do not include links or URLs. Do not repeat the question.",
  "'Opposing' spending is independent expenditure against a candidate: say so if relevant, and never say that money reached, went to, or funded a candidate unless a fact says a committee is that candidate's campaign committee.",
].join(" ");

export const NARRATE_SCHEMA = {
  name: "money_trails_graph_narrative",
  strict: true,
  schema: { type: "object", properties: { narrative: { type: "string" } }, required: ["narrative"], additionalProperties: false },
};

export function buildNarrateBody(question: string, facts: readonly GraphFact[], model: string) {
  const list = facts.map((f) => `[${f.n}] ${factSentence(f)}`).join("\n");
  return {
    model,
    temperature: 0,
    reasoning_effort: XAI_REASONING_EFFORT,
    messages: [
      { role: "system", content: NARRATE_SYSTEM },
      { role: "user", content: `Question (for context only, do not repeat it): ${question}\n\nFacts:\n${list}` },
    ],
    response_format: { type: "json_schema", json_schema: NARRATE_SCHEMA },
  };
}

export const NARRATIVE_MAX_CHARS = 1200;

const NUMBER = /\$?\d[\d,]*(?:\.\d+)?\s*(?:billion|million|thousand|bn|m|k)?\b/gi;
const SUFFIX: Record<string, number> = { billion: 1e9, bn: 1e9, million: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };

function parseNumber(token: string): number {
  const m = /^\$?([\d,]*\.?\d*)\s*([a-z]*)$/i.exec(token.trim());
  if (!m) return NaN;
  const base = Number(m[1].replaceAll(",", ""));
  return base * (SUFFIX[m[2].toLowerCase()] ?? 1);
}

/**
 * Numbers a narrative may contain: each fact's amount and count, the years of its dates, digits inside the names it
 * mentions ("2024 THUNE REPUBLICAN SENATE VICTORY"), and the fact count itself.
 */
export function allowedNumbers(facts: readonly GraphFact[]): number[] {
  const out = new Set<number>([facts.length]);
  for (const f of facts) {
    out.add(Math.round(f.amount));
    out.add(f.amount);
    if (f.count !== null) out.add(f.count);
    for (const d of [f.first_date, f.last_date]) if (d) out.add(Number(d.slice(0, 4)));
    for (const name of [f.from.name, f.to.name]) for (const m of name.matchAll(/\d+/g)) out.add(Number(m[0]));
  }
  return [...out];
}

export type NarrativeCheck = { ok: true } | { ok: false; reason: WithheldReason };

/**
 * Accept a narrative only if: it is non-empty and short; has no URL; it cites at least one fact and every [n] cites an
 * existing fact; every sentence with a number carries a citation; and every number is (within 0.5%, for "$52.8 million")
 * a number from the facts. Sentence breaks are taken only after a lowercase letter, digit or closing bracket, so the
 * periods inside filed names ("NAU, JOHN L. MR. III") do not split one.
 */
export function checkNarrativeAgainst(text: string, input: { count: number; allowed: number[] }): NarrativeCheck {
  const t = text.trim();
  if (t.length === 0) return { ok: false, reason: "empty" };
  if (t.length > NARRATIVE_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (/https?:\/\/|www\./i.test(t)) return { ok: false, reason: "url" };
  const cited = [...t.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  if (cited.length === 0 || cited.some((n) => n < 1 || n > input.count)) return { ok: false, reason: "bad_citation" };
  // a citation the model put after the period belongs to the sentence before it
  const normalised = t.replaceAll(/([.!?])(\s*(?:\[\d+\])+)/g, "$2$1");
  const sentences = normalised.split(/(?<=[^A-Z][.!?])\s+/);
  for (const s of sentences) {
    const stripped = s.replaceAll(/\[\d+\]/g, "");
    const numbers = stripped.match(NUMBER) ?? [];
    if (numbers.length === 0) continue;
    if (!/\[\d+\]/.test(s)) return { ok: false, reason: "uncited_number" };
    for (const raw of numbers) {
      const v = parseNumber(raw);
      if (!Number.isFinite(v)) return { ok: false, reason: "unknown_number" };
      if (!input.allowed.some((a) => Math.abs(a - v) <= Math.max(0.005 * Math.abs(a), 0.5))) return { ok: false, reason: "unknown_number" };
    }
  }
  return { ok: true };
}

export function checkNarrative(text: string, facts: readonly GraphFact[]): NarrativeCheck {
  return checkNarrativeAgainst(text, { count: facts.length, allowed: allowedNumbers(facts) });
}

export type Narration = { status: "ok"; text: string } | { status: "withheld"; reason: WithheldReason } | { status: "unavailable" };

export async function narrate(question: string, facts: readonly GraphFact[], opts: LlmOptions = {}): Promise<Narration> {
  if (facts.length === 0 || !hasApiKey(opts)) return { status: "unavailable" };
  const parsed = await complete(buildNarrateBody(question, facts, modelFor(opts)), opts, opts.narrateTimeoutMs ?? NARRATE_TIMEOUT_MS);
  const text = typeof parsed === "object" && parsed !== null ? (parsed as { narrative?: unknown }).narrative : undefined;
  if (typeof text !== "string") return { status: "unavailable" };
  const check = checkNarrative(text, facts);
  return check.ok ? { status: "ok", text: text.trim() } : { status: "withheld", reason: check.reason };
}

export const COMPOSE_TIMEOUT_MS = 20_000;

export const COMPOSE_SYSTEM = `You write one read-only Cypher query against a Neo4j graph of US Federal Election Commission filings for a single election race, to answer a reader's question about campaign money. You are given the exact graph schema, the race's candidates and committees with their ids, and the question.

Rules:
- Output only the query and a one-sentence plain-English description of what it returns. No commentary.
- Read-only: MATCH, OPTIONAL MATCH, WHERE, WITH, UNWIND, RETURN, ORDER BY, LIMIT, and aggregate functions only. Never CREATE, MERGE, SET, DELETE, REMOVE, CALL, LOAD CSV, or any procedure.
- Every node pattern must be \`(x:Entity {race_id: $race})\` — always filter on \`race_id: $race\`. Use only the labels, relationship types and properties in the schema; invent none.
- Return whole node and relationship variables, or aggregates over them (sum, count, collect of at most 5 names). Never return only names or only numbers without the node/relationship they come from. Give every returned column a short snake_case alias.
- Always ORDER BY the most relevant amount descending and end with LIMIT 20 or less.
- Match a person or organization by \`toLower(x.name) CONTAINS 'part of name'\` with the name lowercased; match a candidate or committee by its id from the list.
- Money never reaches a candidate: TARGETED edges are independent spending for (support_oppose = 'S') or against ('O') a candidate; GAVE edges into a candidate's campaign committee (CAMPAIGN_OF) are the only contributions to a campaign. "Supporting" a candidate means TARGETED with support_oppose 'S' or GAVE into their campaign committee. "Dark money" means edges or nodes with visibility = 'dark'.
- Donors, backers, funders or supporters of a candidate: the money behind a candidate is two hops away, not one. Cover BOTH routes in one query with UNION — (donor)-[:GAVE]->(committee)-[:CAMPAIGN_OF]->(candidate), and (donor)-[:GAVE]->(spender)-[:TARGETED {support_oppose: 'S'}]->(candidate) — and return the whole path's relationships so each row shows donor → committee → candidate, with the same column aliases in both branches and LIMIT 10 on each branch so neither crowds the other out. Restrict donor.kind to individual and organization unless the question asks about committees or transfers. Where the question asks for individuals or people, use donor.kind = 'individual' only. The largest named money is almost always on the second route (super PAC funders), so never stop at the campaign committee's direct receipts.
- If the question cannot be answered from this schema, return an empty query string and say why in the description.`;

const COMPOSE_SCHEMA_TEMPLATE = `Node label: Entity
  Properties: race_id (string, always filter with $race), id (string), name (string, filed uppercase), kind (one of: {NODE_KINDS}), committee_type (string or null; e.g. 'O' super PAC, 'P' principal campaign, 'N'/'Q' PAC, 'Y' party), visibility (one of: disclosed, inferable, dark), href (string or null; the site page for this entity), source_url (string or null)
Relationship types (all directed, all with properties amount (number, dollars), count (number of transactions or null), visibility (disclosed | inferable | dark), first_date, last_date (ISO date strings or null), source_url (string or null)):
  (contributor)-[:GAVE]->(committee)         contributions and committee-to-committee transfers; contributor kind may be individual, organization, committee, conduit or aggregate (aggregate = unitemized small donors; exclude it when asking about named people); visibility = 'dark' marks a GAVE edge whose money came from an LLC, nonprofit or other source with no filed donors — dark money behind a spender sits on GAVE edges one or more hops upstream of the spender, never on TARGETED edges (which are always disclosed)
  (spender)-[:PAID]->(vendor)                Schedule E payments by a spending committee to a vendor
  (vendor or sponsor)-[:PLACED]->(ad)        an ad placement (no dollars of its own)
  (spender or ad)-[:TARGETED {support_oppose: 'S' | 'O'}]->(candidate)   independent spending for or against a candidate; nothing reaches the candidate
  (committee)-[:CAMPAIGN_OF]->(candidate)    the candidate's principal campaign committee; amount = its total receipts`;

export const COMPOSE_SCHEMA_TEXT = COMPOSE_SCHEMA_TEMPLATE.replace("{NODE_KINDS}", NODE_KINDS.join(", "));

export const COMPOSE_RESPONSE_SCHEMA = {
  name: "money_trails_explore_query",
  strict: true,
  schema: {
    type: "object",
    properties: { cypher: { type: "string" }, description: { type: "string" } },
    required: ["cypher", "description"],
    additionalProperties: false,
  },
} as const;

export const COMPOSE_RETRY = "The previous query was rejected: {ERROR}. Return a corrected query that follows every rule, or an empty query if the question cannot be answered.";

export function buildComposeBody(
  question: string,
  subjects: readonly TrailSubject[],
  model: string,
  retryError?: string,
  mode: "answer" | "graph" = "answer",
) {
  const list = subjects.map((s) => `- ${s.id} (${s.kind}): ${s.name}`).join("\n");
  const graphInstruction =
    mode === "graph"
      ? "The reader wants a flow diagram of this answer. Return whole relationships (GAVE, PAID, TARGETED) with their endpoints — not aggregates or bare names — so each row is one money flow with a filed amount, ordered by amount."
      : "";
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: COMPOSE_SYSTEM },
    { role: "user", content: `Schema:\n${COMPOSE_SCHEMA_TEXT}\n\nCandidates and committees:\n${list}\n\nQuestion: ${question}${graphInstruction ? `\n\n${graphInstruction}` : ""}` },
  ];
  if (retryError) messages.push({ role: "user", content: COMPOSE_RETRY.replace("{ERROR}", retryError.slice(0, 300)) });
  return {
    model,
    temperature: 0,
    reasoning_effort: XAI_REASONING_EFFORT,
    messages,
    response_format: { type: "json_schema", json_schema: COMPOSE_RESPONSE_SCHEMA },
  };
}

export type ExploreQuery = { cypher: string; description: string };

export async function composeExplore(
  question: string,
  subjects: readonly TrailSubject[],
  opts: LlmOptions = {},
  retryError?: string,
  mode: "answer" | "graph" = "answer",
): Promise<ExploreQuery | null> {
  const parsed = await complete(buildComposeBody(question, subjects, modelFor(opts), retryError, mode), opts, opts.timeoutMs ?? COMPOSE_TIMEOUT_MS);
  if (typeof parsed !== "object" || parsed === null) return null;
  const { cypher, description } = parsed as Record<string, unknown>;
  if (typeof cypher !== "string" || typeof description !== "string") return null;
  return { cypher, description };
}

export const EXPLORE_NARRATE_SYSTEM = `You explain the rows a database query returned about campaign money, read from Federal Election Commission filings, to a general reader in plain English. Each numbered row is given as a sentence. Write 2 to 4 sentences using only these rows; add no other names, numbers, dates, motives or characterizations. Every sentence that states a figure must carry the citation(s) of the row(s) it comes from, written like [1] or [1][3] just before the sentence's final period. Write every dollar amount exactly as it appears in the rows (full digits with commas); do not round, sum or write amounts in words. Do not include links or URLs. Do not repeat the question. Independent spending 'against' or 'for' a candidate never reaches the candidate; only a campaign committee's own receipts are the candidate's money. Say "the query returned" rather than asserting what exists beyond these rows.`;

export function exploreAllowedNumbers(rows: readonly ExploreRow[]): number[] {
  const out = new Set<number>([rows.length]);
  for (const row of rows) {
    for (const cell of Object.values(row.cells)) {
      if (cell.t === "number") {
        out.add(cell.value);
        out.add(Math.round(cell.value));
      } else if (cell.t === "edge") {
        for (const value of allowedNumbers([cell.fact])) out.add(value);
      } else if (cell.t === "node") {
        for (const m of cell.node.name.matchAll(/\d+/g)) out.add(Number(m[0]));
      } else if (cell.t === "text" || cell.t === "list") {
        const values = cell.t === "text" ? [cell.value] : cell.values;
        for (const value of values) {
          for (const m of value.matchAll(/\d+/g)) out.add(Number(m[0]));
          for (const m of value.matchAll(/\b(19|20)\d{2}\b/g)) out.add(Number(m[0]));
        }
      }
    }
  }
  return [...out];
}

export function buildExploreNarrateBody(question: string, rows: readonly ExploreRow[], model: string) {
  const list = rows.map((row) => `[${row.n}] ${rowSentence(row)}`).join("\n");
  return {
    model,
    temperature: 0,
    reasoning_effort: XAI_REASONING_EFFORT,
    messages: [
      { role: "system", content: EXPLORE_NARRATE_SYSTEM },
      { role: "user", content: `Question (for context only, do not repeat it): ${question}\n\nRows:\n${list}` },
    ],
    response_format: { type: "json_schema", json_schema: NARRATE_SCHEMA },
  };
}

export async function narrateExplore(question: string, rows: readonly ExploreRow[], opts: LlmOptions = {}): Promise<Narration> {
  if (rows.length === 0 || !hasApiKey(opts)) return { status: "unavailable" };
  const parsed = await complete(buildExploreNarrateBody(question, rows, modelFor(opts)), opts, opts.narrateTimeoutMs ?? NARRATE_TIMEOUT_MS);
  const text = typeof parsed === "object" && parsed !== null ? (parsed as { narrative?: unknown }).narrative : undefined;
  if (typeof text !== "string") return { status: "unavailable" };
  const check = checkNarrativeAgainst(text, { count: rows.length, allowed: exploreAllowedNumbers(rows) });
  return check.ok ? { status: "ok", text: text.trim() } : { status: "withheld", reason: check.reason };
}
