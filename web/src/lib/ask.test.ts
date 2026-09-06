import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TrailsSchema, type TrailSubject } from "@campaign-commons/contracts";
import { canonicalQuestion, detectIssue, detectIntent, detectQualifier, matchSubjects, normalize, resolveQuestion, resolveRoute, titleCase } from "./ask";

const casey: TrailSubject = { id: "S1", kind: "candidate", name: "Bob Casey", aliases: ["bob casey", "casey"], type_label: null, principal_committee_id: "C1" };
const mccormick: TrailSubject = { id: "S2", kind: "candidate", name: "Dave McCormick", aliases: ["dave mccormick", "mccormick"], type_label: null, principal_committee_id: null };
const caseyCmte: TrailSubject = {
  id: "C1",
  kind: "committee",
  name: "BOB CASEY FOR SENATE INC",
  aliases: ["bob casey for senate inc", "bob casey for senate", "c1"],
  type_label: "Candidate committee",
  principal_committee_id: null,
};
const winsenate: TrailSubject = { id: "C2", kind: "committee", name: "WINSENATE", aliases: ["winsenate", "c2"], type_label: "Super PAC", principal_committee_id: null };
const afp: TrailSubject = {
  id: "C3",
  kind: "committee",
  name: "AMERICANS FOR PROSPERITY ACTION, INC. (AFP ACTION)",
  aliases: ["americans for prosperity action inc afp action", "americans for prosperity action inc", "afp action", "americans for prosperity action", "c3"],
  type_label: "Super PAC",
  principal_committee_id: null,
};
const subjects = [casey, mccormick, caseyCmte, winsenate, afp];
const examples = ["Who funds Winsenate?"];

const answer = (q: string) => {
  const r = resolveQuestion(q, subjects, examples);
  if (r.kind !== "answer") throw new Error(`expected answer for "${q}", got ${r.reason}: ${r.message}`);
  return r;
};
const refusal = (q: string) => {
  const r = resolveQuestion(q, subjects, examples);
  if (r.kind !== "unsupported") throw new Error(`expected refusal for "${q}", got ${r.intent}/${r.subject.id}`);
  return r;
};

describe("normalize", () => {
  it("lower-cases, drops possessives and punctuation, collapses spaces", () => {
    expect(normalize("  Who   funds Casey's  campaign?! ")).toBe("who funds casey campaign");
    expect(normalize("Americans for Prosperity Action, Inc. (AFP Action)")).toBe("americans for prosperity action inc afp action");
  });
});

describe("detectIntent", () => {
  it("ads beat stance words, stance words beat funding words", () => {
    expect(detectIntent(normalize("Who paid for the ads against Casey?"))).toBe("candidate_ad_funding");
    expect(detectIntent(normalize("Who is funding the attacks on Casey?"))).toBe("candidate_spender");
    expect(detectIntent(normalize("Who funds WinSenate?"))).toBe("committee_funding");
    expect(detectIntent(normalize("Where does WinSenate's money come from?"))).toBe("committee_funding");
  });
  it("matches whole words only", () => {
    expect(detectIntent("who is adamant about casey")).toBeNull();
    expect(detectIntent("what is madison spending")).toBe("candidate_spender");
  });
});

describe("detectIssue", () => {
  it("matches the fixed issue vocabulary in taxonomy order", () => {
    expect(detectIssue(normalize("are there ads supporting Bob Casey about abortion"))).toBe("abortion");
    expect(detectIssue(normalize("what is the climate"))).toBe("energy_climate");
    expect(detectIssue("a question about taxation")).toBeNull();
  });
});

describe("detectQualifier", () => {
  it("matches breakdown qualifiers in their fixed order", () => {
    expect(detectQualifier(normalize("largest sources of dark money behind Casey"))).toBe("dark or undisclosed money");
    expect(detectQualifier(normalize("which individuals support Casey"))).toBe("individual people");
    expect(detectQualifier(normalize("who funds WinSenate"))).toBeNull();
  });
});

