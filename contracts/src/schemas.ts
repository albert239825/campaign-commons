import { z } from "zod";
import { ISSUE_IDS } from "./issues";

/**
 * Campaign Commons data contracts.
 *
 * The pipeline (Python) writes JSON files under data/out/ that MUST validate against
 * these schemas (`npm run validate` in contracts/). The web app (Next.js) imports the
 * inferred TypeScript types and reads the same files. This is the only coupling between
 * the two workstreams.
 *
 * File layout (all paths relative to data/out/):
 *   races.json                          -> RacesIndex
 *   <race_id>/ledger.json               -> Ledger
 *   <race_id>/entities/<entity_id>.json -> Entity
 *   <race_id>/chains/<entity_id>.json   -> Chain
 *   <race_id>/ads.json                  -> AdGallery
 *   <race_id>/dossiers/<candidate_id>.json -> Dossier
 *   <race_id>/stories.json              -> Stories
 *   <race_id>/donors/<donor_key>.json   -> DonorView
 *   <race_id>/vendors.json              -> VendorIndex        (Block 2)
 *   <race_id>/vendors/<vendor_id>.json  -> Vendor             (Block 2)
 *   <race_id>/issues.json               -> IssueSpending      (Block 2)
 *   search.json                         -> SearchIndex        (Block 2)
 *
 * Hand-maintained inputs (data/hand/<race_id>/, validated by the same tooling, merged in by the pipeline):
 *   issue_focus.json                    -> HandIssueFocusFile
 *   ad_issues.json                      -> HandAdIssuesFile
 *   ie_issues.json                      -> HandIeIssuesFile
 *   vendor_aliases.json                 -> HandVendorAliasesFile
 *   vendor_ad_links.json                -> HandVendorAdLinksFile
 *
 * Conventions:
 *   - Money is in US dollars as a plain number (no cents rounding required).
 *   - Dates are ISO-8601 strings (YYYY-MM-DD).
 *   - `source_url` points at the underlying government record (FEC / congress.gov / ad library).
 *     "Receipts, not conclusions": every number a user can see must have one.
 *   - `data_status` says whether a file is real pipeline output or a hand-written mock.
 *   - Copy in any string field must use adjacency language. Never "influenced", "bought", "exposed".
 *   - Anything that is not read straight off a government record carries a `Basis` (below) and the UI must
 *     show it. No unlabelled inference reaches the screen.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const IssueIdSchema = z.enum(ISSUE_IDS);
export const DirectionSchema = z.number().int().min(-2).max(2);

/** Visibility of a money edge / node. Color language: disclosed=#1D9E75, inferable=#EF9F27, dark=#E24B4A. */
export const VisibilitySchema = z.enum(["disclosed", "inferable", "dark"]);

export const DataStatusSchema = z.enum(["real", "mock", "partial"]);

export const PartySchema = z.enum(["DEM", "REP", "LIB", "GRE", "IND", "CON", "OTH"]);

export const SupportOpposeSchema = z.enum(["S", "O"]);

export const EntityKindSchema = z.enum([
  "committee", // in FEC committee master (has a C######## id)
  "individual", // natural person (disclosed terminus)
  "organization", // org/LLC/c4 not in committee master (dark terminus unless inferable)
  "conduit", // ActBlue / WinRed etc. — a pipe, not a source
  "aggregate", // synthetic "other / pruned" node so dollars conserve
]);

/**
 * FEC committee_type codes we care about. Full list:
 * https://www.fec.gov/campaign-finance-data/committee-type-code-descriptions/
 */
export const CommitteeTypeSchema = z.enum([
  "H", // House candidate
  "S", // Senate candidate
  "P", // Presidential candidate
  "X", // Party, non-qualified
  "Y", // Party, qualified
  "Z", // National party non-federal account
  "N", // PAC, non-qualified
  "Q", // PAC, qualified
  "O", // Super PAC (independent expenditure-only)
  "U", // Single-candidate independent expenditure
  "V", // Hybrid PAC (Carey) non-qualified
  "W", // Hybrid PAC (Carey) qualified
  "D", // Delegate committee
  "E", // Electioneering communication
  "I", // Independent expenditor (person or group, not a committee)
  "C", // Communication cost
]);

export const FlagIdSchema = z.enum([
  "popup", // registered <60 days pre-election + IEs + no donor filings yet
  "single_transfer_funded", // >=90% of itemized receipts from one counterparty
  "shell_cluster", // shares address / registered agent / treasurer with other entities
  "dead_end_dark", // chain terminates in a c4 / LLC / undisclosed org
  "one_way_valve_violation", // super PAC -> candidate/party money edge (bug or story; surface it)
  "transfer_mismatch", // sender Sched B and receiver Sched A disagree
]);

export const FlagSchema = z.object({
  id: FlagIdSchema,
  label: z.string(),
  detail: z.string(),
  evidence_url: z.string().url().optional(),
});

export const SourceRefSchema = z.object({
  label: z.string(),
  url: z.string().url(),
});

/**
 * How a relationship or number reached the UI. Edge styling in the graph and the label on every card derive from this:
 *   filed     solid   — read directly off a government record (FEC row, ad-library entry). `rule` names the record.
 *   verified  solid   — a human checked a source that states the relationship (vendor portfolio, FCC form, Meta
 *                       paid-for-by, the org's own site). `source_urls` + `checked_by` required.
 *   inferred  dashed  — derived by an explicit rule stated in `rule` (e.g. "only digital vendor this sponsor paid
 *                       during the ad's run window"). Never presented as fact.
 * Co-occurrence alone (two records overlapping in time) is not a basis and is never drawn as an edge; see
 * `AdSchema.same_window_buys` for how that fact is carried as context instead.
 */
export const EvidenceBasisSchema = z.enum(["filed", "verified", "inferred"]);

const basisFields = {
  /** one plain-English sentence shown to the user: what the record says, or how this was derived and why it is uncertain */
  rule: z.string().min(1),
};

