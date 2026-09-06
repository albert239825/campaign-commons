/**
 * Money Trails graph (D-78): the shape of the Neo4j graph the loader (web/scripts/load-graph.ts) writes and the
 * allowlisted queries (./queries.ts) read. It is a straight re-projection of artifacts the pipeline already publishes
 * under data/out/<race>/ (chains/*.json, entities/*.json, donors/*.json, ads.json, ledger.json, trails.json) — every node and
 * edge keeps the `source_url` it was read from, and nothing is added that those files do not contain. One label, `Entity`, keyed by (race_id, id); the edge type says
 * what the edge means, exactly as the chain contract does (money in / money out / placement / targeting).
 */
import type { Ad, Chain, DonorView, Entity, Ledger, Trails } from "@campaign-commons/contracts";

export const ENTITY = "Entity";

/** Relationship types. `GAVE` and `PAID` are money edges (dollars move from → to); the other two carry no dollars. */
export const REL = {
  /** funding side: contributor / transfer into a committee */
  GAVE: "GAVE",
  /** spending side: a spender's Schedule E payments to a vendor */
  PAID: "PAID",
  /** spending side: vendor or sponsor → ad, derived (carries a Basis) */
  PLACED: "PLACED",
  /** spender (ledger Schedule E totals) / vendor / ad → candidate, for or against; nothing reaches the candidate */
  TARGETED: "TARGETED",
  /** a candidate's principal campaign committee → the candidate; amount = the committee's receipts (ledger) */
  CAMPAIGN_OF: "CAMPAIGN_OF",
} as const;
export type RelType = (typeof REL)[keyof typeof REL];

export type GraphNodeRow = {
  id: string;
  name: string;
  name_lc: string;
  kind: Chain["nodes"][number]["kind"];
  committee_type: string | null;
  visibility: Chain["nodes"][number]["visibility"];
  source_url: string | null;
  href: string | null;
};

export type GraphEdgeRow = {
  type: RelType;
  from: string;
  to: string;
  /** dedupe key across chain files: the same filed aggregate appears in every chain that expands either end */
  key: string;
  amount: number;
  count: number;
  visibility: Chain["edges"][number]["visibility"];
  transaction_types: string[];
  first_date: string | null;
  last_date: string | null;
  support_oppose: "S" | "O" | null;
  basis: string | null;
  source_url: string | null;
  /** chain roots this edge was read from (empty for edges read from the ledger, an entity page or a donor page) */
  chains: string[];
};

export function edgeType(edge: Chain["edges"][number], toSide: "in" | "out"): RelType {
  const kind = edge.kind ?? "money";
  if (kind === "placement") return REL.PLACED;
  if (kind === "targeting") return REL.TARGETED;
  return toSide === "out" ? REL.PAID : REL.GAVE;
}

export type GraphSources = {
  raceId: string;
  chains: readonly Chain[];
  ledger?: Ledger | null;
  trails?: Pick<Trails, "subjects"> | null;
  entities?: readonly Entity[];
  donors?: readonly DonorView[];
  ads?: readonly Ad[];
};

/** Ad libraries report spend as a range; the midpoint is drawn, as the chains do (an open-ended range draws its floor). */
export function adSpend(ad: Pick<Ad, "spend_range">): number {
  const { min, max } = ad.spend_range;
  return max === null ? min : (min + max) / 2;
}

export function adName(ad: Pick<Ad, "ad_type" | "first_shown" | "last_shown">): string {
  const type = ad.ad_type === "unknown" ? "Ad" : `${ad.ad_type[0].toUpperCase()}${ad.ad_type.slice(1)} ad`;
  const when = [ad.first_shown, ad.last_shown].filter((d) => d !== null).join(" – ");
  return when ? `${type} · ${when}` : type;
}

