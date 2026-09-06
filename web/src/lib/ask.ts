/**
 * Money Trails question resolver (D-73). Pure and deterministic: a typed question becomes (intent, subject) by
 * keyword lists and whole-word alias matching over `Trails.subjects`, or a typed refusal. No model, no ranking
 * heuristics beyond "longest alias wins"; the same question always resolves the same way.
 */
import { ISSUE_BY_ID, ISSUE_IDS, type IssueId, type TrailIntent, type TrailSubject } from "@campaign-commons/contracts";

export type AskIntent = TrailIntent | "spender_issue";
export type Resolution =
  | { kind: "answer"; intent: AskIntent; subject: TrailSubject; matched: string; note: string | null; issueId: IssueId | null }
  | { kind: "unsupported"; reason: "empty" | "no_subject" | "ambiguous_subject" | "no_intent" | "wrong_kind" | "beyond_page"; message: string; suggestions: string[] };

/** Phrase lists checked in this order; the first list with a hit decides the intent. */
export const INTENT_PHRASES: Record<TrailIntent, readonly string[]> = {
  // ads first: "who paid for the ads against X" mentions both ads and a stance
  candidate_ad_funding: ["ad", "ads", "advert", "advertising", "advertisement", "advertisements", "commercial", "commercials", "youtube"],
  candidate_spender: [
    "spend",
    "spends",
    "spent",
    "spending",
    "spender",
    "spenders",
    "against",
    "attack",
    "attacks",
    "attacking",
    "oppose",
    "opposes",
    "opposing",
    "support",
    "supports",
    "supporting",
    "for or against",
    "independent expenditure",
    "independent expenditures",
    "outside money",
    "outside groups",
    "super pacs",
  ],
  committee_funding: [
    "fund",
    "funds",
    "funded",
    "funding",
    "funder",
    "funders",
    "donor",
    "donors",
    "donate",
    "donated",
    "gave",
    "gives",
    "give",
    "giving",
    "money behind",
    "behind",
    "back",
    "backs",
    "backed",
    "backer",
    "backers",
    "bankroll",
    "bankrolls",
    "bankrolled",
    "finance",
    "finances",
    "financed",
    "receipts",
    "receive",
    "receives",
    "received",
    "contributor",
    "contributors",
    "contributed",
    "where does the money come from",
    "where did the money come from",
    "money come from",
    "paying for",
    "pays for",
    "paid",
  ],
};

export const INTENT_LABELS: Record<AskIntent, string> = {
  candidate_ad_funding: "Who paid for the ads about a candidate",
  candidate_spender: "Who is spending for or against a candidate",
  committee_funding: "Who funds a committee",
  spender_issue: "Where the groups spending on a candidate stand on an issue",
};

export const ISSUE_PHRASES: Record<IssueId, readonly string[]> = {
  healthcare: ["healthcare", "health care", "medicare", "medicaid", "obamacare", "affordable care act", "drug prices", "drug pricing", "prescription drugs", "insurance coverage"],
  energy_climate: ["climate", "climate change", "clean energy", "fossil fuel", "fossil fuels", "fracking", "oil and gas", "natural gas", "emissions", "environment", "environmental", "green energy", "pipelines"],
  defense: ["defense", "military", "pentagon", "national security", "israel", "ukraine", "nato", "foreign aid", "veterans"],
  crypto_fintech: ["crypto", "cryptocurrency", "bitcoin", "blockchain", "fintech", "digital assets", "wall street", "banks", "financial regulation"],
  immigration: ["immigration", "immigrants", "border", "border security", "asylum", "deportation", "deportations", "migrants", "the wall"],
  abortion: ["abortion", "abortions", "reproductive rights", "reproductive freedom", "pro choice", "pro life", "roe", "roe v wade", "dobbs", "planned parenthood", "ivf", "contraception", "reproductive health"],
  guns: ["gun", "guns", "gun control", "gun rights", "firearm", "firearms", "second amendment", "2nd amendment", "nra", "assault weapons", "background checks"],
  tax_budget: ["tax", "taxes", "tax cuts", "tax cut", "budget", "deficit", "national debt", "spending cuts", "irs", "social security"],
  tech_ai: ["ai", "artificial intelligence", "big tech", "antitrust", "tech regulation", "section 230", "social media companies", "tiktok"],
  labor_trade: ["union", "unions", "labor", "workers rights", "right to work", "minimum wage", "tariffs", "trade deal", "trade deals", "nafta", "outsourcing", "collective bargaining"],
};

