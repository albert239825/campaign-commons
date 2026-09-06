import type { CandidateLedger, Ledger, Party } from "@campaign-commons/contracts";

const PARTY_LABELS: Record<Party, string> = {
  DEM: "Democratic", REP: "Republican", LIB: "Libertarian", GRE: "Green",
  IND: "Independent", CON: "Constitution", OTH: "Other",
};

export function buildFundingViews(ledger: Ledger) {
  const makeView = (id: string, label: string, candidates: CandidateLedger[]) => {
    const ids = new Set(candidates.map(c => c.candidate_id));
    const sum = (value: (c: CandidateLedger) => number) => candidates.reduce((total, c) => total + value(c), 0);
    const campaign = {
      receipts: sum(c => c.campaign.receipts),
      individuals: sum(c => c.campaign.from_individuals),
      conduits: sum(c => c.campaign.via_conduit_total),
      committees: sum(c => c.campaign.from_committees),
      other: sum(c => Math.max(0, c.campaign.receipts - c.campaign.from_individuals - c.campaign.from_committees)),
      disbursements: sum(c => c.campaign.disbursements),
      cash: candidates.length > 0 && candidates.every(c => c.campaign.cash_on_hand !== undefined)
        ? sum(c => c.campaign.cash_on_hand!) : null,
    };
    const outside = { total: sum(c => c.outside.total), support: sum(c => c.outside.support), oppose: sum(c => c.outside.oppose) };
    const visibility = { disclosed: 0, inferable: 0, unwalked: 0, dark: 0, unavailable: 0 };
    if (id === "all" && ledger.traceability) {
      const t = ledger.traceability;
      visibility.disclosed = t.traced_to_individuals;
      visibility.inferable = t.inferable;
      visibility.unwalked = t.unwalked ?? 0;
      visibility.dark = t.dark;
    } else {
      for (const spender of ledger.top_outside_spenders) {
        const amount = spender.by_candidate.filter(c => ids.has(c.candidate_id)).reduce((total, c) => total + c.amount, 0);
        if (!spender.visibility_shares) continue;
        // Estimate the source composition of spending using the spender's reported receipt shares.
        for (const key of ["disclosed", "inferable", "unwalked", "dark"] as const) {
          visibility[key] += amount * spender.visibility_shares[key];
        }
      }
    }
    // Missing chains and spenders outside the loaded list remain unknown, never assumed dark.
    const accounted = visibility.disclosed + visibility.inferable + visibility.unwalked + visibility.dark;
    visibility.unavailable = Math.max(0, outside.total - accounted);
    return {
      id, label, names: candidates.map(c => c.name).join(" & "), campaign, outside, visibility,
      sources: candidates.map(c => ({ id: c.candidate_id, name: c.name, campaign: c.campaign.source_url, outside: c.outside.source_url })),
      publishedVisibility: id === "all" && ledger.traceability !== null,
      method: id === "all" ? ledger.traceability?.method ?? null : null,
    };
  };
  return [
    makeView("all", "All candidates", ledger.candidates),
    ...ledger.candidates.map(c => makeView(c.candidate_id, `${PARTY_LABELS[c.party]} candidate`, [c])),
  ];
}

export type FundingView = ReturnType<typeof buildFundingViews>[number];

export type SliceGroup = "campaign" | "outside";

/** Campaign money in one hue, outside spending in another (D-16); the detailed view uses shades of the same two hues. */
export const GROUP_COLORS: Record<SliceGroup, string> = { campaign: "#343f49", outside: "#b7ab98" };
const CAMPAIGN_SHADES = ["#343f49", "#5b6874", "#8a95a0"];
const OUTSIDE_SHADES = ["#8c7e6a", "#cbc1b0"];

export type PieSlice = { id: string; group: SliceGroup; label: string; amount: number; color: string };

/** Summary: receipts vs outside. Detailed: receipts by source (individuals / committees / other) and outside by stance (supporting / opposing). */
export function pieSlices(view: FundingView, detailed: boolean): PieSlice[] {
  if (!detailed) {
    return [
      { id: "campaign", group: "campaign", label: "Campaign receipts", amount: view.campaign.receipts, color: GROUP_COLORS.campaign },
      { id: "outside", group: "outside", label: "Outside spending", amount: view.outside.total, color: GROUP_COLORS.outside },
    ];
  }
  return [
    { id: "individuals", group: "campaign", label: "Receipts from individuals", amount: view.campaign.individuals, color: CAMPAIGN_SHADES[0] },
    { id: "committees", group: "campaign", label: "Receipts from committees", amount: view.campaign.committees, color: CAMPAIGN_SHADES[1] },
    { id: "other", group: "campaign", label: "Other receipts", amount: view.campaign.other, color: CAMPAIGN_SHADES[2] },
    { id: "support", group: "outside", label: "Outside spending supporting", amount: view.outside.support, color: OUTSIDE_SHADES[0] },
    { id: "oppose", group: "outside", label: "Outside spending opposing", amount: view.outside.oppose, color: OUTSIDE_SHADES[1] },
  ];
}

/** Adds start/end angles (clockwise from 12 o'clock) so the pie can be drawn with hand-rolled sectors. */
export function pieSectors(slices: PieSlice[]) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.amount), 0);
  let angle = -Math.PI / 2;
  return slices.map(s => {
    const start = angle;
    angle += total > 0 ? (Math.max(0, s.amount) / total) * Math.PI * 2 : 0;
    return { ...s, start, end: angle, share: total > 0 ? s.amount / total : 0 };
  });
}