/** `verified` is the only basis that asserts a human checked a source, so it is the only one that must name the source and the human. */
export const BasisSchema = z.discriminatedUnion("basis", [
  z.object({
    basis: z.literal("verified"),
    ...basisFields,
    source_urls: z.array(z.string().url()).min(1),
    checked_by: z.string().min(1), // initials/handle of the human
    checked_at: z.string().min(1), // ISO date
  }),
  z.object({
    basis: z.enum(["filed", "inferred"]),
    ...basisFields,
    source_urls: z.array(z.string().url()),
    checked_by: z.string().nullable(),
    checked_at: z.string().nullable(),
  }),
]);

/** Issue tags always travel with the basis that says who tagged them and from what. */
export const IssueTagsSchema = z.object({
  issue_ids: z.array(IssueIdSchema).min(1).max(3), // first is primary
  basis: BasisSchema,
});

/** What an independent expenditure paid for, classified from the filed `purpose` string. Raw purpose is always kept. */
export const MediumSchema = z.enum([
  "tv", // broadcast / cable placement
  "radio",
  "digital", // online / streaming / social placement
  "mail",
  "phones", // phone, text, robocall
  "production", // creative production, not placement
  "consulting", // strategy, research, polling, list acquisition
  "field", // canvassing, door-knocking, GOTV
  "other",
]);

// ---------------------------------------------------------------------------
// races.json
// ---------------------------------------------------------------------------

export const RaceCandidateSchema = z.object({
  candidate_id: z.string(), // FEC candidate id, e.g. S6PA00217
  name: z.string(), // display name, e.g. "Bob Casey"
  party: PartySchema,
  incumbent: z.boolean(),
  principal_committee_id: z.string(),
  result: z.enum(["won", "lost", "pending"]).optional(),
});

export const RaceSummarySchema = z.object({
  race_id: z.string(), // e.g. "pa-sen-2024"
  label: z.string(), // "Pennsylvania · U.S. Senate · 2024"
  cycle: z.number().int(),
  state: z.string().length(2),
  office: z.enum(["S", "H", "P"]),
  district: z.string().optional(),
  election_date: z.string(),
  status: z.enum(["complete", "live", "stub"]),
  candidates: z.array(RaceCandidateSchema),
  totals: z.object({
    campaign_receipts: z.number(),
    outside_spending: z.number(),
    outside_share: z.number().min(0).max(1), // outside / (campaign + outside)
  }),
  traceability_score: z.number().min(0).max(1).nullable(),
  data_status: DataStatusSchema,
});

export const RacesIndexSchema = z.object({
  generated_at: z.string(),
  races: z.array(RaceSummarySchema),
});

// ---------------------------------------------------------------------------
// <race_id>/ledger.json
// ---------------------------------------------------------------------------

export const CandidateLedgerSchema = RaceCandidateSchema.extend({
  campaign: z.object({
    receipts: z.number(),
    disbursements: z.number(),
    from_individuals: z.number(),
    from_committees: z.number(), // PACs, party, other committees
    via_conduit_total: z.number(), // portion of from_individuals that arrived via ActBlue/WinRed (already attributed to individuals)
    cash_on_hand: z.number().optional(),
    source_url: z.string().url(),
  }),
  outside: z.object({
    support: z.number(),
    oppose: z.number(),
    total: z.number(),
    source_url: z.string().url(),
  }),
  /** share of outside money (support+oppose) that resolves to a named human. null until computed. */
  traceability_score: z.number().min(0).max(1).nullable(),
});

/**
 * Where a committee's traced dollars stopped. `unwalked` = an FEC-registered committee whose own receipts this walk
 * did not read (outside the loaded neighborhood, hop or node cap): neither disclosed nor dark. Sums to ~1.
 */
export const VisibilitySharesSchema = z.object({
  disclosed: z.number().min(0).max(1),
  inferable: z.number().min(0).max(1),
  unwalked: z.number().min(0).max(1),
  dark: z.number().min(0).max(1),
});

export const OutsideSpenderSchema = z.object({
  entity_id: z.string(),
  name: z.string(),
  committee_type: CommitteeTypeSchema.nullable(),
  committee_type_label: z.string(), // "Super PAC", "Hybrid PAC", "Party committee", ...
  total: z.number(),
  by_candidate: z.array(
    z.object({
      candidate_id: z.string(),
      support_oppose: SupportOpposeSchema,
      amount: z.number(),
    }),
  ),
  traceability_score: z.number().min(0).max(1).nullable(),
  /** the spender's chain summary shares (chains/<entity_id>.json); present iff has_chain */
  visibility_shares: VisibilitySharesSchema.optional(),
  flags: z.array(FlagIdSchema),
  has_chain: z.boolean(), // chains/<entity_id>.json exists
  source_url: z.string().url(),
});

export const TraceabilitySchema = z.object({
  /** headline number for the race: share of all outside dollars that resolve to a named human */
  score: z.number().min(0).max(1),
  outside_total: z.number(),
  traced_to_individuals: z.number(),
  inferable: z.number(),
  /** dollars that reached an FEC committee the walk did not read; counted neither as disclosed nor as dark */
  unwalked: z.number().optional(),
  dark: z.number(),
  method: z.string(), // one-paragraph plain-English definition of how it was computed
  preliminary: z.boolean(),
});

export const LedgerSchema = z.object({
  race_id: z.string(),
  generated_at: z.string(),
  data_status: DataStatusSchema,
  candidates: z.array(CandidateLedgerSchema),
  top_outside_spenders: z.array(OutsideSpenderSchema),
  traceability: TraceabilitySchema.nullable(),
  notes: z.array(z.string()), // methodology caveats shown in the UI footer
});

// ---------------------------------------------------------------------------
// <race_id>/entities/<entity_id>.json
// ---------------------------------------------------------------------------

