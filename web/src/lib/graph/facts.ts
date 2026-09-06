/**
 * Graph-mode vocabulary shared by the server (allowlisted queries, narrator, /api/ask-graph) and the browser (the graph
 * answer panel): the operations, the source-backed fact shape, the response contract, and the one deterministic
 * sentence per fact. No I/O and nothing server-only lives here.
 */
import { z } from "zod";
import type { RelType } from "./schema";

export const GRAPH_OPS = ["shared_funders", "money_path", "funder_reach", "upstream"] as const;
export type GraphOp = (typeof GRAPH_OPS)[number];

export function isGraphOp(value: string): value is GraphOp {
  return (GRAPH_OPS as readonly string[]).includes(value);
}

export const GRAPH_OP_LABELS: Record<GraphOp, string> = {
  shared_funders: "Funders two committees share",
  money_path: "Shortest filed paths from a funder",
  funder_reach: "Where a funder's money went",
  upstream: "Who funds a committee's funders",
};

export const NODE_KINDS = ["committee", "individual", "aggregate", "organization", "conduit", "vendor", "ad", "candidate"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const GraphNodeRefSchema = z.object({ id: z.string(), name: z.string(), kind: z.enum(NODE_KINDS), href: z.string().nullable() });
export type GraphNodeRef = z.infer<typeof GraphNodeRefSchema>;

/** One edge read from the graph. `n` is its 1-based citation index within a result. */
export const GraphFactSchema = z.object({
  n: z.number().int().min(1),
  from: GraphNodeRefSchema,
  to: GraphNodeRefSchema,
  rel: z.enum(["GAVE", "PAID", "PLACED", "TARGETED", "CAMPAIGN_OF"]) satisfies z.ZodType<RelType>,
  amount: z.number(),
  count: z.number().nullable(),
  support_oppose: z.enum(["S", "O"]).nullable(),
  visibility: z.enum(["disclosed", "inferable", "dark"]),
  class_basis: z.enum(["rule", "inferred", "verified"]).nullable().optional(),
  first_date: z.string().nullable(),
  last_date: z.string().nullable(),
  source_url: z.string().nullable(),
  /** money_path only: which of the returned paths this hop belongs to (0-based) */
  path: z.number().int().nullable(),
});
export type GraphFact = z.infer<typeof GraphFactSchema>;

/** A subject after resolution: one name, possibly several graph ids (the pipeline splits some individuals by employer). */
export const GraphSubjectSchema = z.object({ name: z.string(), kind: z.enum(NODE_KINDS), ids: z.array(z.string()).min(1), href: z.string().nullable() });
export type GraphSubject = z.infer<typeof GraphSubjectSchema>;

export const WITHHELD_REASONS = ["empty", "too_long", "url", "bad_citation", "uncited_number", "unknown_number"] as const;
export type WithheldReason = (typeof WITHHELD_REASONS)[number];

export const GRAPH_REFUSAL_REASONS = ["graph_unavailable", "no_operation", "subject_not_found", "ambiguous_subject", "wrong_kind", "query_failed"] as const;
export type GraphRefusalReason = (typeof GRAPH_REFUSAL_REASONS)[number];

export const AskGraphResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("graph"),
    op: z.enum(GRAPH_OPS),
    subjects: z.array(GraphSubjectSchema),
    /** set when a candidate was read as their campaign committee for a funding-side operation */
    note: z.string().nullable(),
    facts: z.array(GraphFactSchema),
    narrative: z.discriminatedUnion("status", [
      z.object({ status: z.literal("ok"), text: z.string() }),
      z.object({ status: z.literal("withheld"), reason: z.enum(WITHHELD_REASONS) }),
      z.object({ status: z.literal("unavailable") }),
    ]),
  }),
  z.object({ kind: z.literal("unsupported"), reason: z.enum(GRAPH_REFUSAL_REASONS), message: z.string(), matches: z.array(GraphNodeRefSchema) }),
]);
export type AskGraphResponse = z.infer<typeof AskGraphResponseSchema>;

export const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The one deterministic sentence for a fact; the page shows exactly this, and the narrator is asked to reuse its figures. */
export function factSentence(f: GraphFact): string {
  const a = f.from.name;
  const b = f.to.name;
  switch (f.rel) {
    case "GAVE":
      const suffix =
        f.class_basis === "inferred" && (f.from.kind === "organization" || f.to.kind === "organization")
          ? ` [${f.visibility} — model-read, unverified]`
          : f.visibility === "disclosed"
            ? ""
            : ` [${f.visibility}]`;
      return `${a} gave ${dollars(f.amount)} to ${b}${f.count && f.count > 1 ? ` (${f.count} contributions)` : ""}${suffix}.`;
    case "PAID":
      return `${a} paid ${dollars(f.amount)} to ${b}.`;
    case "PLACED":
      return `${a} placed the ad "${b}".`;
    case "TARGETED":
      return f.support_oppose === "S"
        ? `${a} spent ${dollars(f.amount)} supporting ${b}.`
        : `${a} spent ${dollars(f.amount)} opposing ${b} (independent spending; none of it goes to the candidate).`;
    case "CAMPAIGN_OF":
      return `${a} is ${b}'s campaign committee; it raised ${dollars(f.amount)}.`;
  }
}
