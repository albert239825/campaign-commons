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
    // `disclosed` = individuals + organizations; the split is shown when the artifacts carry it.
    const visibility = { disclosed: 0, disclosed_individuals: 0, disclosed_organizations: 0, inferable: 0, unwalked: 0, dark: 0, unavailable: 0 };
    let hasSplit = false;
    if (id === "all" && ledger.traceability) {
      const t = ledger.traceability;
      visibility.disclosed = t.traced_to_individuals + (t.traced_to_organizations ?? 0);
      visibility.disclosed_individuals = t.traced_to_individuals;
      visibility.disclosed_organizations = t.traced_to_organizations ?? 0;
      visibility.inferable = t.inferable;
      visibility.unwalked = t.unwalked ?? 0;
      visibility.dark = t.dark;
      hasSplit = t.traced_to_organizations !== undefined;
    } else {
      for (const spender of ledger.top_outside_spenders) {
        const amount = spender.by_candidate.filter(c => ids.has(c.candidate_id)).reduce((total, c) => total + c.amount, 0);
        const shares = spender.visibility_shares;
        if (!shares) continue;
        // Estimate the source composition of spending using the spender's reported receipt shares.
        for (const key of ["disclosed", "inferable", "unwalked", "dark"] as const) {
          visibility[key] += amount * shares[key];
        }
        const organizations = shares.disclosed_organizations ?? 0;
        visibility.disclosed_organizations += amount * organizations;
        visibility.disclosed_individuals += amount * (shares.disclosed_individuals ?? shares.disclosed - organizations);
        if (shares.disclosed_organizations !== undefined) hasSplit = true;
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
      hasSplit,
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
/** Detail views are shaded by party (D-88): darkest = receipts, lighter = outside spending. */
const PARTY_RAMPS: Partial<Record<Party, string[]>> = {
  DEM: ["#16305a", "#2f5688", "#5b82b8", "#93aed4", "#c3d2e8"],
  REP: ["#661a1d", "#93312f", "#bc5b57", "#d99693", "#eec4c1"],
};
const NEUTRAL_RAMPS = [
  ["#2f5d62", "#487477", "#5f8a8b", "#83a8a5", "#a3c1bd"],
  ["#6f4a2b", "#8a633f", "#a67c52", "#bc9870", "#d2b48c"],
];
/** A party ramp is used once per race; a second candidate of the same party falls back to a neutral ramp. */
function ramp(party: Party | null, index: number, taken: string[][]) {
  const hue = party ? PARTY_RAMPS[party] : undefined;
  return hue && !taken.includes(hue) ? hue : NEUTRAL_RAMPS[index % NEUTRAL_RAMPS.length];
}

export type PieSlice = {
  id: string; group: SliceGroup; label: string; amount: number; color: string;
  /** By-side slices only: the side they belong to, and the candidate view + detail slice that hold the underlying record. */
  side?: string; viewId?: string; pickId?: string;
};

/**
 * Summary: receipts vs outside. Detailed: receipts by source (individuals / committees / other) and outside by stance
 * (supporting / opposing). For the all-candidates view, detail is instead grouped by side — see `sideSlices`.
 */
export function pieSlices(view: FundingView, detailed: boolean, candidates: FundingView[] = []): PieSlice[] {
  if (detailed && view.id === "all" && candidates.length === 2) return sideSlices(candidates);
  if (!detailed) {
    return [
      { id: "campaign", group: "campaign", label: "Campaign receipts", amount: view.campaign.receipts, color: GROUP_COLORS.campaign },
      { id: "outside", group: "outside", label: "Outside spending", amount: view.outside.total, color: GROUP_COLORS.outside },
    ];
  }
  const shades = view.party ? ramp(view.party, 0, []) : [...CAMPAIGN_SHADES, ...OUTSIDE_SHADES];
  return [
    { id: "individuals", group: "campaign", label: "Receipts from individuals", amount: view.campaign.individuals, color: shades[0] },
    { id: "committees", group: "campaign", label: "Receipts from committees", amount: view.campaign.committees, color: shades[1] },
    { id: "other", group: "campaign", label: "Other receipts", amount: view.campaign.other, color: shades[2] },
    { id: "support", group: "outside", label: "Outside spending supporting", amount: view.outside.support, color: shades[3] },
    { id: "oppose", group: "outside", label: "Outside spending opposing", amount: view.outside.oppose, color: shades[4] },
  ];
}

/**
 * Two-candidate races only: one contiguous side per candidate — their receipts, outside spending supporting them, and
 * outside spending opposing the other candidate — so every dollar appears exactly once. "Money working for" a side is
 * never called a fundraising total. With more candidates an oppose total has no single side, so the
 * all-candidates detail stays on the five-slice source/stance cut.
 */
export function sideSlices([a, b]: FundingView[]): PieSlice[] {
  const ramps: string[][] = [];
  for (const [i, c] of [a, b].entries()) ramps.push(ramp(c.party, i, ramps));
  return [a, b].flatMap((c, i) => {
    const rival = i === 0 ? b : a;
    const side = c.names;
    const hue = [ramps[i][0], ramps[i][2], ramps[i][4]];
    return [
      { id: `${c.id}-campaign`, group: "campaign" as const, side, viewId: c.id, label: `Receipts, ${c.names}`, amount: c.campaign.receipts, color: hue[0] },
      { id: `${c.id}-support`, group: "outside" as const, side, viewId: c.id, pickId: "support", label: `Supporting ${c.names}`, amount: c.outside.support, color: hue[1] },
      { id: `${c.id}-oppose`, group: "outside" as const, side, viewId: rival.id, pickId: "oppose", label: `Opposing ${rival.names}`, amount: rival.outside.oppose, color: hue[2] },
    ];
  });
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