describe("matchSubjects", () => {
  it("prefers the longest alias and orders by it", () => {
    const m = matchSubjects(normalize("who funds Bob Casey for Senate"), subjects);
    expect(m.map((x) => x.subject.id)).toEqual(["C1", "S1"]);
    expect(m[0].alias).toBe("bob casey for senate");
  });
  it("matches parenthetical and stripped aliases", () => {
    expect(matchSubjects("who funds afp action", subjects)[0].subject.id).toBe("C3");
    expect(matchSubjects("who funds americans for prosperity action", subjects)[0].subject.id).toBe("C3");
  });
  it("does not match inside other words", () => {
    expect(matchSubjects("who funds the caseyville pac", subjects)).toEqual([]);
  });
});

describe("resolveQuestion", () => {
  it("candidate spender", () => {
    const r = answer("Who is spending against Bob Casey?");
    expect(r.intent).toBe("candidate_spender");
    expect(r.subject.id).toBe("S1");
    expect(r.note).toBeNull();
  });
  it("refuses graph-only qualifiers before ordinary intent detection", () => {
    expect(refusal("What are the largest sources of dark money in this race supporting Bob Casey?")).toMatchObject({ reason: "beyond_page", message: "The fixed pages do not break money down by dark or undisclosed money; that needs the filings graph." });
    expect(refusal("individuals supporting Bob Casey").reason).toBe("beyond_page");
    expect(refusal("Does Elon Musk's money reach Bob Casey").reason).toBe("beyond_page");
  });
  it("candidate ad funding", () => {
    const r = answer("who paid for the ads about mccormick");
    expect(r.intent).toBe("candidate_ad_funding");
    expect(r.subject.id).toBe("S2");
  });
  it("routes issue questions before ordinary intent words", () => {
    const r = answer("Please help me find out if there are any ads that are support Bob Casey that are supporting abortion?");
    expect(r).toMatchObject({ intent: "spender_issue", subject: casey, issueId: "abortion" });
    expect(answer("who is spending against casey on guns")).toMatchObject({ intent: "spender_issue", issueId: "guns" });
    expect(answer("Who paid for the ads about Bob Casey?")).toMatchObject({ intent: "candidate_ad_funding", issueId: null });
  });
  it("refuses issue questions about committees", () => {
    const r = refusal("where does winsenate stand on abortion");
    expect(r.reason).toBe("wrong_kind");
    expect(r.message).toContain("not for one committee");
    expect(r.suggestions).toEqual([canonicalQuestion("committee_funding", winsenate)]);
  });
  it("committee funding", () => {
    const r = answer("Who funds WinSenate?");
    expect(r.intent).toBe("committee_funding");
    expect(r.subject.id).toBe("C2");
  });
  it("keeps individual donor questions for committees on the funding page", () => {
    expect(answer("which individuals fund WinSenate")).toMatchObject({ intent: "committee_funding", subject: winsenate });
  });
  it("committee id is an alias", () => {
    expect(answer("who is behind C2").subject.id).toBe("C2");
  });
  it("a committee with no intent words defaults to funding", () => {
    expect(answer("WinSenate").intent).toBe("committee_funding");
  });
  it("intent words inside the subject's own name are ignored", () => {
    const ie: TrailSubject = { ...winsenate, id: "C4", name: "MAKE THE ROAD ACTION INDEPENDENT EXPENDITURE COMMITTEE", aliases: ["make the road action independent expenditure committee", "c4"] };
    const r = resolveQuestion("Who funds Make the Road Action Independent Expenditure Committee?", [...subjects, ie]);
    expect(r.kind).toBe("answer");
    if (r.kind === "answer") expect([r.intent, r.subject.id]).toEqual(["committee_funding", "C4"]);
  });
  it("the campaign committee outranks the candidate when both are named", () => {
    const r = answer("Who funds Bob Casey for Senate?");
    expect(r.subject.id).toBe("C1");
    expect(r.note).toBeNull();
  });
  it("refuses individual-donor breakdowns about a candidate", () => {
    expect(refusal("Who are Casey's donors?")).toMatchObject({ reason: "beyond_page", message: "The fixed pages do not break money down by individual people; that needs the filings graph." });
  });
  it("a funding question about a candidate with no committee on the ledger is refused", () => {
    const r = refusal("Who funds McCormick?");
    expect(r.reason).toBe("wrong_kind");
    expect(r.suggestions).toEqual([canonicalQuestion("candidate_spender", mccormick), canonicalQuestion("candidate_ad_funding", mccormick)]);
  });
  it("spending/ad questions about a committee are refused with the funding question suggested", () => {
    const r = refusal("What did WinSenate spend?");
    expect(r.reason).toBe("wrong_kind");
    expect(r.suggestions).toEqual(["Who funds Winsenate?"]);
  });
  it("candidate with no intent words is refused with both candidate questions", () => {
    const r = refusal("Tell me about Casey");
    expect(r.reason).toBe("no_intent");
    expect(r.suggestions).toHaveLength(3);
  });
  it("unknown subject is refused with the race's examples", () => {
    const r = refusal("Who funds the Sierra Club?");
    expect(r.reason).toBe("no_subject");
    expect(r.suggestions).toEqual(examples);
  });
  it("two distinct subjects are refused as ambiguous", () => {
    const r = refusal("Did WinSenate spend against Casey?");
    expect(r.reason).toBe("ambiguous_subject");
    expect(r.message).toContain("WINSENATE");
    expect(r.message).toContain("Bob Casey");
  });
  it("empty input", () => {
    expect(refusal("   ").reason).toBe("empty");
  });
  it("is deterministic", () => {
    const q = "who is spending for or against casey";
    expect(resolveQuestion(q, subjects)).toEqual(resolveQuestion(q, [...subjects].reverse()));
  });
});