export const QUALIFIER_PHRASES: Record<string, readonly string[]> = {
  "dark or undisclosed money": ["dark money", "dark", "undisclosed", "anonymous", "hidden", "secret", "shell", "llc", "llcs", "nonprofit", "nonprofits", "501c", "501c4", "c4"],
  "individual people": ["individual", "individuals", "people", "person", "donor", "donors", "billionaire", "billionaires", "millionaire", "wealthy", "rich", "notable", "famous", "celebrity", "celebrities", "who is behind", "behind"],
  vendors: ["vendor", "vendors", "consultant", "consultants", "media buyer"],
  "money paths between entities": ["path", "reach", "reaches", "reached", "connected", "connection", "link between", "flow from", "upstream", "shared", "both", "in common"],
  "geography or sector": ["out of state", "out-of-state", "foreign", "corporate", "corporations", "companies", "union", "unions", "industry"],
};

export function normalize(q: string): string {
  return q
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPhrase(padded: string, phrase: string): boolean {
  return padded.includes(` ${phrase} `);
}

export function detectIntent(normalized: string): TrailIntent | null {
  const padded = ` ${normalized} `;
  for (const intent of ["candidate_ad_funding", "candidate_spender", "committee_funding"] as const) {
    if (INTENT_PHRASES[intent].some((p) => hasPhrase(padded, p))) return intent;
  }
  return null;
}

export function detectIssue(normalized: string): IssueId | null {
  const padded = ` ${normalized} `;
  for (const issueId of ISSUE_IDS) {
    if (ISSUE_PHRASES[issueId].some((phrase) => hasPhrase(padded, phrase))) return issueId;
  }
  return null;
}

export function detectQualifier(normalized: string): string | null {
  const padded = ` ${normalized} `;
  for (const [label, phrases] of Object.entries(QUALIFIER_PHRASES)) {
    if (phrases.some((phrase) => hasPhrase(padded, phrase))) return label;
  }
  return null;
}

export type SubjectMatch = { subject: TrailSubject; alias: string };

export function stripSubjectAlias(normalized: string, alias: string): string {
  return ` ${normalized} `.replace(` ${alias} `, " ").trim();
}

export function beyondPageResolution(subject: TrailSubject, label: string): Extract<Resolution, { kind: "unsupported" }> {
  const suggestions =
    subject.kind === "committee"
      ? [canonicalQuestion("committee_funding", subject)]
      : [canonicalQuestion("candidate_spender", subject), canonicalQuestion("candidate_ad_funding", subject), canonicalQuestion("spender_issue", subject, "abortion")];
  return {
    kind: "unsupported",
    reason: "beyond_page",
    message: `The fixed pages do not break money down by ${label}; that needs the filings graph.`,
    suggestions,
  };
}

/** All subjects whose alias appears as whole words in the question, longest alias first. */
export function matchSubjects(normalized: string, subjects: readonly TrailSubject[]): SubjectMatch[] {
  const padded = ` ${normalized} `;
  const hits: SubjectMatch[] = [];
  for (const subject of subjects) {
    let best: string | null = null;
    for (const alias of subject.aliases) {
      if (hasPhrase(padded, alias) && (best === null || alias.length > best.length)) best = alias;
    }
    if (best !== null) hits.push({ subject, alias: best });
  }
  return hits.sort((a, b) => b.alias.length - a.alias.length || a.subject.id.localeCompare(b.subject.id));
}

export function resolveQuestion(question: string, subjects: readonly TrailSubject[], examples: readonly string[] = []): Resolution {
  const normalized = normalize(question);
  if (normalized.length === 0) {
    return { kind: "unsupported", reason: "empty", message: "Type a question about this race.", suggestions: [...examples] };
  }

  const matches = matchSubjects(normalized, subjects);
  if (matches.length === 0) {
    return {
      kind: "unsupported",
      reason: "no_subject",
      message: "No candidate or committee from this race is named in the question. Use a name as it appears on the ledger.",
      suggestions: [...examples],
    };
  }
  const top = matches[0];
  // A longer alias that contains the shorter one is one mention, not two ("bob casey for senate" contains "casey").
  const rivals = matches.filter((m) => m.subject.id !== top.subject.id && !top.alias.includes(m.alias));
  if (rivals.length > 0) {
    const names = [top, ...rivals].map((m) => m.subject.name);
    return {
      kind: "unsupported",
      reason: "ambiguous_subject",
      message: `The question names more than one subject (${names.join(", ")}). Ask about one at a time.`,
      suggestions: [top, ...rivals].map((m) => canonicalQuestion(defaultIntent(m.subject), m.subject)),
    };
  }

  const subject = top.subject;
  // Intent words inside the subject's own name ("... Independent Expenditure Committee", "... Fund") are not the question's.
  const stripped = stripSubjectAlias(normalized, top.alias);
  const issue = detectIssue(stripped);
  if (issue !== null) return resolveRoute("spender_issue", subject, subjects, top.alias, issue);
  const detectedIntent = detectIntent(stripped);
  const qualifier = detectQualifier(stripped);
  if (!(subject.kind === "committee" && qualifier === "individual people" && detectedIntent === "committee_funding") && qualifier !== null) {
    return beyondPageResolution(subject, qualifier);
  }
  let intent = detectedIntent;
  if (intent === null) {
    if (subject.kind === "committee") intent = "committee_funding";
    else {
      return {
        kind: "unsupported",
        reason: "no_intent",
        message: `Three questions are supported about ${subject.name}: who is spending for or against them, who paid for the ads about them, and where those groups stand on an issue.`,
        suggestions: [canonicalQuestion("candidate_spender", subject), canonicalQuestion("candidate_ad_funding", subject), canonicalQuestion("spender_issue", subject, "abortion")],
      };
    }
  }

  return resolveRoute(intent, subject, subjects, top.alias);
}

/**
 * The kind rules for an already-selected (intent, subject), with no text matching involved: a funding question about a
 * candidate is read as one about their principal committee (with a note), and a spending/ad question about a committee
 * is refused with the supported question suggested. `matched` records how the subject was picked (an alias, or its id).
 */
export function resolveRoute(intent: AskIntent, subject: TrailSubject, subjects: readonly TrailSubject[], matched: string = subject.id, issueId: IssueId | null = null): Resolution {
  if (intent === "spender_issue") {
    if (issueId === null) intent = "candidate_spender";
    else if (subject.kind === "committee") {
      return {
        kind: "unsupported",
        reason: "wrong_kind",
        message: `Issue positions are answered for the groups spending for or against a candidate, not for one committee. For ${subject.name}, the supported question is who funds it; its own stated positions, if any, are on its record page.`,
        suggestions: [canonicalQuestion("committee_funding", subject)],
      };
    } else {
      return { kind: "answer", intent: "spender_issue", subject, matched, note: null, issueId };
    }
  }
  if (intent === "committee_funding" && subject.kind === "candidate") {
    if (subject.principal_committee_id === null) {
      return {
        kind: "unsupported",
        reason: "wrong_kind",
        message: `${subject.name} has no principal committee on file for this race, so the funding question cannot be answered.`,
        suggestions: [canonicalQuestion("candidate_spender", subject), canonicalQuestion("candidate_ad_funding", subject)],
      };
    }
    const committee = subjects.find((s) => s.id === subject.principal_committee_id);
    if (!committee) {
      return {
        kind: "unsupported",
        reason: "wrong_kind",
        message: `${subject.name}'s campaign committee is not in this race's ledger, so the funding question cannot be answered.`,
        suggestions: [canonicalQuestion("candidate_spender", subject), canonicalQuestion("candidate_ad_funding", subject)],
      };
    }
    return {
      kind: "answer",
      intent,
      subject: committee,
      matched,
      note: `Read as a question about ${subject.name}'s campaign committee, ${committee.name}. Outside groups' money never reaches a candidate; for that, ask who is spending for or against ${subject.name}.`,
      issueId: null,
    };
  }
  if (intent !== "committee_funding" && subject.kind === "committee") {
    return {
      kind: "unsupported",
      reason: "wrong_kind",
      message: `Spending and ad questions are answered for candidates, not committees. For ${subject.name}, the supported question is who funds it (its own spending is listed on that answer).`,
      suggestions: [canonicalQuestion("committee_funding", subject)],
    };
  }
  return { kind: "answer", intent, subject, matched, note: null, issueId: null };
}

export function defaultIntent(subject: TrailSubject): TrailIntent {
  return subject.kind === "committee" ? "committee_funding" : "candidate_spender";
}

export function canonicalQuestion(intent: AskIntent, subject: TrailSubject, issueId: IssueId | null = null): string {
  const name = subject.kind === "committee" ? titleCase(subject.name) : subject.name;
  switch (intent) {
    case "candidate_spender":
      return `Who is spending for or against ${name}?`;
    case "candidate_ad_funding":
      return `Who paid for the ads about ${name}?`;
    case "committee_funding":
      return `Who funds ${name}?`;
    case "spender_issue":
      return issueId === null ? `Who is spending for or against ${name}?` : `Where do the groups spending for or against ${name} stand on ${ISSUE_BY_ID[issueId].label.toLowerCase()}?`;
  }
}

export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Pac|Llc|Inc|Dscc|Nrsc|Smp|Afp|Cva|Dba|Usa|Us|Pa|Ii|Iii)\b/g, (m) => m.toUpperCase())
    .replace(/\b(Of|For|The|And|To|A|In)\b/g, (m) => m.toLowerCase());
}

export const INTENTS: readonly TrailIntent[] = ["candidate_ad_funding", "candidate_spender", "committee_funding"];
export const isIntent = (s: string): s is TrailIntent => (INTENTS as readonly string[]).includes(s);
export const ASK_INTENTS = [...INTENTS, "spender_issue"] as const;
export const isAskIntent = (s: string): s is AskIntent => (ASK_INTENTS as readonly string[]).includes(s);
