import { z } from "zod";
import { ISSUE_IDS } from "./issues";

/**
 * Citizen Gotham data contracts.
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
 *   <race_id>/trails.json               -> Trails (Money Trails: precomputed plain-English answers)
 *
 * Conventions:
 *   - Money is in US dollars as a plain number (no cents rounding required).
 *   - Dates are ISO-8601 strings (YYYY-MM-DD).
 *   - `source_url` points at the underlying government record (FEC / congress.gov / ad library).
 *     "Receipts, not conclusions": every number a user can see must have one.
 *   - `data_status` says whether a file is real pipeline output or a hand-written mock.
 *   - Copy in any string field must use adjacency language. Never "influenced", "bought", "exposed".
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
});

// ---------------------------------------------------------------------------
// <race_id>/chains/<entity_id>.json
// ---------------------------------------------------------------------------

// Name-based classification of a Schedule A ENTITY_TP=ORG contributor (pipeline/gotham/orgs.py, D-38).
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

export const ChainNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: EntityKindSchema,
  committee_type: CommitteeTypeSchema.nullable(),
  depth: z.number().int().min(0), // 0 = the root spender
  visibility: VisibilitySchema,
  amount_in: z.number(), // dollars flowing through this node toward the root
  is_terminus: z.boolean(),
  terminus_reason: TerminusReasonSchema.nullable(),
  source_url: z.string().url().nullable(),
  contributor_count: z.number().int().optional(), // pruned aggregates: how many counterparties were rolled up
  organization_class: OrganizationClassSchema.optional(), // kind === "organization": how the name was classified
});

export const ChainEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  amount: z.number(),
  visibility: VisibilitySchema,
  depth: z.number().int().min(1), // depth of `from`
  transaction_types: z.array(z.string()),
  count: z.number().int(), // number of underlying transactions aggregated
  date_range: z.tuple([z.string(), z.string()]).nullable(),
  source_url: z.string().url().nullable(),
});

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
  }),
  flags: z.array(FlagSchema),
  method: z.string(),
});

// ---------------------------------------------------------------------------
// <race_id>/ads.json
// ---------------------------------------------------------------------------

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
  // hand-checked ad -> committee link (pipeline/gotham/data/ad_verifications.json); absent on older files
  verification: AdVerificationSchema.optional(),
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
// <race_id>/donors/<donor_key>.json — forward walk from one of the largest chain sources (pipeline/gotham/donors.py)
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
// <race_id>/trails.json — precomputed plain-English "Money Trails" answers (pipeline/gotham/trails.py)
//
// A question is resolved on the client by deterministic keyword + name matching (no LLM, no graph database) to one
// of three intents and one subject, then the matching precomputed answer is rendered. Every number is a `Figure`
// carrying the government/platform record it came from; money edges and targeting edges are separate types so an
// independent expenditure can never be rendered as dollars reaching a candidate, and no structure exists that ties
// an upstream funder to a particular ad.
// ---------------------------------------------------------------------------

export const TrailIntentSchema = z.enum([
  "candidate_ad_funding", // "who paid for the ads about X?"  -> sponsors that ran ads, their targeting of X, and who funds each sponsor
  "candidate_spender", // "who is spending against X?"      -> Schedule E spenders for/against X
  "committee_funding", // "who funds Y?"                     -> Y's receipts, hop by hop, and where the trail ends
]);

/** A displayed dollar amount with the record it was read from. */
export const FigureSchema = z.object({
  amount: z.number(),
  source_url: z.string().url(),
});

/** A platform-reported spend or impressions range (Google buckets). Never added to FEC dollars. */
export const RangeFigureSchema = z.object({
  min: z.number(),
  max: z.number().nullable(), // null = open-ended top bucket
  source_url: z.string().url(),
});

/** Dollars moved from `from` to `to` (Schedule A receipt or committee-to-committee transfer). */
export const TrailMoneyEdgeSchema = z.object({
  kind: z.literal("money"),
  from_id: z.string(),
  from_name: z.string(),
  from_kind: EntityKindSchema,
  from_committee_type: CommitteeTypeSchema.nullable(),
  to_id: z.string(),
  to_name: z.string(),
  amount: z.number(),
  visibility: VisibilitySchema, // of `from`: whether its own funding is on file
  depth: z.number().int().min(1), // 1 = gave directly to the subject committee; 2 = gave to a depth-1 funder; ...
  contributor_count: z.number().int().optional(), // aggregate "other contributors" nodes
  source_url: z.string().url(),
});

/** An independent expenditure: the spender's own for/against declaration about a candidate. No money reaches the candidate. */
export const TrailTargetingEdgeSchema = z.object({
  kind: z.literal("targeting"),
  spender_id: z.string(),
  spender_name: z.string(),
  spender_type_label: z.string(),
  candidate_id: z.string(),
  candidate_name: z.string(),
  support_oppose: SupportOpposeSchema,
  amount: z.number(),
  has_chain: z.boolean(),
  source_url: z.string().url(),
});

/** Ads a sponsor ran, as a platform library reports them. Not an edge: the platform does not record who paid the platform or which candidate an ad is about. */
export const TrailAdRunSchema = z.object({
  sponsor_id: z.string(),
  sponsor_name: z.string(),
  platform: z.enum(["google", "meta"]),
  ad_count: z.number().int().min(1),
  spend: RangeFigureSchema, // per-ad buckets summed; max null if any ad's top bucket is open
  first_shown: z.string().nullable(),
  last_shown: z.string().nullable(),
  match_confidence: z.enum(["verified", "auto"]), // how the advertiser name was tied to the FEC committee
  source_url: z.string().url(), // platform advertiser page
});