/** A money edge. Money flows from -> to. */
export const TransferSchema = z.object({
  transfer_id: z.string(),
  from_entity_id: z.string(),
  from_name: z.string(),
  to_entity_id: z.string(),
  to_name: z.string(),
  amount: z.number(),
  date: z.string().nullable(), // latest transaction date in the aggregate
  first_date: z.string().nullable().optional(), // earliest transaction date; equals `date` for a single transaction
  count: z.number().int().optional(), // underlying transactions rolled into this row
  visibility: VisibilitySchema,
  transaction_type: z.string().nullable(), // modal FEC transaction type code (15, 15E, 18G, 18K, 24K, ...)
  limit: z.union([z.number(), z.literal("unlimited")]).nullable(), // statutory cap
  source_url: z.string().url(),
});

/** A targeting edge (independent expenditure). No money moves to the candidate. */
export const IndependentExpenditureSchema = z.object({
  ie_id: z.string(),
  spender_entity_id: z.string(),
  spender_name: z.string(),
  candidate_id: z.string(),
  candidate_name: z.string(),
  support_oppose: SupportOpposeSchema,
  amount: z.number(),
  date: z.string().nullable(),
  purpose: z.string().nullable(),
  payee: z.string().nullable(),
  source_url: z.string().url(),
  // Block 2 (campaign_commons.vendors): normalized payee and classified medium; null when payee is empty
  vendor_id: z.string().nullable().optional(),
  medium: MediumSchema.optional(),
  // Block 2 (campaign_commons.issues, from data/hand/<race>/ie_issues.json): what the notice says the ad was about
  issues: IssueTagsSchema.optional(),
});

/** One vendor row on an entity page ("Where the money went"): the entity's IEs paid to this vendor, aggregated. */
export const EntityVendorRowSchema = z.object({
  vendor_id: z.string(),
  name: z.string(),
  amount: z.number(),
  count: z.number().int(),
  media_mix: z.array(z.object({ medium: MediumSchema, amount: z.number(), count: z.number().int() })),
  targets: z.array(z.object({ candidate_id: z.string(), support_oppose: SupportOpposeSchema, amount: z.number() })),
  first_date: z.string().nullable(),
  last_date: z.string().nullable(),
  source_url: z.string().url(), // fec.gov IE view filtered to spender + payee
});

/** A committee's / funder's self-described focus, hand-tagged from the org's own material (data/hand/<race>/issue_focus.json). */
export const FocusKindSchema = z.enum([
  "single_issue", // exists for one issue (e.g. crypto policy)
  "multi_issue", // an ideological/advocacy org with a stated agenda across issues
  "general_partisan", // party committee / leadership super PAC: exists to win seats, not for an issue
  "candidate_aligned", // single-candidate vehicle
  "business_trade", // trade association / corporate PAC
  "labor", // union PAC
]);

/** kinds that exist FOR an issue: must name at least one */
export const IssueFocusKindSchema = z.enum(["single_issue", "multi_issue"]);
/** kinds whose focus is not an issue (a party, a candidate, a sector); issue tags optional */
export const NonIssueFocusKindSchema = z.enum(["general_partisan", "candidate_aligned", "business_trade", "labor"]);

/** `{kind, issue_ids}` with the kind-dependent minimum enforced; spread into the row shapes below. */
function focusVariants<T extends z.ZodRawShape>(fields: T) {
  return z.union([
    z.object({ kind: IssueFocusKindSchema, issue_ids: z.array(IssueIdSchema).min(1).max(3), ...fields }), // first is primary
    z.object({ kind: NonIssueFocusKindSchema, issue_ids: z.array(IssueIdSchema).max(3), ...fields }),
  ]);
}

export const IssueFocusSchema = focusVariants({
  /** one sentence in the org's own words (quote or close paraphrase); never our characterization */
  description: z.string(),
  basis: BasisSchema, // verified (org site / Wayback / FEC Form 1 connected org) with source_urls
});