describe("canonicalQuestion / titleCase", () => {
  it("title-cases all-caps committee names and keeps acronyms", () => {
    expect(titleCase("SENATE LEADERSHIP FUND")).toBe("Senate Leadership Fund");
    expect(titleCase("KEYSTONE RENEWAL PAC")).toBe("Keystone Renewal PAC");
    expect(titleCase("Bob Casey")).toBe("Bob Casey");
    expect(canonicalQuestion("committee_funding", winsenate)).toBe("Who funds Winsenate?");
    expect(canonicalQuestion("candidate_ad_funding", casey)).toBe("Who paid for the ads about Bob Casey?");
    expect(canonicalQuestion("spender_issue", casey, "abortion")).toBe("Where do the groups spending for or against Bob Casey stand on abortion & reproductive rights?");
    expect(resolveRoute("spender_issue", casey, subjects, "casey", null)).toMatchObject({ intent: "candidate_spender", issueId: null });
  });
});

describe("against the generated pa-sen-2024 trails.json", () => {
  const file = join(process.cwd(), "..", "data", "out", "pa-sen-2024", "trails.json");
  it.skipIf(!existsSync(file))("every example question and every canonical question resolves to an existing answer", () => {
    const trails = TrailsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    const keys = new Set(trails.answers.map((a) => `${a.intent}/${a.subject_id}`));
    for (const q of trails.examples) {
      const r = resolveQuestion(q, trails.subjects, trails.examples);
      expect(r.kind, q).toBe("answer");
      if (r.kind === "answer") expect(keys.has(`${r.intent}/${r.subject.id}`), q).toBe(true);
    }
    for (const a of trails.answers) {
      const subject = trails.subjects.find((s) => s.id === a.subject_id)!;
      const q = canonicalQuestion(a.intent, subject);
      const r = resolveQuestion(q, trails.subjects);
      expect(r.kind, q).toBe("answer");
      if (r.kind === "answer") {
        expect(r.intent, q).toBe(a.intent);
        expect(r.subject.id, q).toBe(a.subject_id);
      }
    }
  });
});