/**
 * Published artifacts → deduped node and edge rows. Node ids are stable across files (the pipeline keys individuals,
 * orgs and aggregates deterministically), so a node seen in several places collapses to one row; a money edge collapses
 * on (type, from, to, transaction types) and keeps the largest amount it was published with. Chains carry the
 * expanded funding and spending trees; entity pages add every committee-to-committee transfer on file (so campaign
 * committees have funders too — those rows are the committee's itemized receipts, individuals included); donor pages add each tracked donor's own gifts; the ledger adds each outside spender's
 * for/against dollars per candidate and each candidate's campaign committee; the ad library adds each matched
 * sponsor's ads (PLACED, spend-range midpoint) and, where the ad names a candidate, the ad's for/against edge.
 */
export function graphRows(src: GraphSources): { nodes: GraphNodeRow[]; edges: GraphEdgeRow[] } {
  const { raceId, chains, ledger = null, trails = null, entities = [], donors = [], ads = [] } = src;
  const nodes = new Map<string, GraphNodeRow>();
  const edges = new Map<string, GraphEdgeRow>();
  const kindOf = (id: string): GraphNodeRow["kind"] => (id.startsWith("ind:") ? "individual" : id.startsWith("org:") ? "organization" : id.startsWith("agg:") ? "aggregate" : "committee");
  const hrefFor = (kind: GraphNodeRow["kind"], id: string) =>
    kind === "candidate" ? `/races/${raceId}/candidates/${id}` : kind === "committee" || kind === "conduit" ? `/races/${raceId}/entities/${id}` : null;
  const putNode = (row: GraphNodeRow) => {
    const prev = nodes.get(row.id);
    if (prev && prev.source_url !== null) return;
    nodes.set(row.id, { ...row, source_url: row.source_url ?? prev?.source_url ?? null, href: row.href ?? prev?.href ?? hrefFor(row.kind, row.id) });
  };
  const putEdge = (row: Omit<GraphEdgeRow, "key" | "chains">, chain: string | null) => {
    const key = `${row.type}|${row.from}|${row.to}|${row.type === REL.TARGETED || row.type === REL.CAMPAIGN_OF ? (row.support_oppose ?? "") : [...row.transaction_types].sort().join(",")}`;
    const prev = edges.get(key);
    if (prev) {
      if (row.amount > prev.amount) prev.amount = row.amount;
      if (row.count > prev.count) prev.count = row.count;
      if (prev.source_url === null) prev.source_url = row.source_url;
      prev.first_date ??= row.first_date;
      prev.last_date ??= row.last_date;
      if (chain && !prev.chains.includes(chain)) prev.chains.push(chain);
      return;
    }
    edges.set(key, { ...row, key, chains: chain ? [chain] : [] });
  };
  const money = (type: RelType, from: string, to: string, amount: number, source_url: string | null, extra: Partial<GraphEdgeRow> = {}) =>
    ({
      type,
      from,
      to,
      amount,
      count: 0,
      visibility: "disclosed",
      transaction_types: [],
      first_date: null,
      last_date: null,
      support_oppose: null,
      basis: null,
      source_url,
      ...extra,
    }) satisfies Omit<GraphEdgeRow, "key" | "chains">;

  for (const c of ledger?.candidates ?? []) {
    putNode({ id: c.candidate_id, name: c.name, name_lc: c.name.toLowerCase(), kind: "candidate", committee_type: null, visibility: "disclosed", source_url: c.outside.source_url, href: null });
  }

  for (const chain of chains) {
    const side = new Map(chain.nodes.map((n) => [n.id, n.side ?? "in"] as const));
    for (const n of chain.nodes) {
      putNode({ id: n.id, name: n.name, name_lc: n.name.toLowerCase(), kind: n.kind, committee_type: n.committee_type, visibility: n.visibility, source_url: n.source_url ?? null, href: n.href ?? null });
    }
    for (const e of chain.edges) {
      putEdge(
        money(edgeType(e, side.get(e.to) ?? "in"), e.from, e.to, e.amount, e.source_url, {
          count: e.count,
          visibility: e.visibility,
          transaction_types: [...e.transaction_types],
          first_date: e.date_range?.[0] ?? null,
          last_date: e.date_range?.[1] ?? null,
          support_oppose: e.support_oppose ?? null,
          basis: e.basis?.basis ?? null,
        }),
        chain.root_entity_id,
      );
    }
  }

  for (const ent of entities) {
    putNode({ id: ent.entity_id, name: ent.name, name_lc: ent.name.toLowerCase(), kind: ent.kind, committee_type: ent.committee_type, visibility: ent.visibility, source_url: ent.source_url, href: null });
    for (const t of [...ent.inflows, ...ent.outflows]) {
      putNode({ id: t.from_entity_id, name: t.from_name, name_lc: t.from_name.toLowerCase(), kind: kindOf(t.from_entity_id), committee_type: null, visibility: "disclosed", source_url: null, href: null });
      putNode({ id: t.to_entity_id, name: t.to_name, name_lc: t.to_name.toLowerCase(), kind: kindOf(t.to_entity_id), committee_type: null, visibility: "disclosed", source_url: null, href: null });
      putEdge(
        money(REL.GAVE, t.from_entity_id, t.to_entity_id, t.amount, t.source_url, {
          count: t.count ?? 0,
          visibility: t.visibility,
          transaction_types: t.transaction_type ? [t.transaction_type] : [],
          first_date: t.first_date ?? t.date,
          last_date: t.date,
        }),
        null,
      );
    }
  }

  for (const d of donors) {
    for (const n of d.nodes) {
      putNode({ id: n.id, name: n.name, name_lc: n.name.toLowerCase(), kind: n.kind, committee_type: n.committee_type, visibility: "disclosed", source_url: n.source_url, href: null });
    }
    for (const e of d.edges) {
      // only the donor's own gifts: deeper donor-page edges are pooled totals the chains and ledger already carry
      if (e.kind !== "money" || e.from !== d.donor_id) continue;
      putEdge(money(REL.GAVE, e.from, e.to, e.amount, e.source_url), null);
    }
  }

  for (const c of ledger?.candidates ?? []) {
    const committee = trails?.subjects.find((s) => s.id === c.principal_committee_id);
    if (committee) {
      putNode({ id: committee.id, name: committee.name, name_lc: committee.name.toLowerCase(), kind: "committee", committee_type: null, visibility: "disclosed", source_url: c.campaign.source_url, href: null });
    }
    if (!nodes.has(c.principal_committee_id)) continue;
    putEdge(money(REL.CAMPAIGN_OF, c.principal_committee_id, c.candidate_id, c.campaign.receipts, c.campaign.source_url), null);
  }
  for (const ad of ads) {
    if (ad.matched_entity_id === null) continue;
    if (!nodes.has(ad.matched_entity_id)) {
      putNode({ id: ad.matched_entity_id, name: ad.advertiser_name, name_lc: ad.advertiser_name.toLowerCase(), kind: "committee", committee_type: null, visibility: "disclosed", source_url: null, href: null });
    }
    const name = adName(ad);
    putNode({ id: ad.ad_id, name, name_lc: name.toLowerCase(), kind: "ad", committee_type: null, visibility: "disclosed", source_url: ad.source_url, href: `/races/${raceId}/ads/${ad.ad_id}` });
    const spend = adSpend(ad);
    putEdge(money(REL.PLACED, ad.matched_entity_id, ad.ad_id, spend, ad.source_url, { count: 1, first_date: ad.first_shown, last_date: ad.last_shown, basis: "inferred" }), null);
    if (ad.support_oppose === null) continue;
    for (const candidateId of ad.candidate_ids) {
      if (!nodes.has(candidateId)) continue;
      putEdge(money(REL.TARGETED, ad.ad_id, candidateId, spend, ad.source_url, { support_oppose: ad.support_oppose, first_date: ad.first_shown, last_date: ad.last_shown, basis: "inferred" }), null);
    }
  }

  for (const s of ledger?.top_outside_spenders ?? []) {
    putNode({ id: s.entity_id, name: s.name, name_lc: s.name.toLowerCase(), kind: "committee", committee_type: s.committee_type, visibility: "disclosed", source_url: s.source_url, href: null });
    for (const b of s.by_candidate) {
      if (!nodes.has(b.candidate_id)) continue;
      putEdge(money(REL.TARGETED, s.entity_id, b.candidate_id, b.amount, s.source_url, { support_oppose: b.support_oppose }), null);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
