import neo4j from "neo4j-driver";
import { z } from "zod";
import type { TrailSubject } from "@campaign-commons/contracts";
import { NODE_KINDS, GraphFactSchema, GraphNodeRefSchema, WITHHELD_REASONS, type GraphFact, type GraphNodeRef, type NodeKind } from "./facts";
import { composeExplore, narrateExplore, type LlmOptions, type Narration } from "./llm";
import { COMPLETION, edge } from "./queries";
import { type TypedRunner } from "./neo4j";
import { ENTITY } from "./schema";
import { sankeyFromRows, SankeyDataSchema, type SankeyData } from "./sankey";
export { exploreCellText, formatExploreNumber, rowSentence } from "./explore-format";

export const MAX_ROWS = 20;
export const EXPLORE_TIMEOUT_MS = 8_000;

export type ExploreCell =
  | { t: "node"; node: GraphNodeRef }
  | { t: "edge"; fact: GraphFact }
  | { t: "number"; value: number }
  | { t: "text"; value: string }
  | { t: "list"; values: string[] }
  | { t: "null" };
export type ExploreRow = { n: number; cells: Record<string, ExploreCell> };
export type ExploreResult = {
  kind: "explore";
  cypher: string;
  description: string;
  columns: string[];
  rows: ExploreRow[];
  narrative: Narration;
  truncated: boolean;
  diagram: SankeyData | null;
  context: GraphFact[];
};
export type ExploreRefusal = {
  kind: "unsupported";
  reason: "explore_unavailable" | "no_query" | "rejected_query" | "query_failed" | "empty";
  message: string;
};
export type AskExploreResponse = ExploreResult | ExploreRefusal;

const ExploreCellSchema: z.ZodType<ExploreCell> = z.discriminatedUnion("t", [
  z.object({ t: z.literal("node"), node: GraphNodeRefSchema }),
  z.object({ t: z.literal("edge"), fact: GraphFactSchema }),
  z.object({ t: z.literal("number"), value: z.number() }),
  z.object({ t: z.literal("text"), value: z.string() }),
  z.object({ t: z.literal("list"), values: z.array(z.string()) }),
  z.object({ t: z.literal("null") }),
]);
const ExploreNarrationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), text: z.string() }),
  z.object({ status: z.literal("withheld"), reason: z.enum(WITHHELD_REASONS) }),
  z.object({ status: z.literal("unavailable") }),
]);
export const AskExploreResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("explore"),
    cypher: z.string(),
    description: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.object({ n: z.number().int().min(1), cells: z.record(ExploreCellSchema) })),
    narrative: ExploreNarrationSchema,
    truncated: z.boolean(),
    diagram: SankeyDataSchema.nullable(),
    context: z.array(GraphFactSchema),
  }),
  z.object({
    kind: z.literal("unsupported"),
    reason: z.enum(["explore_unavailable", "no_query", "rejected_query", "query_failed", "empty"]),
    message: z.string(),
  }),
]);
export const AskExploreRequest = z.object({
  raceId: z.string().min(1).max(64),
  question: z.string().trim().min(1).max(500),
  mode: z.enum(["answer", "graph"]).default("answer"),
});

const HYDRATE = `MATCH (a${`:${ENTITY}`} {race_id: $race})-[r]->(b${`:${ENTITY}`} {race_id: $race})
WHERE elementId(r) IN $ids
RETURN elementId(r) AS eid, ${edge("a", "r", "b")} AS edge`;

const BANNED = /\b(?:CREATE|MERGE|SET|DELETE|DETACH|REMOVE|CALL|LOAD|FOREACH|DROP|INDEX|CONSTRAINT|PROFILE|EXPLAIN)\b|apoc\.|dbms\.|db\.|\bUSE\s/i;
const PARAM = /\$([a-zA-Z_]\w*)/g;

export function validateCypher(cypher: string): { ok: true; cypher: string } | { ok: false; reason: string } {
  const trimmed = cypher.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty query" };
  if (trimmed.length > 2_000) return { ok: false, reason: "query exceeds 2,000 characters" };
  if (trimmed.includes(";")) return { ok: false, reason: "semicolons are not allowed" };
  if (BANNED.test(trimmed)) return { ok: false, reason: "the query uses a disallowed Cypher clause or procedure" };
  if (!/\$race\b/i.test(trimmed)) return { ok: false, reason: "the query must filter the race with $race" };
  if (!/\bRETURN\b/i.test(trimmed)) return { ok: false, reason: "the query must return rows" };
  const params = [...trimmed.matchAll(PARAM)].map((m) => m[1]);
  if (params.some((p) => p !== "race")) return { ok: false, reason: "only the $race parameter is allowed" };
  const limits = [...trimmed.matchAll(/\bLIMIT\s+(\d+)\b/gi)];
  const last = limits.at(-1);
  if (last && Number(last[1]) > MAX_ROWS) return { ok: false, reason: `LIMIT above ${MAX_ROWS}` };
  return { ok: true, cypher: last ? trimmed : `${trimmed}\nLIMIT ${MAX_ROWS}` };
}

