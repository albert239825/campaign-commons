import type { CommitteeType, FlagId, Visibility } from "./schemas";

/** Visibility colors. Shared by web + any generated charts. */
export const VISIBILITY_COLORS: Record<Visibility, string> = {
  disclosed: "#1D9E75",
  inferable: "#EF9F27",
  dark: "#E24B4A",
};

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  disclosed: "Disclosed (FEC)",
  inferable: "Inferable (IRS 990, lagged)",
  dark: "Dark (no disclosure)",
};

/** Targeting edges (independent expenditures) are not money edges; render neutral. */
export const TARGETING_COLOR = "#73726c";

/** Dollars that stopped at an FEC committee the walk did not read: neither disclosed nor dark, so neutral grey. */
export const UNWALKED_COLOR = TARGETING_COLOR;
export const UNWALKED_LABEL = "Not walked (FEC committee, receipts outside this race's neighborhood)";

export const COMMITTEE_TYPE_LABELS: Record<CommitteeType, string> = {
  H: "House campaign",
  S: "Senate campaign",
  P: "Presidential campaign",
  X: "Party committee (non-qualified)",
  Y: "Party committee",
  Z: "National party non-federal account",
  N: "PAC (non-qualified)",
  Q: "PAC",
  O: "Super PAC",
  U: "Single-candidate IE committee",
  V: "Hybrid PAC (non-qualified)",
  W: "Hybrid PAC",
  D: "Delegate committee",
  E: "Electioneering communication",
  I: "Independent expenditor (non-committee)",
  C: "Communication cost",
};

export const FLAG_LABELS: Record<FlagId, string> = {
  popup: "Pop-up committee",
  single_transfer_funded: "Funded by a single source",
  shell_cluster: "Shares address/agent with other entities",
  dead_end_dark: "Chain dead-ends in undisclosed source",
  one_way_valve_violation: "Super PAC → candidate transfer (check)",
  transfer_mismatch: "Sender/receiver filings disagree",
};

/** Statutory contribution limits, 2023–24 cycle. https://www.fec.gov/help-candidates-and-committees/candidate-taking-receipts/contribution-limits/ */
export const LIMITS_2024 = {
  individual_to_candidate_per_election: 3300,
  individual_to_pac_per_year: 5000,
  individual_to_national_party_per_year: 41300,
  pac_to_candidate_per_election: 5000,
  pac_to_national_party_per_year: 15000,
  super_pac_receipts: "unlimited",
} as const;
