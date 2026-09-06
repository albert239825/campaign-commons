import { describe, expect, it } from "vitest";
import type { CandidateSpenderAnswer, Entity, TrailSubject } from "@campaign-commons/contracts";
import { buildSpenderIssueAnswer } from "./ask-issues";

const candidate: TrailSubject = {
  id: "CANDIDATE",
  kind: "candidate",
  name: "Bob Casey",
  aliases: ["casey"],
  type_label: null,
  principal_committee_id: null,
};

const spenders = [
  { spender_id: "P1", spender_name: "Plus Group", spender_type_label: "Super PAC", candidate_id: "CANDIDATE", candidate_name: "Bob Casey", support_oppose: "S", amount: 400, has_chain: false, source_url: "https://fec.example/p1" },
  { spender_id: "P2", spender_name: "Minus Group", spender_type_label: "501(c)(4)", candidate_id: "CANDIDATE", candidate_name: "Bob Casey", support_oppose: "O", amount: 300, has_chain: false, source_url: "https://fec.example/p2" },
  { spender_id: "P3", spender_name: "Neither Group", spender_type_label: "PAC", candidate_id: "CANDIDATE", candidate_name: "Bob Casey", support_oppose: "S", amount: 200, has_chain: false, source_url: "https://fec.example/p3" },
  { spender_id: "P4", spender_name: "Unknown Group", spender_type_label: "PAC", candidate_id: "CANDIDATE", candidate_name: "Bob Casey", support_oppose: "O", amount: 100, has_chain: false, source_url: "https://fec.example/p4" },
] as CandidateSpenderAnswer["spenders"];

const answer = {
  subject_id: "CANDIDATE",
  subject_name: "Bob Casey",
  headline: "",
  caveats: [],
  intent: "candidate_spender",
  candidate_id: "CANDIDATE",
  support: { amount: 400, source_url: "https://fec.example/support" },
  oppose: { amount: 400, source_url: "https://fec.example/oppose" },
  total: { amount: 800, source_url: "https://fec.example/total" },
  spenders,
  graph: null,
} as CandidateSpenderAnswer;

const entities = new Map<string, Entity>([
  [
    "P1",
    {
      issue_positions: [
        {
          issue_id: "abortion",
          direction: 2,
          quote: "We support access.",
          source_url: "https://plus.example/issues",
          basis: { basis: "verified", rule: "Checked by hand", source_urls: ["https://plus.example/issues"], checked_by: "reviewer", checked_at: "2026-01-01" },
        },
      ],
    } as unknown as Entity,
  ],
  [
    "P2",
    {
      issue_positions: [
        {
          issue_id: "abortion",
          direction: -1,
          quote: "We oppose access.",
          source_url: "https://minus.example/issues",
          basis: { basis: "inferred", rule: "Model read", source_urls: [], checked_by: null, checked_at: null },
        },
      ],
    } as unknown as Entity,
  ],
  ["P3", { issue_positions: [{ issue_id: "abortion", direction: 0, quote: "We have a nuanced view.", source_url: "https://neither.example/issues", basis: { basis: "inferred", rule: "Model read", source_urls: [], checked_by: null, checked_at: null } }] } as unknown as Entity],
]);

describe("buildSpenderIssueAnswer", () => {
  it("groups and orders stances while preserving source and position fields", () => {
    const result = buildSpenderIssueAnswer(candidate, "abortion", answer, entities, { spenders_with_positions: 3, spenders_total: 4 });
    expect(result.groups.map((group) => group.key)).toEqual(["plus", "minus", "neither", "none"]);
    expect(result.groups.map((group) => group.label)).toEqual([
      "Protect abortion access in federal law",
      "Restrict abortion access",
      "States a position on neither side",
      "No stated position found on its own site",
    ]);
    expect(result.counts).toEqual({ spenders: 4, with_position: 3, verified: 1, model: 2 });
    expect(result.headline).toBe('4 groups reported independent expenditures for or against Bob Casey. 3 of them state a position on abortion & reproductive rights on their own sites: 1 toward "Protect abortion access in federal law", 1 toward "Restrict abortion access", 1 on neither side. 1 states none we could find.');
    expect(result.caveats).toHaveLength(3);
    expect(result.groups[0].rows[0].spender.source_url).toBe("https://fec.example/p1");
    expect(result.groups[0].rows[0].position?.quote).toBe("We support access.");
  });

  it("omits the coverage caveat when coverage is unavailable", () => {
    expect(buildSpenderIssueAnswer(candidate, "abortion", answer, entities, null).caveats).toHaveLength(2);
  });
});