function nodeRef(value: unknown): GraphNodeRef {
  const props = typeof value === "object" && value !== null && "properties" in value ? (value as { properties?: unknown }).properties : value;
  const p = typeof props === "object" && props !== null ? (props as Record<string, unknown>) : {};
  const kind = NODE_KINDS.includes(p.kind as NodeKind) ? (p.kind as NodeKind) : "committee";
  return {
    id: typeof p.id === "string" ? p.id : "",
    name: typeof p.name === "string" ? p.name : "",
    kind,
    href: typeof p.href === "string" ? p.href : null,
  };
}

function relationshipId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const rel = value as { elementId?: unknown; identity?: unknown };
  if (typeof rel.elementId === "string") return rel.elementId;
  if (rel.identity !== undefined) return String(rel.identity);
  return null;
}

type PendingCell = ExploreCell | { t: "rel"; id: string };
type CellResult = { ok: true; cell: PendingCell } | { ok: false; reason: string };

function cellOf(value: unknown): CellResult {
  if (value === null || value === undefined) return { ok: true, cell: { t: "null" } };
  if (neo4j.isPath(value)) return { ok: false, reason: "return nodes/relationships, not paths" };
  if (neo4j.isNode(value)) return { ok: true, cell: { t: "node", node: nodeRef(value) } };
  if (neo4j.isRelationship(value)) {
    const id = relationshipId(value);
    return id ? { ok: true, cell: { t: "rel", id } } : { ok: false, reason: "relationship has no element id" };
  }
  if (neo4j.isInt(value)) return { ok: true, cell: { t: "number", value: value.toNumber() } };
  if (typeof value === "number") return { ok: true, cell: { t: "number", value } };
  if (typeof value === "string") return { ok: true, cell: { t: "text", value } };
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string") && value.length <= 5) return { ok: true, cell: { t: "list", values: value as string[] } };
    return { ok: true, cell: { t: "text", value: JSON.stringify(value).slice(0, 200) } };
  }
  return { ok: true, cell: { t: "text", value: JSON.stringify(value).slice(0, 200) } };
}

export async function toCells(
  records: Array<Record<string, unknown>>,
  hydrate: (ids: string[]) => Promise<ReadonlyMap<string, GraphFact>>,
): Promise<{ ok: true; rows: ExploreRow[]; columns: string[]; truncated: boolean } | { ok: false; reason: string }> {
  for (const record of records) {
    if (Object.values(record).some((value) => neo4j.isPath(value))) return { ok: false, reason: "return nodes/relationships, not paths" };
  }
  const visible = records.slice(0, MAX_ROWS);
  const relationshipIds = new Set<string>();
  const preliminary: Array<{ n: number; cells: Record<string, PendingCell> }> = [];
  const columns = new Set<string>();
  for (const [i, record] of visible.entries()) {
    const cells: Record<string, PendingCell> = {};
    for (const [column, value] of Object.entries(record)) {
      columns.add(column);
      const converted = cellOf(value);
      if (!converted.ok) return converted;
      if (converted.cell.t === "rel") relationshipIds.add(converted.cell.id);
      cells[column] = converted.cell;
    }
    preliminary.push({ n: i + 1, cells });
  }
  const hydrated = await hydrate([...relationshipIds]);
  const rows: ExploreRow[] = preliminary.map((row) => {
    const cells = Object.fromEntries(
      Object.entries(row.cells).map(([column, cell]) => {
        if (cell.t !== "rel") return [column, cell];
        const fact = hydrated.get(cell.id);
        if (!fact) throw new Error("relationship could not be hydrated");
        return [column, { t: "edge", fact: { ...fact, n: row.n } } satisfies ExploreCell];
      }),
    );
    return { n: row.n, cells };
  });
  return { ok: true, rows, columns: [...columns], truncated: records.length > MAX_ROWS };
}

function cleanDescription(description: string): string {
  return description.replace(/https?:\/\/\S+/gi, "").trim().slice(0, 300);
}

const refuse = (reason: ExploreRefusal["reason"], message: string): ExploreRefusal => ({ kind: "unsupported", reason, message });

export type ExploreDeps = { run: TypedRunner | null; llm?: LlmOptions };

function completionIds(rows: readonly ExploreRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const cell of Object.values(row.cells)) {
      if (cell.t === "node") {
        if (cell.node.kind === "committee") ids.add(cell.node.id);
      } else if (cell.t === "edge") {
        if (cell.fact.from.kind === "committee") ids.add(cell.fact.from.id);
        if (cell.fact.to.kind === "committee") ids.add(cell.fact.to.id);
      }
    }
  }
  return [...ids];
}

