// OWNER: Money Trails exploratory mode (D-83) — @graph flow diagrams.
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

/**
 * Edges with a positive filed amount, one per (from, to, rel). The loader keeps several chain copies of the same
 * filing (one per walk that reached it), so a party may appear under more than one graph id and an edge more than
 * once: parties are merged by (kind, name) and duplicate edges collapse onto the first row that cited them, keeping
 * the `dark` label if any copy carried it. `context` facts (the site's own completion: spending for/against
 * candidates by the drawn committees, campaign ownership) are drawn after the rows; a `CAMPAIGN_OF` edge has no
 * amount of its own and is drawn as wide as the money that reached the committee.
 */
export function sankeyFromRows(rows: readonly ExploreRow[], context: readonly GraphFact[] = []): SankeyData {
  const facts: GraphFact[] = [];
  for (const row of rows) for (const cell of Object.values(row.cells)) if (cell.t === "edge") facts.push(cell.fact);
  if (facts.length === 0) return { ok: false, reason: "no_edges", message: UNAVAILABLE_COPY.no_edges };

  const canonical = new Map<string, string>();
  const nodesById = new Map<string, Omit<SankeyNode, "layer">>();
  const nodeId = (ref: GraphFact["from"]) => {
    const key = `${ref.kind}\u0000${ref.name.trim().toUpperCase()}`;
    const existing = canonical.get(key);
    if (existing !== undefined) return existing;
    canonical.set(key, ref.id);
    nodesById.set(ref.id, { id: ref.id, name: ref.name, kind: ref.kind, href: ref.href });
    return ref.id;
  };

  const byKey = new Map<string, SankeyLink>();
  const ownership: SankeyLink[] = [];
  for (const f of [...facts, ...context]) {
    if (f.from.id === f.to.id) continue;
    const source = nodeId(f.from);
    const target = nodeId(f.to);
    if (source === target) continue;
    const link: SankeyLink = {
      n: f.n,
      source,
      target,
      rel: f.rel,
      amount: f.amount,
      visibility: f.visibility,
      support_oppose: f.support_oppose,
      source_url: f.source_url,
    };
    if (f.rel === "CAMPAIGN_OF") {
      ownership.push(link);
      continue;
    }
    if (!(f.amount > 0)) continue;
    const key = `${source}\u0000${target}\u0000${f.rel}`;
    const prior = byKey.get(key);
    if (prior === undefined) byKey.set(key, link);
    else if (f.visibility === "dark" && prior.visibility !== "dark") prior.visibility = "dark";
  }
  const links = [...byKey.values()];
  if (links.length === 0) return { ok: false, reason: "no_amounts", message: UNAVAILABLE_COPY.no_amounts };

  const inflow = new Map<string, number>();
  for (const l of links) inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.amount);
  for (const o of ownership) {
    const key = `${o.source}\u0000${o.target}\u0000${o.rel}`;
    const reached = inflow.get(o.source) ?? 0;
    if (reached > 0 && !links.some((l) => `${l.source}\u0000${l.target}\u0000${l.rel}` === key)) links.push({ ...o, amount: reached });
  }
  for (const id of [...nodesById.keys()]) if (!links.some((l) => l.source === id || l.target === id)) nodesById.delete(id);

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