export const EntitySchema = z.object({
  entity_id: z.string(),
  race_id: z.string(),
  kind: EntityKindSchema,
  name: z.string(),
  aliases: z.array(z.string()),
  committee_type: CommitteeTypeSchema.nullable(),
  committee_type_label: z.string().nullable(),
  designation: z.string().nullable(), // FEC designation code (A/B/D/J/P/U)
  registration_date: z.string().nullable(),
  treasurer: z.string().nullable(),
  address: z
    .object({
      street: z.string().nullable(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      zip: z.string().nullable(),
    })
    .nullable(),
  visibility: VisibilitySchema, // how visible this entity's *own* funding is
  is_conduit: z.boolean(),
  totals: z.object({
    receipts: z.number(),
    disbursements: z.number(),
    independent_expenditures: z.number(), // 2024-cycle total across all races (FEC summary), not just this race
    from_individuals: z.number(),
    from_committees: z.number(),
    from_organizations: z.number().optional(), // named businesses / unions giving from their own treasury (disclosed)
    from_undisclosed: z.number(), // LLCs, trusts, advocacy nonprofits, unclassifiable orgs (dark)
  }),
  inflows: z.array(TransferSchema), // top N by amount, aggregated per counterparty
  outflows: z.array(TransferSchema),
  independent_expenditures: z.array(IndependentExpenditureSchema),
  flags: z.array(FlagSchema),
  has_chain: z.boolean(),
  source_url: z.string().url(), // FEC committee page
  data_status: DataStatusSchema,
  // Block 2 (campaign_commons.vendors): IEs grouped by normalized payee; sum equals sum(independent_expenditures.amount)
  vendors: z.array(EntityVendorRowSchema).optional(),
  // Block 2 (campaign_commons.issues): present only for hand-tagged committees
  issue_focus: IssueFocusSchema.optional(),
});

// ---------------------------------------------------------------------------
// <race_id>/chains/<entity_id>.json
// ---------------------------------------------------------------------------

// Name-based classification of a Schedule A ENTITY_TP=ORG contributor (pipeline/campaign_commons/orgs.py, D-38).
export const OrganizationClassSchema = z.enum(["union", "business", "llc", "nonprofit", "unknown"]);

export const TerminusReasonSchema = z.enum([
  "individual", // reached a natural person: disclosed terminus
  "organization", // reached a named business or union giving from its own treasury: disclosed terminus
  "dark", // reached an org whose own funding is not on file (LLC, trust, advocacy nonprofit, unclassifiable)
  "inferable", // reached an org whose funding is reconstructable from 990s (lagged)
  "cycle", // already visited
  "depth_cap", // FEC-registered committee whose receipts were not walked (outside the loaded neighborhood or hop cap)
  "pruned", // below materiality threshold, rolled into an aggregate node
]);

/**
 * Node kinds in a chain. The five EntityKinds sit on the funding side (left of the root); the three Block 2 kinds sit on
 * the spending side (right of the root): vendor = Schedule E payee, ad = ad-library creative, candidate = IE target.
 */
export const ChainNodeKindSchema = z.enum([...EntityKindSchema.options, "vendor", "ad", "candidate"]);

const chainNodeFields = {
  id: z.string(),
  name: z.string(),
  committee_type: CommitteeTypeSchema.nullable(),
  /** hops from the root on either side; 0 = the root spender. `side` says which direction. */
  depth: z.number().int().min(0),
  /** absent/"in" = funding side (money toward the root); "out" = spending side (root → vendor → ad ⇢ candidate) */
  side: z.enum(["in", "out"]).optional(),
  visibility: VisibilitySchema,
  /** funding side: dollars flowing through this node toward the root. spending side: dollars from the root reaching it
   *  (vendor: IE paid; ad: spend-range midpoint, see `basis`; candidate: IE dollars aimed at them) */
  amount_in: z.number(),
  is_terminus: z.boolean(),
  terminus_reason: TerminusReasonSchema.nullable(),
  source_url: z.string().url().nullable(),
  contributor_count: z.number().int().optional(), // pruned aggregates: how many counterparties were rolled up
  organization_class: OrganizationClassSchema.optional(), // kind === "organization": how the name was classified
  // spending-side extras
  medium: MediumSchema.optional(), // kind === "vendor": dominant medium
  thumbnail_path: z.string().nullable().optional(), // kind === "ad": cached creative under web/public
  href: z.string().optional(), // in-app page for this node (entity / vendor / ad page / dossier)
};

/** Spending-side kinds (vendor / ad / candidate) are derived, so they must say how (`basis`); funding-side nodes are read off
 *  filings and may omit it. */
export const ChainNodeSchema = z.union([
  z.object({
    ...chainNodeFields,
    kind: z.enum(["vendor", "ad", "candidate"]),
    side: z.literal("out"),
    basis: BasisSchema, // vendor: payee grouping; ad: spend-range midpoint; candidate: what the dollars aimed at them are
  }),
  z.object({
    ...chainNodeFields,
    kind: EntityKindSchema,
    basis: BasisSchema.optional(), // e.g. an out-side aggregate of folded ads
  }),
]);

export const ChainEdgeKindSchema = z.enum([
  "money", // dollars move from → to (transfer, contribution, IE payment to a vendor)
  "placement", // vendor → ad: produced/placed; no dollars; carries a Basis (verified / inferred only)
  "targeting", // ad or root → candidate: for/against; no dollars reach the candidate
]);

const chainEdgeFields = {
  from: z.string(),
  to: z.string(),
  amount: z.number(),
  visibility: VisibilitySchema,
  /** funding side: depth of `from`. spending side: depth of `to` (so the root's outgoing edges are depth 1). */
  depth: z.number().int().min(1),
  transaction_types: z.array(z.string()),
  count: z.number().int(), // number of underlying transactions aggregated
  date_range: z.tuple([z.string(), z.string()]).nullable(),
  source_url: z.string().url().nullable(),
  support_oppose: SupportOpposeSchema.nullable().optional(), // targeting edges
};

/** A placement (vendor → ad) edge is never filed anywhere, so it cannot exist without saying how it was derived. */
export const ChainEdgeSchema = z.union([
  z.object({
    ...chainEdgeFields,
    kind: z.literal("placement"),
    basis: BasisSchema, // UI draws solid+check / dashed / dotted from basis.basis
  }),
  z.object({
    ...chainEdgeFields,
    kind: z.enum(["money", "targeting"]).optional(), // Block 2: absent = "money"
    basis: BasisSchema.optional(),
  }),
]);

export const ChainSchema = z.object({
  root_entity_id: z.string(),
  root_name: z.string(),
  race_id: z.string(),
  generated_at: z.string(),
  data_status: DataStatusSchema,
  nodes: z.array(ChainNodeSchema),
  edges: z.array(ChainEdgeSchema),
  summary: z.object({
    total_in: z.number(),
    disclosed_share: z.number().min(0).max(1),
    inferable_share: z.number().min(0).max(1),
    /** share that stopped at depth_cap termini (unwalked FEC committees); neither disclosed nor dark */
    unwalked_share: z.number().min(0).max(1).optional(),
    dark_share: z.number().min(0).max(1),
    max_depth: z.number().int(),
    terminus_counts: z.record(TerminusReasonSchema, z.number().int()),
    /** Block 2: spending side totals; absent when the chain has no `side: "out"` nodes */
    out_total: z.number().optional(), // sum of root → vendor money edges (= the root's IEs in this race)
    max_out_depth: z.number().int().optional(),
  }),
  flags: z.array(FlagSchema),
  method: z.string(),
});

// ---------------------------------------------------------------------------
// <race_id>/ads.json
// ---------------------------------------------------------------------------

/**
 * Ad ⇠ vendor relationship. FEC records sponsor → vendor → $; the ad library records sponsor → creative. Nothing filed
 * joins the two, so a link exists only when a rule or a person joins them, and every link carries a Basis:
 *   inferred — the sponsor paid exactly one digital vendor during the ad's run window
 *   verified — a source names both (vendor portfolio, FCC PB-18, Meta paid-for-by), via data/hand/<race>/vendor_ad_links.json
 * Mere date overlap is NOT a link (it used to be, as `adjacent`); it is carried on the ad as `same_window_buys` context.
 */
export const AdVendorLinkSchema = z.object({
  vendor_id: z.string(),
  vendor_name: z.string(),
  medium: MediumSchema,
  window: z.tuple([z.string(), z.string()]).nullable(), // the ad's [first_shown, last_shown] used for the overlap; null when the ad has no dates (verified links only)
  amount_in_window: z.number(), // sponsor → vendor IE dollars for placeable media whose date falls in the window
  buys_in_window: z.number().int(),
  basis: BasisSchema,
});

/**
 * Context, not a relationship: a vendor the sponsor paid, for a medium that could place or produce a platform ad, inside
 * the ad's run window. The FEC does not record which buy placed which ad, so the UI renders these as a sentence
 * ("while this ad ran, the sponsor reported digital buys to A and B") and never as a vendor → ad edge or link label.
 */
export const SameWindowBuySchema = z.object({
  vendor_id: z.string(),
  vendor_name: z.string(),
  medium: MediumSchema,
  amount_in_window: z.number(), // sponsor → vendor IE dollars dated in the window
  buys_in_window: z.number().int(),
  source_url: z.string().url(), // the vendor's Schedule E search on fec.gov
});
export type SameWindowBuy = z.infer<typeof SameWindowBuySchema>;

export const AdVerificationSchema = z.object({
  status: z.enum(["verified", "unverified"]),
  evidence_urls: z.array(z.string().url()), // [transparency URL(s), fec.gov URL(s)]; empty when unverified
  verified_at: z.string().nullable(),
});
export type AdVerification = z.infer<typeof AdVerificationSchema>;

export const AdSchema = z.object({
  ad_id: z.string(),
  platform: z.enum(["google", "meta"]),
  advertiser_id: z.string(),
  advertiser_name: z.string(),
  matched_entity_id: z.string().nullable(), // FEC committee id if resolved
  match_confidence: z.enum(["verified", "auto", "none"]),
  candidate_ids: z.array(z.string()), // candidates the ad is about, if known
  support_oppose: SupportOpposeSchema.nullable(),
  spend_range: z.object({ min: z.number(), max: z.number().nullable() }),
  impressions_range: z.object({ min: z.number(), max: z.number().nullable() }),
  first_shown: z.string().nullable(),
  last_shown: z.string().nullable(),
  ad_type: z.enum(["video", "image", "text", "unknown"]),
  creative_url: z.string().url(), // external ad-library URL (never hot-embed in demo)
  cached_creative_path: z.string().nullable(), // path under web/public/, e.g. /creatives/pa-sen-2024/CR123.png
  regions: z.array(z.string()),
  source_url: z.string().url(),
  // hand-checked ad -> committee link (pipeline/campaign_commons/data/ad_verifications.json); absent on older files
  verification: AdVerificationSchema.optional(),
  // ---- Block 2 ----
  /** the sponsor committee's chain summary shares (chains/<matched_entity_id>.json); null when unmatched or no chain.
   *  UI shows `dark` as a number ("34% of this sponsor's traced money is dark"), never a binary badge. */
  sponsor_visibility_shares: VisibilitySharesSchema.nullable().optional(),
  /** what the ad's content is about (data/hand/<race>/ad_issues.json); basis.source_urls = [creative_url], checked_by = tagger */
  issues: IssueTagsSchema.optional(),
  /** vendors joined to this ad by a rule or a person. Each link says how (inferred / verified); date overlap alone never qualifies. */
  vendor_links: z.array(AdVendorLinkSchema).optional(),
  /** every placeable-medium vendor the sponsor paid in the run window, linked or not — context for the reader, never an edge. */
  same_window_buys: z.array(SameWindowBuySchema).optional(),
});


export const AdGallerySchema = z.object({
  race_id: z.string(),
  generated_at: z.string(),
  data_status: DataStatusSchema,
  sources: z.array(z.enum(["google", "meta"])),
  ads: z.array(AdSchema),
  notes: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// <race_id>/dossiers/<candidate_id>.json
// ---------------------------------------------------------------------------

/** Evidence hierarchy, strongest first. Revealed preference beats stated preference. */
export const EVIDENCE_KINDS = [
  "roll_call_vote",
  "sponsored_bill",
  "cosponsored_bill",
  "stated_position",
  "curated_statement",
] as const;
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);

export const EvidenceSchema = z.object({
  kind: EvidenceKindSchema,
  title: z.string(),
  description: z.string().nullable(),
  date: z.string().nullable(),
  vote: z.enum(["Yea", "Nay", "Not Voting", "Present"]).nullable(),
  bill_id: z.string().nullable(), // e.g. "S.1234-118"
  congress: z.number().int().nullable(),
  roll_number: z.number().int().nullable(),
  url: z.string().url(), // the government record (or campaign site for stated positions)
  source_label: z.string(), // "congress.gov", "senate.gov roll call", "campaign website (archived)"
});

export const StanceSchema = z.object({
  issue_id: IssueIdSchema,
  position: z.string(), // one sentence, descriptive, no causal language
  direction: DirectionSchema.optional(), // human-coded against ISSUE_AXES[issue_id]; absent = no coded position
  confidence: z.enum(["high", "medium", "low"]),
  needs_review: z.boolean(), // true until a human has verified position + evidence
  evidence: z.array(EvidenceSchema),
});

export const DossierSchema = z.object({
  candidate_id: z.string(),
  race_id: z.string(),
  name: z.string(),
  party: PartySchema,
  incumbent: z.boolean(),
  role: z.enum(["incumbent", "challenger"]),
  bioguide_id: z.string().nullable(),
  generated_at: z.string(),
  data_status: DataStatusSchema,
  /** Generated from the structured record only. Zero claims not evidenced in `stances`. */
  summary: z.string(),
  summary_needs_review: z.boolean(),
  evidence_basis: z.enum(["record", "statements", "mixed"]),
  asymmetry_note: z.string(), // shown in UI: incumbents judged on what they did; challengers on what they say
  stances: z.array(StanceSchema), // one per issue where any evidence exists; missing issues render as "no record"
  links: z.object({
    fec_url: z.string().url(),
    congress_url: z.string().url().nullable(),
    campaign_site: z.string().url().nullable(),
  }),
});

// ---------------------------------------------------------------------------
// <race_id>/stories.json — demo candidates, ranked; the human picks
// ---------------------------------------------------------------------------

export const StorySchema = z.object({
  story_id: z.string(),
  kind: z.enum(["dark_dead_end", "biggest_spender", "popup", "single_transfer", "ad_to_chain"]),
  title: z.string(),
  root_entity_id: z.string(),
  candidate_ids: z.array(z.string()),
  headline_numbers: z.object({
    amount: z.number(),
    dark_share: z.number().min(0).max(1).nullable(),
    hops: z.number().int().nullable(),
  }),
  narrative: z.string(), // adjacency language only
  ad_ids: z.array(z.string()),
  verified: z.boolean(), // a human has checked the chain
  verified_by_url: z.string().url().optional(), // the fec.gov record the human checked against
});

export const StoriesSchema = z.object({
  race_id: z.string(),
  generated_at: z.string(),
  data_status: DataStatusSchema,
  stories: z.array(StorySchema),
});

// ---------------------------------------------------------------------------
// <race_id>/donors/<donor_key>.json — forward walk from one of the largest chain sources (pipeline/campaign_commons/donors.py)
// ---------------------------------------------------------------------------

export const DonorNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["individual", "organization", "committee", "candidate"]),
  committee_type: CommitteeTypeSchema.nullable(),
  depth: z.number().int().min(0).max(3), // 0 donor, 1 committees it gave to, 2 spenders reached via transfers, 3 IE targets
  amount: z.number(), // money received from the parent (depth 1-2); IE dollars aimed at the candidate (depth 3)
  is_spender: z.boolean(), // an outside spender in this race (any depth >= 1)
  has_chain: z.boolean(), // chains/<id>.json exists
  source_url: z.string().url(),
});

