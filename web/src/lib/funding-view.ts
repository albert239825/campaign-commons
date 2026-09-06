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

/** The two pie pairs. Outside dollars target a candidate; receipts are the campaign's own money. Never summed. */
export const FUNDING_MODES = [
  { id: "outside", label: "Outside spending", noun: "outside spending", about: "about", detail: "Independent expenditures for or against each candidate" },
  { id: "campaign", label: "Campaign receipts", noun: "campaign receipts", about: "for", detail: "What each candidate's own committees took in" },
] as const;
export type FundingMode = (typeof FUNDING_MODES)[number]["id"];

/** Two shades of the outside hue and three of the campaign hue (D-16: neutral money palette, never party or visibility colours). */
export const OUTSIDE_COLORS = { support: "#8c7e6a", oppose: "#cbc1b0" } as const;
export const RECEIPT_COLORS = { individuals: "#343f49", committees: "#6e7983", other: "#adb4bb" } as const;

/** `label` names the candidate for the detail column and screen readers; `short` sits under the pie, where the card header already does. */
export type PieSlice = { id: string; label: string; short: string; amount: number; color: string };

/** Slices of one candidate's pie in the given mode; amounts are as filed, `other` is floored at zero upstream. */
export function pieSlices(view: FundingView, mode: FundingMode): PieSlice[] {
  const name = view.names || "this candidate";
  if (mode === "outside") {
    return [
      { id: "support", label: `Supporting ${name}`, short: "Supporting", amount: view.outside.support, color: OUTSIDE_COLORS.support },
      { id: "oppose", label: `Opposing ${name}`, short: "Opposing", amount: view.outside.oppose, color: OUTSIDE_COLORS.oppose },
    ];
  }
  return [
    { id: "individuals", label: "From individuals", short: "Individuals", amount: view.campaign.individuals, color: RECEIPT_COLORS.individuals },
    { id: "committees", label: "From committees (PACs, party)", short: "Committees", amount: view.campaign.committees, color: RECEIPT_COLORS.committees },
    { id: "other", label: "Other receipts", short: "Other", amount: view.campaign.other, color: RECEIPT_COLORS.other },
  ];
}

export const pieTotal = (view: FundingView, mode: FundingMode) => (mode === "outside" ? view.outside.total : view.campaign.receipts);

/** The race-wide view (published totals) and one view per candidate, in ledger order. */
export function splitFundingViews(views: FundingView[]) {
  return { race: views.find(v => v.id === "all") ?? null, candidates: views.filter(v => v.id !== "all") };
}