/** Where a committee's traced receipts stopped (chain summary), with the receipts they were computed from. */
export const TrailSharesSchema = z.object({
  total_in: z.number(),
  disclosed: z.number().min(0).max(1),
  inferable: z.number().min(0).max(1),
  unwalked: z.number().min(0).max(1),
  dark: z.number().min(0).max(1),
  max_depth: z.number().int(),
  source_url: z.string().url(), // the committee's Schedule A on fec.gov; the walk's method is on the chain page
});

/** A named source the backward walk ended at, and the committee it gave to. */
export const TrailTerminusSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: EntityKindSchema,
  organization_class: OrganizationClassSchema.optional(),
  visibility: VisibilitySchema,
  gave_to_id: z.string(),
  gave_to_name: z.string(),
  amount: z.number(), // what it gave to `gave_to`, per that committee's Schedule A
  depth: z.number().int().min(1),
  source_url: z.string().url(),
});

export const TrailSubjectSchema = z.object({
  id: z.string(), // candidate id or committee id
  kind: z.enum(["candidate", "committee"]),
  name: z.string(),
  aliases: z.array(z.string()), // lower-cased match strings the client parser accepts for this subject
  type_label: z.string().nullable(), // committee type label; null for candidates
  principal_committee_id: z.string().nullable(), // candidates only
});

const answerBase = {
  subject_id: z.string(),
  subject_name: z.string(),
  headline: z.string(), // one plain-English sentence, numbers included, adjacency language only
  caveats: z.array(z.string()), // every assumption the reader needs, in order
};

export const CandidateSpenderAnswerSchema = z.object({
  ...answerBase,
  intent: z.literal("candidate_spender"),
  candidate_id: z.string(),
  support: FigureSchema,
  oppose: FigureSchema,
  total: FigureSchema,
  spenders: z.array(TrailTargetingEdgeSchema), // largest first
});

export const AdSponsorTrailSchema = z.object({
  sponsor_id: z.string(),
  sponsor_name: z.string(),
  sponsor_type_label: z.string(),
  is_candidate_committee: z.boolean(), // the candidate's own principal committee
  ads: TrailAdRunSchema,
  targeting: TrailTargetingEdgeSchema.nullable(), // the sponsor's Schedule E about this candidate; null for the candidate's own committee
  funded_by: z.array(TrailMoneyEdgeSchema), // depth-1 money edges into the sponsor, largest first
  shares: TrailSharesSchema.nullable(),
  campaign_receipts: z
    .object({
      receipts: FigureSchema,
      from_individuals: FigureSchema,
      from_committees: FigureSchema,
    })
    .nullable(), // candidate committees only (FEC candidate summary)
});

export const CandidateAdFundingAnswerSchema = z.object({
  ...answerBase,
  intent: z.literal("candidate_ad_funding"),
  candidate_id: z.string(),
  sponsors: z.array(AdSponsorTrailSchema), // candidate's own committee first, then by Schedule E dollars about the candidate
  spenders_without_ads: z.number().int(), // Schedule E spenders about this candidate with no ads in the library
});

export const CommitteeFundingAnswerSchema = z.object({
  ...answerBase,
  intent: z.literal("committee_funding"),
  committee_id: z.string(),
  committee_type_label: z.string().nullable(),
  committee_source_url: z.string().url(),
  total_in: FigureSchema,
  funders: z.array(TrailMoneyEdgeSchema), // depth 1, largest first
  next_hop: z.array(TrailMoneyEdgeSchema), // depth 2: who funded the largest depth-1 committees
  ultimate: z.array(TrailTerminusSchema), // largest named people / organizations the walk ended at
  shares: TrailSharesSchema.nullable(), // null when no chain was walked (entity inflows only)
  spent_on: z.array(TrailTargetingEdgeSchema), // this committee's Schedule E in the race; shown apart from the money
});

export const TrailAnswerSchema = z.discriminatedUnion("intent", [
  CandidateSpenderAnswerSchema,
  CandidateAdFundingAnswerSchema,
  CommitteeFundingAnswerSchema,
]);

export const TrailsSchema = z.object({
  race_id: z.string(),
  generated_at: z.string(),
  data_status: DataStatusSchema,
  subjects: z.array(TrailSubjectSchema),
  answers: z.array(TrailAnswerSchema),
  examples: z.array(z.string()), // questions the parser is known to resolve, for the empty state
  method: z.string(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
export type TrailIntent = z.infer<typeof TrailIntentSchema>;
export type Figure = z.infer<typeof FigureSchema>;
export type RangeFigure = z.infer<typeof RangeFigureSchema>;
export type TrailMoneyEdge = z.infer<typeof TrailMoneyEdgeSchema>;
export type TrailTargetingEdge = z.infer<typeof TrailTargetingEdgeSchema>;
export type TrailAdRun = z.infer<typeof TrailAdRunSchema>;
export type TrailShares = z.infer<typeof TrailSharesSchema>;
export type TrailTerminus = z.infer<typeof TrailTerminusSchema>;
export type TrailSubject = z.infer<typeof TrailSubjectSchema>;
export type CandidateSpenderAnswer = z.infer<typeof CandidateSpenderAnswerSchema>;
export type AdSponsorTrail = z.infer<typeof AdSponsorTrailSchema>;
export type CandidateAdFundingAnswer = z.infer<typeof CandidateAdFundingAnswerSchema>;
export type CommitteeFundingAnswer = z.infer<typeof CommitteeFundingAnswerSchema>;
export type TrailAnswer = z.infer<typeof TrailAnswerSchema>;
export type Trails = z.infer<typeof TrailsSchema>;

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
  "trails.json": TrailsSchema,
} as const;