export const DonorEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["money", "targeting"]), // targeting = independent expenditure: no money reaches the candidate
  amount: z.number(),
  support_oppose: SupportOpposeSchema.nullable(), // targeting edges only
  source_url: z.string().url(),
});

export const DonorViewSchema = z.object({
  donor_id: z.string(), // synthetic chain-node id (ind:NAME|ZIP / org:NAME)
  donor_key: z.string(), // file stem: donor_id with non [A-Za-z0-9_-] replaced by "-"
  name: z.string(),
  kind: z.enum(["individual", "organization"]),
  race_id: z.string(),
  generated_at: z.string(),
  data_status: DataStatusSchema,
  total_given: z.number(), // sum of the first-hop money edges shown (itemized receipts under this name)
  total_in_chains: z.number(), // ranking weight: summed amount_in across every chain the donor appears in (double counts)
  nodes: z.array(DonorNodeSchema).max(200),
  edges: z.array(DonorEdgeSchema),
  /** set whenever any amount past the donor's own gifts is shown (a transfer or an IE): those are pooled totals, not the donor's share */
  allocation_note: z.string().nullable(),
  truncated: z.boolean(),
  method: z.string(),
});

// ---------------------------------------------------------------------------
// <race_id>/vendors.json + <race_id>/vendors/<vendor_id>.json — Schedule E payees (pipeline/campaign_commons/vendors.py, Block 2)
// ---------------------------------------------------------------------------

