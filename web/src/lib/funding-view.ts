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
      party: candidates.length === 1 ? candidates[0].party : null,
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

/** Campaign hue for money that reaches the campaign; two shades of the outside hue for independent expenditures (D-16). */
export const SIDE_COLORS = { campaign: "#343f49", support: "#8c7e6a", oppose: "#cbc1b0" } as const;
export type SideSliceId = keyof typeof SIDE_COLORS;

/** `label` names the candidates for the detail column and screen readers; `short` sits under the pie, where the card header already does. */
export type SideSlice = { id: SideSliceId; label: string; short: string; amount: number; color: string };

/** Outside spending about a set of candidates, with the per-candidate visibility estimates summed (they are per-spender weights, so additive). */
export function aggregateOutside(views: FundingView[]) {
  const sum = (value: (v: FundingView) => number) => views.reduce((total, v) => total + value(v), 0);
  return {
    names: views.map(v => v.names).join(" & "),
    outside: { total: sum(v => v.outside.total), support: sum(v => v.outside.support), oppose: sum(v => v.outside.oppose) },
    visibility: {
      disclosed: sum(v => v.visibility.disclosed), inferable: sum(v => v.visibility.inferable), unwalked: sum(v => v.visibility.unwalked),
      dark: sum(v => v.visibility.dark), unavailable: sum(v => v.visibility.unavailable),
    },
  };
}

/**
 * Money working for one candidate's side: the campaign's own receipts, independent expenditures supporting them, and
 * independent expenditures opposing their opponent(s). Receipts reach the campaign; the two outside slices never do,
 * so the side total is a comparison figure, not a fundraising total.
 */
export function buildSide(view: FundingView, opponents: FundingView[]) {
  const name = view.names || "this candidate";
  const rivals = aggregateOutside(opponents);
  const rivalLabel = opponents.length === 1 ? rivals.names : "opponents";
  const slices: SideSlice[] = [
    { id: "campaign", label: `Campaign receipts, ${name}`, short: "Campaign receipts", amount: view.campaign.receipts, color: SIDE_COLORS.campaign },
    { id: "support", label: `Outside spending supporting ${name}`, short: `Supporting ${name}`, amount: view.outside.support, color: SIDE_COLORS.support },
    { id: "oppose", label: `Outside spending opposing ${rivalLabel}`, short: `Opposing ${rivalLabel}`, amount: rivals.outside.oppose, color: SIDE_COLORS.oppose },
  ];
  return { view, opponents, rivals, rivalLabel, slices, total: slices.reduce((sum, s) => sum + s.amount, 0) };
}
export type Side = ReturnType<typeof buildSide>;

/** The race-wide view (published totals) and one side per candidate, in ledger order. */
export function buildSides(views: FundingView[]) {
  const race = views.find(v => v.id === "all") ?? null;
  const candidates = views.filter(v => v.id !== "all");
  return { race, sides: candidates.map(view => buildSide(view, candidates.filter(other => other.id !== view.id))) };
}
