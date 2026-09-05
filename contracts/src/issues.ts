/**
 * The Issue Taxonomy — the spine of Campaign Commons.
 *
 * FROZEN for the hackathon. Every stance, bill, vote, donor industry, and ad tags
 * against exactly these IDs. Do not add/rename without updating docs/DECISIONS.md.
 */
export const ISSUES = [
  {
    id: "healthcare",
    label: "Health care",
    description: "ACA, Medicare/Medicaid, drug pricing, hospitals, insurers.",
  },
  {
    id: "energy_climate",
    label: "Energy & climate",
    description: "Oil & gas, fracking, pipelines, renewables, EPA rules, climate policy.",
  },
  {
    id: "defense",
    label: "Defense & national security",
    description: "Defense budget, contractors, foreign military aid, veterans.",
  },
  {
    id: "crypto_fintech",
    label: "Crypto & financial regulation",
    description: "Digital assets, banks, securities regulation, consumer finance.",
  },
  {
    id: "immigration",
    label: "Immigration & border",
    description: "Border security, asylum, visas, enforcement.",
  },
  {
    id: "abortion",
    label: "Abortion & reproductive rights",
    description: "Abortion access, contraception, IVF, related federal policy.",
  },
  {
    id: "guns",
    label: "Guns",
    description: "Firearms regulation, background checks, manufacturer liability.",
  },
  {
    id: "tax_budget",
    label: "Taxes & budget",
    description: "Tax code, deficits, appropriations, debt ceiling.",
  },
  {
    id: "tech_ai",
    label: "Tech, AI & antitrust",
    description: "Big Tech regulation, AI policy, privacy, antitrust, Section 230.",
  },
  {
    id: "labor_trade",
    label: "Labor & trade",
    description: "Unions, minimum wage, tariffs, trade agreements, manufacturing.",
  },
] as const;

export type IssueId = (typeof ISSUES)[number]["id"];
export const ISSUE_IDS = ISSUES.map((i) => i.id) as [IssueId, ...IssueId[]];
export const ISSUE_BY_ID: Record<IssueId, (typeof ISSUES)[number]> = Object.fromEntries(
  ISSUES.map((i) => [i.id, i]),
) as Record<IssueId, (typeof ISSUES)[number]>;