export const VendorSummarySchema = z.object({
  vendor_id: z.string(), // "vendor:<slug>" — slug of the normalized name, e.g. vendor:waterfront-strategies
  name: z.string(), // normalized display name
  aliases: z.array(z.string()), // every raw payee string folded into this vendor
  /** how aliases were folded: filed = single raw string; inferred = case/punctuation/suffix rule or fuzzy match;
   *  verified = data/hand/<race>/vendor_aliases.json */
  normalization: BasisSchema,
  total: z.number(), // sum of IE rows in this race paid to this vendor (sums across spenders; never changes IE totals)
  count: z.number().int(),
  media_mix: z.array(z.object({ medium: MediumSchema, amount: z.number(), count: z.number().int() })),
  spenders: z.array(z.object({ entity_id: z.string(), name: z.string(), amount: z.number(), count: z.number().int() })),
  targets: z.array(z.object({ candidate_id: z.string(), support_oppose: SupportOpposeSchema, amount: z.number() })),
  first_date: z.string().nullable(),
  last_date: z.string().nullable(),
  source_url: z.string().url(), // fec.gov IE search filtered to this payee
});

export const VendorSchema = VendorSummarySchema.extend({
  race_id: z.string(),
  generated_at: z.string(),
  data_status: DataStatusSchema,
  expenditures: z.array(IndependentExpenditureSchema), // every IE row, all spenders
  /** ads (by sponsor) whose run window overlaps this vendor's buys — the reverse of Ad.vendor_links */
  ads: z.array(
    z.object({
      ad_id: z.string(),
      sponsor_entity_id: z.string(),
      basis: BasisSchema,
    }),
  ),
  method: z.string(),
});

