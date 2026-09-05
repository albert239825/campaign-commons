import type { Ad, Basis, Chain, ChainEdge, ChainNode } from "@campaign-commons/contracts";
import { date, range, money, routes } from "@/lib/format";
import { type NodeLinks } from "./links";
import { toWire, type ChainViewWire } from "./view";

/** Google's open top bucket (`max: null`) has no midpoint; the floor is drawn, as in the pipeline's `range_midpoint`. */
export const spendMidpoint = (r: Ad["spend_range"]): number => (r.max === null ? r.min : (r.min + r.max) / 2);

const inferred = (rule: string, source_urls: string[]): Basis => ({
  basis: "inferred",
  rule,
  source_urls,
  checked_by: null,
  checked_at: null,
});

type EdgeExtra = Pick<ChainEdge, "count" | "date_range" | "source_url"> & {
  support_oppose?: ChainEdge["support_oppose"];
};

const edgeBase = (from: string, to: string, amount: number, depth: number) => ({
  from,
  to,
  amount,
  visibility: "disclosed" as const,
  depth,
  transaction_types: [] as string[],
});

const placement = (from: string, to: string, amount: number, depth: number, basis: Basis, extra: EdgeExtra): ChainEdge => ({
  ...edgeBase(from, to, amount, depth),
  kind: "placement",
  basis,
  ...extra,
});

const targeting = (from: string, to: string, amount: number, depth: number, basis: Basis, extra: EdgeExtra): ChainEdge => ({
  ...edgeBase(from, to, amount, depth),
  kind: "targeting",
  basis,
  ...extra,
});

export const adTitle = (ad: Ad): string => {
  const kind = ad.ad_type === "unknown" ? "Ad" : `${ad.ad_type[0].toUpperCase()}${ad.ad_type.slice(1)} ad`;
  return ad.first_shown || ad.last_shown ? `${kind} · ${date(ad.first_shown)} – ${date(ad.last_shown)}` : `${kind} · ${ad.ad_id}`;
};

/**
 * The sponsor's chain re-rooted around one ad: the whole funding side (folded by `visibleGraph` as on the chain page),
 * then on the spending side only what touches this creative — the vendors its `vendor_links` name (with the filed
 * root → vendor payment from the chain), the ad itself, and the candidates it is about. Every spending-side node and
 * edge carries the Basis the data already has, so the picture says "inferred"/"verified" the same way the chain page
 * does. Vendors the sponsor paid that do not link to this ad are left out — that is the point of the page; the ad page
 * names same-window buys in a sentence instead.
 */
export function adFocusWire(chain: Chain, ad: Ad, links: NodeLinks, candidateNames: Record<string, string>, dossierIds: ReadonlySet<string>): ChainViewWire {
  const root = chain.root_entity_id;
  const inNodes = chain.nodes.filter((n) => n.side !== "out");
  const inIds = new Set(inNodes.map((n) => n.id));
  const inEdges = chain.edges.filter((e) => inIds.has(e.to) && inIds.has(e.from));
  const byId = new Map(chain.nodes.map((n) => [n.id, n]));

  const nodes: ChainNode[] = [...inNodes];
  const edges: ChainEdge[] = [...inEdges];
  const amount = spendMidpoint(ad.spend_range);

  // Mirrors chains_out._ad_parent_edge: only verified / inferred links are edges; same-window buys are context on the ad, not drawn.
  const vendorLinks = (ad.vendor_links ?? []).filter(
    (l) => byId.has(`vendor:${l.vendor_id}`) && (l.basis.basis === "verified" || l.basis.basis === "inferred"),
  );
  const depthAd = vendorLinks.length > 0 ? 2 : 1;
  for (const link of vendorLinks) {
    const vid = `vendor:${link.vendor_id}`;
    const vendor = byId.get(vid);
    if (!vendor) continue;
    nodes.push(vendor);
    edges.push(...chain.edges.filter((e) => e.from === root && e.to === vid && (e.kind ?? "money") === "money"));
    edges.push(
      placement(vid, ad.ad_id, amount, depthAd, link.basis, {
        count: link.buys_in_window,
        date_range: link.window,
        source_url: link.basis.source_urls[0] ?? null,
      }),
    );
  }

  const rng = range(ad.spend_range.min, ad.spend_range.max, (n) => money(n, { compact: false }));
  nodes.push({
    id: ad.ad_id,
    name: adTitle(ad),
    kind: "ad",
    side: "out",
    depth: depthAd,
    committee_type: null,
    visibility: "disclosed",
    amount_in: amount,
    is_terminus: false,
    terminus_reason: null,
    source_url: ad.source_url,
    thumbnail_path: ad.cached_creative_path,
    basis: inferred(`Google reports spend as a range (${rng}); the midpoint is drawn`, [ad.source_url]),
  });

  if (vendorLinks.length === 0) {
    const v = ad.verification;
    const basis: Basis =
      v?.status === "verified" && v.verified_at && v.evidence_urls.length > 0
        ? {
            basis: "verified",
            rule: "A person matched this ad's advertiser to the committee using the ad library and fec.gov records",
            source_urls: v.evidence_urls,
            checked_by: "hand (pipeline/campaign_commons/data/ad_verifications.json)",
            checked_at: v.verified_at,
          }
        : inferred(
            "Advertiser name matched to this committee by normalized name; Google's bulk data names the advertiser and carries no paid-for-by field for US ads",
            [ad.source_url],
          );
    edges.push(
      placement(root, ad.ad_id, amount, depthAd, basis, {
        count: 1,
        date_range: null,
        source_url: ad.source_url,
      }),
    );
  }

  const depthCand = depthAd + 1;
  for (const cid of ad.candidate_ids) {
    nodes.push({
      id: cid,
      name: candidateNames[cid] ?? cid,
      kind: "candidate",
      side: "out",
      depth: depthCand,
      committee_type: null,
      visibility: "disclosed",
      amount_in: amount,
      is_terminus: true,
      terminus_reason: null,
      source_url: null,
      href: dossierIds.has(cid) ? routes.candidate(links.raceId, cid) : routes.race(links.raceId),
      basis: inferred("This ad's spend-range midpoint, aimed at the candidate; none of it reaches them", [ad.source_url]),
    });
    edges.push(
      targeting(
        ad.ad_id,
        cid,
        amount,
        depthCand,
        inferred("The advertiser is this candidate's own campaign committee, so the ad is counted as supporting them", [ad.source_url]),
        {
          count: 1,
          date_range: ad.first_shown && ad.last_shown ? [ad.first_shown, ad.last_shown] : null,
          support_oppose: ad.support_oppose ?? "S",
          source_url: ad.source_url,
        },
      ),
    );
  }

  return toWire({ ...chain, nodes, edges }, links);
}