async function completeGraph(raceId: string, rows: readonly ExploreRow[], run: TypedRunner): Promise<GraphFact[]> {
  const ids = completionIds(rows);
  if (ids.length === 0) return [];
  try {
    const result = await run(COMPLETION, { race: raceId, ids }, { timeoutMs: EXPLORE_TIMEOUT_MS });
    if (result.queryType !== "r") return [];
    return result.records.flatMap((record, i) => {
      try {
        return [GraphFactSchema.parse({ ...(record.edge as Record<string, unknown>), n: rows.length + i + 1 })];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export async function exploreQuestion(
  raceId: string,
  question: string,
  subjects: readonly TrailSubject[],
  deps: ExploreDeps,
  mode: "answer" | "graph" = "answer",
): Promise<AskExploreResponse> {
  if (deps.run === null || !(deps.llm?.apiKey ?? process.env.XAI_API_KEY)) {
    return refuse("explore_unavailable", "Exploratory graph mode is not configured on this deployment.");
  }
  let composed = await composeExplore(question, subjects, deps.llm, undefined, mode);
  if (composed === null) return refuse("no_query", "That question cannot be answered from the filed records in this graph.");
  if (!composed.cypher.trim()) return refuse("no_query", `That question cannot be answered from the filed records in this graph. ${cleanDescription(composed.description)}`.trim());

  let retried = false;
  let checked = validateCypher(composed.cypher);
  if (!checked.ok) {
    retried = true;
    const validationError = checked.reason;
    composed = await composeExplore(question, subjects, deps.llm, validationError, mode);
    if (composed === null || !composed.cypher.trim()) return refuse("rejected_query", "The exploratory query did not meet the graph's read-only rules.");
    checked = validateCypher(composed.cypher);
    if (!checked.ok) return refuse("rejected_query", "The exploratory query did not meet the graph's read-only rules.");
  }

  const execute = async (cypher: string): Promise<{ ok: true; rows: ExploreRow[]; columns: string[]; truncated: boolean; queryType: string } | { ok: false; reason: string }> => {
    const result = await deps.run!(cypher, { race: raceId }, { timeoutMs: EXPLORE_TIMEOUT_MS });
    if (result.queryType !== "r") return { ok: false, reason: "the query was not read-only" };
    if (result.records.length === 0) return { ok: true, rows: [], columns: [], truncated: false, queryType: result.queryType };
    const converted = await toCells(result.records, async (ids) => {
      if (ids.length === 0) return new Map();
      const hydrated = await deps.run!(HYDRATE, { race: raceId, ids }, { timeoutMs: EXPLORE_TIMEOUT_MS });
      if (hydrated.queryType !== "r") throw new Error("relationship hydration was not read-only");
      return new Map(
        hydrated.records.map((record) => {
          const fact = GraphFactSchema.parse({ ...(record.edge as Record<string, unknown>), n: 1 });
          return [String(record.eid), fact] as const;
        }),
      );
    });
    if (!converted.ok) return converted;
    return { ...converted, queryType: result.queryType };
  };

  let execution: Awaited<ReturnType<typeof execute>>;
  try {
    execution = await execute(checked.cypher);
  } catch (error) {
    if (retried) return refuse("query_failed", "The exploratory query could not be run against the filings graph.");
    retried = true;
    const retryError = error instanceof Error ? error.message.slice(0, 300) : "the graph query failed";
    composed = await composeExplore(question, subjects, deps.llm, retryError, mode);
    if (composed === null || !composed.cypher.trim()) return refuse("query_failed", "The exploratory query could not be run against the filings graph.");
    checked = validateCypher(composed.cypher);
    if (!checked.ok) return refuse("rejected_query", "The exploratory query did not meet the graph's read-only rules.");
    try {
      execution = await execute(checked.cypher);
    } catch {
      return refuse("query_failed", "The exploratory query could not be run against the filings graph.");
    }
  }
  if (!execution.ok) return refuse("rejected_query", "The exploratory query did not meet the graph's read-only rules.");
  if (execution.rows.length === 0) return refuse("empty", "The query ran and returned no rows: nothing in this race's filed records matches.");

  const context = mode === "graph" ? await completeGraph(raceId, execution.rows, deps.run!) : [];
  const narrative = await narrateExplore(question, execution.rows, deps.llm);
  return {
    kind: "explore",
    cypher: checked.cypher,
    description: cleanDescription(composed.description),
    columns: execution.columns,
    rows: execution.rows,
    narrative,
    truncated: execution.truncated,
    diagram: mode === "graph" ? sankeyFromRows(execution.rows, context) : null,
    context,
  };
}
