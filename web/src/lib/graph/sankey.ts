// OWNER: Money Trails exploratory mode (D-80) — @graph flow diagrams.
import { z } from "zod";
import { GraphNodeRefSchema, type GraphFact } from "./facts";
import type { ExploreRow } from "./explore";

/**
 * A flow diagram built only from the relationship rows an exploratory query returned: nodes are the endpoints of
 * those edges, links are the edges themselves with their filed amount. Nothing is inferred — an edge the query did
 * not return is not drawn — so the picture is exactly the cited rows, arranged left to right along the money.
 */
export const SankeyNodeSchema = GraphNodeRefSchema.extend({ layer: z.number().int().min(0) });
export type SankeyNode = z.infer<typeof SankeyNodeSchema>;

export const SankeyLinkSchema = z.object({
  /** citation index of the row the edge came from */
  n: z.number().int().min(1),
  source: z.string(),
  target: z.string(),
  rel: z.enum(["GAVE", "PAID", "PLACED", "TARGETED", "CAMPAIGN_OF"]),
  amount: z.number().positive(),
  visibility: z.enum(["disclosed", "inferable", "dark"]),
  support_oppose: z.enum(["S", "O"]).nullable(),
  source_url: z.string().nullable(),
});
export type SankeyLink = z.infer<typeof SankeyLinkSchema>;

export const SANKEY_UNAVAILABLE = ["no_edges", "no_amounts", "cyclic"] as const;
export type SankeyUnavailableReason = (typeof SANKEY_UNAVAILABLE)[number];

export const SankeyDataSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), nodes: z.array(SankeyNodeSchema).min(2), links: z.array(SankeyLinkSchema).min(1), layers: z.number().int().min(2) }),
  z.object({ ok: z.literal(false), reason: z.enum(SANKEY_UNAVAILABLE), message: z.string() }),
]);
export type SankeyData = z.infer<typeof SankeyDataSchema>;

const UNAVAILABLE_COPY: Record<SankeyUnavailableReason, string> = {
  no_edges: "This analysis cannot be drawn: the query returned no money flows between named parties, only names or totals.",
  no_amounts: "This analysis cannot be drawn: the flows the query returned carry no filed dollar amounts.",
  cyclic: "This analysis cannot be drawn: the flows the query returned loop back on themselves, so there is no left-to-right direction.",
};

/** Edges with a positive filed amount, one per (from, to, rel), keeping the first row that cited it. */
export function sankeyFromRows(rows: readonly ExploreRow[]): SankeyData {
  const facts: GraphFact[] = [];
  for (const row of rows) for (const cell of Object.values(row.cells)) if (cell.t === "edge") facts.push(cell.fact);
  if (facts.length === 0) return { ok: false, reason: "no_edges", message: UNAVAILABLE_COPY.no_edges };

  const seen = new Set<string>();
  const links: SankeyLink[] = [];
  const nodesById = new Map<string, Omit<SankeyNode, "layer">>();
  for (const f of facts) {
    if (!(f.amount > 0) || f.from.id === f.to.id) continue;
    const key = `${f.from.id}\u0000${f.to.id}\u0000${f.rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      n: f.n,
      source: f.from.id,
      target: f.to.id,
      rel: f.rel,
      amount: f.amount,
      visibility: f.visibility,
      support_oppose: f.support_oppose,
      source_url: f.source_url,
    });
    nodesById.set(f.from.id, { id: f.from.id, name: f.from.name, kind: f.from.kind, href: f.from.href });
    nodesById.set(f.to.id, { id: f.to.id, name: f.to.name, kind: f.to.kind, href: f.to.href });
  }
  if (links.length === 0) return { ok: false, reason: "no_amounts", message: UNAVAILABLE_COPY.no_amounts };

  const layerOf = longestPathLayers(links);
  if (layerOf === null) return { ok: false, reason: "cyclic", message: UNAVAILABLE_COPY.cyclic };

  const nodes: SankeyNode[] = [...nodesById.values()].map((n) => ({ ...n, layer: layerOf.get(n.id) ?? 0 }));
  const layers = Math.max(...nodes.map((n) => n.layer)) + 1;
  return { ok: true, nodes, links, layers };
}

/** Kahn's algorithm; layer = longest path from any source. Null when the links contain a cycle. */
function longestPathLayers(links: readonly SankeyLink[]): Map<string, number> | null {
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const l of links) {
    indeg.set(l.source, indeg.get(l.source) ?? 0);
    indeg.set(l.target, (indeg.get(l.target) ?? 0) + 1);
    out.set(l.source, [...(out.get(l.source) ?? []), l.target]);
  }
  const layer = new Map<string, number>();
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  for (const id of queue) layer.set(id, 0);
  let done = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    done += 1;
    for (const next of out.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1));
      const d = (indeg.get(next) ?? 1) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return done === indeg.size ? layer : null;
}