export const VendorIndexSchema = z.object({
  race_id: z.string(),
  generated_at: z.string(),
  data_status: DataStatusSchema,
  vendors: z.array(VendorSummarySchema), // sorted by total desc
  total: z.number(), // sum over vendors; must equal the race's outside total
  by_medium: z.array(z.object({ medium: MediumSchema, amount: z.number(), count: z.number().int() })),
  /** how every `medium` in this race (IE rows, vendors, by_medium) was classified from `purpose` — one rule for the stage;
   *  the UI renders it wherever a medium is shown */
  medium_basis: BasisSchema,
  notes: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// <race_id>/issues.json — outside spending by issue (pipeline/campaign_commons/issues.py, Block 2)
// Two layers, never merged: what the ADS were about (attributable — the ad is the spending) vs what the SPENDERS say
// they are for (not attributable — a party PAC's dollars are not "about" anything).
// ---------------------------------------------------------------------------

export const AdIssueSpendingSchema = z.object({
  issue_id: IssueIdSchema,
  ad_count: z.number().int(),
  /** Google reports spend as a range per ad; these sum the range bounds and midpoints over tagged ads */
  spend_min: z.number(),
  spend_max: z.number(),
  spend_midpoint: z.number(),
  /** FEC IE dollars whose 24/48-hour notice was hand-tagged to this issue (ie_issues.json) */
  ie_amount: z.number(),
  ie_count: z.number().int(),
  by_candidate: z.array(
    z.object({ candidate_id: z.string(), support_oppose: SupportOpposeSchema, spend_midpoint: z.number(), ie_amount: z.number() }),
  ),
  basis: BasisSchema, // verified — the tags are human; rule states midpoint use and coverage
});

const spenderFocusSpendingFields = {
  primary_only: z.boolean(), // true: counts a spender under its primary issue only; false: under every tag (overlaps)
  amount: z.number(), // outside dollars in this race spent by spenders with this focus
  spender_ids: z.array(z.string()),
  traceability_score: z.number().min(0).max(1).nullable(), // dollar-weighted over these spenders' chains
  dark_share: z.number().min(0).max(1).nullable(),
};

export const SpenderFocusSpendingSchema = z.union([
  z.object({ kind: IssueFocusKindSchema, issue_id: IssueIdSchema, ...spenderFocusSpendingFields }), // one bucket per issue
  z.object({ kind: NonIssueFocusKindSchema, issue_id: IssueIdSchema.nullable(), ...spenderFocusSpendingFields }), // null = the kind itself is the bucket
]);

export const IssueSpendingSchema = z.object({
  race_id: z.string(),
  generated_at: z.string(),
  data_status: DataStatusSchema,
  by_ad_issue: z.array(AdIssueSpendingSchema),
  by_spender_focus: z.array(SpenderFocusSpendingSchema),
  coverage: z.object({
    spenders_tagged: z.number().int(),
    spenders_total: z.number().int(),
    dollars_tagged: z.number(), // outside dollars from tagged spenders
    dollars_total: z.number(),
    ads_tagged: z.number().int(),
    ads_total: z.number().int(),
    ies_tagged: z.number().int(),
    ie_dollars_tagged: z.number(),
  }),
  notes: z.array(z.string()), // shown under the cards: coverage, midpoint caveat, "focus is the spender's, not the dollars'"
});

// ---------------------------------------------------------------------------
// search.json — static client-side index over every page (pipeline/campaign_commons/search.py, Block 2)
// ---------------------------------------------------------------------------

export const SearchItemKindSchema = z.enum(["race", "candidate", "committee", "vendor", "donor", "organization"]);

export const SearchItemSchema = z.object({
  id: z.string(),
  kind: SearchItemKindSchema,
  race_id: z.string().nullable(), // null for cross-race items (none in V1)
  label: z.string(),
  sublabel: z.string().nullable(), // "Super PAC · $52.4M outside", "Senator (D) · incumbent", "Media vendor · TV"
  aliases: z.array(z.string()), // extra strings to match (raw payee spellings, committee abbreviations)
  href: z.string(), // in-app path
  weight: z.number(), // ranking tiebreak, dollars where meaningful
});

export const SearchIndexSchema = z.object({
  generated_at: z.string(),
  data_status: DataStatusSchema,
  items: z.array(SearchItemSchema),
});

// ---------------------------------------------------------------------------
// data/hand/<race_id>/*.json — human-maintained inputs. Every row needs a source and a tagger.
// ---------------------------------------------------------------------------

const HandFileBase = z.object({
  race_id: z.string(),
  /** who maintains this file and how rows were produced; shown on the methodology page */
  method: z.string(),
});

export const HandIssueFocusRowSchema = focusVariants({
  entity_id: z.string(), // FEC committee id, or org:<NAME> chain-node id for a non-committee funder
  name: z.string(), // as filed, for humans reading the file
  description: z.string(), // the org's own words
  source_urls: z.array(z.string().url()).min(1), // org site / Wayback / FEC Form 1
  quote: z.string().nullable(), // verbatim excerpt supporting `description`
  tagged_by: z.string(),
  tagged_at: z.string(),
});
export const HandIssueFocusFileSchema = HandFileBase.extend({ rows: z.array(HandIssueFocusRowSchema) });

export const HandAdIssueRowSchema = z.object({
  ad_id: z.string(),
  issue_ids: z.array(IssueIdSchema).min(1).max(3), // first is primary
  note: z.string().nullable(), // what in the creative supports the tag
  tagged_by: z.string(),
  tagged_at: z.string(),
});
export const HandAdIssuesFileSchema = HandFileBase.extend({ rows: z.array(HandAdIssueRowSchema) });

export const HandIeIssueRowSchema = z.object({
  ie_id: z.string(),
  issue_ids: z.array(IssueIdSchema).min(1).max(3),
  ad_title: z.string().nullable(), // as named in the 24/48-hour notice, if any
  source_url: z.string().url(), // the notice PDF the tagger read
  note: z.string().nullable(),
  tagged_by: z.string(),
  tagged_at: z.string(),
});
export const HandIeIssuesFileSchema = HandFileBase.extend({ rows: z.array(HandIeIssueRowSchema) });

export const HandVendorAliasRowSchema = z.object({
  vendor_id: z.string(),
  name: z.string(), // canonical display name
  aliases: z.array(z.string()).min(1), // raw payee strings to fold in (exact, case-insensitive)
  medium_override: MediumSchema.nullable(), // when the purpose strings misclassify a known vendor
  source_url: z.string().url().nullable(), // vendor site, if used to confirm the alias
  tagged_by: z.string(),
  tagged_at: z.string().optional(), // ISO date; becomes `checked_at` on the vendor's verified `normalization` basis
});
export const HandVendorAliasesFileSchema = HandFileBase.extend({ rows: z.array(HandVendorAliasRowSchema) });

export const HandVendorAdLinkRowSchema = z.object({
  ad_id: z.string(),
  vendor_id: z.string(),
  role: z.enum(["produced", "placed", "produced_and_placed"]),
  source_urls: z.array(z.string().url()).min(1), // the page that names both sponsor and vendor
  quote: z.string().nullable(),
  tagged_by: z.string(),
  tagged_at: z.string(),
});
export const HandVendorAdLinksFileSchema = HandFileBase.extend({ rows: z.array(HandVendorAdLinkRowSchema) });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvidenceBasis = z.infer<typeof EvidenceBasisSchema>;
export type Basis = z.infer<typeof BasisSchema>;
export type IssueTags = z.infer<typeof IssueTagsSchema>;
export type Medium = z.infer<typeof MediumSchema>;
export type SupportOppose = z.infer<typeof SupportOpposeSchema>;
export type EntityVendorRow = z.infer<typeof EntityVendorRowSchema>;
export type FocusKind = z.infer<typeof FocusKindSchema>;
export type IssueFocus = z.infer<typeof IssueFocusSchema>;
export type ChainNodeKind = z.infer<typeof ChainNodeKindSchema>;
export type ChainEdgeKind = z.infer<typeof ChainEdgeKindSchema>;
export type AdVendorLink = z.infer<typeof AdVendorLinkSchema>;
export type VendorSummary = z.infer<typeof VendorSummarySchema>;
export type Vendor = z.infer<typeof VendorSchema>;
export type VendorIndex = z.infer<typeof VendorIndexSchema>;
export type AdIssueSpending = z.infer<typeof AdIssueSpendingSchema>;
export type SpenderFocusSpending = z.infer<typeof SpenderFocusSpendingSchema>;
export type IssueSpending = z.infer<typeof IssueSpendingSchema>;
export type SearchItemKind = z.infer<typeof SearchItemKindSchema>;
export type SearchItem = z.infer<typeof SearchItemSchema>;
export type SearchIndex = z.infer<typeof SearchIndexSchema>;
export type HandIssueFocusFile = z.infer<typeof HandIssueFocusFileSchema>;
export type HandAdIssuesFile = z.infer<typeof HandAdIssuesFileSchema>;
export type HandIeIssuesFile = z.infer<typeof HandIeIssuesFileSchema>;
export type HandVendorAliasesFile = z.infer<typeof HandVendorAliasesFileSchema>;
export type HandVendorAdLinksFile = z.infer<typeof HandVendorAdLinksFileSchema>;

export type Visibility = z.infer<typeof VisibilitySchema>;
export type DataStatus = z.infer<typeof DataStatusSchema>;
export type Party = z.infer<typeof PartySchema>;
export type EntityKind = z.infer<typeof EntityKindSchema>;
export type CommitteeType = z.infer<typeof CommitteeTypeSchema>;
export type FlagId = z.infer<typeof FlagIdSchema>;
export type Flag = z.infer<typeof FlagSchema>;
export type RaceCandidate = z.infer<typeof RaceCandidateSchema>;
export type RaceSummary = z.infer<typeof RaceSummarySchema>;
export type RacesIndex = z.infer<typeof RacesIndexSchema>;
export type CandidateLedger = z.infer<typeof CandidateLedgerSchema>;
export type OutsideSpender = z.infer<typeof OutsideSpenderSchema>;
export type VisibilityShares = z.infer<typeof VisibilitySharesSchema>;
export type Traceability = z.infer<typeof TraceabilitySchema>;
export type Ledger = z.infer<typeof LedgerSchema>;
export type Transfer = z.infer<typeof TransferSchema>;
export type IndependentExpenditure = z.infer<typeof IndependentExpenditureSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type TerminusReason = z.infer<typeof TerminusReasonSchema>;
export type OrganizationClass = z.infer<typeof OrganizationClassSchema>;
export type ChainNode = z.infer<typeof ChainNodeSchema>;
export type ChainEdge = z.infer<typeof ChainEdgeSchema>;
export type Chain = z.infer<typeof ChainSchema>;
export type Ad = z.infer<typeof AdSchema>;
export type AdGallery = z.infer<typeof AdGallerySchema>;
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type Stance = z.infer<typeof StanceSchema>;
export type Dossier = z.infer<typeof DossierSchema>;
export type Story = z.infer<typeof StorySchema>;
export type Stories = z.infer<typeof StoriesSchema>;
export type DonorNode = z.infer<typeof DonorNodeSchema>;
export type DonorEdge = z.infer<typeof DonorEdgeSchema>;
export type DonorView = z.infer<typeof DonorViewSchema>;

/** Map from file pattern to schema, used by the validator. */
export const FILE_SCHEMAS = {
  "races.json": RacesIndexSchema,
  "ledger.json": LedgerSchema,
  "entities/*.json": EntitySchema,
  "chains/*.json": ChainSchema,
  "ads.json": AdGallerySchema,
  "dossiers/*.json": DossierSchema,
  "stories.json": StoriesSchema,
  "donors/*.json": DonorViewSchema,
  "vendors.json": VendorIndexSchema,
  "vendors/*.json": VendorSchema,
  "issues.json": IssueSpendingSchema,
  "search.json": SearchIndexSchema,
} as const;

/** data/hand/<race_id>/<file> → schema */
export const HAND_FILE_SCHEMAS = {
  "issue_focus.json": HandIssueFocusFileSchema,
  "ad_issues.json": HandAdIssuesFileSchema,
  "ie_issues.json": HandIeIssuesFileSchema,
  "vendor_aliases.json": HandVendorAliasesFileSchema,
  "vendor_ad_links.json": HandVendorAdLinksFileSchema,
} as const;
