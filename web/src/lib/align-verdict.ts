import type { IssueId } from "@campaign-commons/contracts";
import { directionLabel } from "./alignment";

export const VERDICTS = ["aligned", "mixed", "opposed", "no_record", "no_view"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type VerdictBasis = "record" | "model" | null;
export type AlignVerdict = {
  verdict: Verdict;
  basis: VerdictBasis;
  user: number | null;
  candidate: number | null;
  reason: string;
};

/** user: -2..2 or null (no view). Record wins over model when both are available. */
export function alignVerdict(user: number | null, record: number | undefined, model: number | null | undefined): AlignVerdict {
  const basis: VerdictBasis = record !== undefined ? "record" : typeof model === "number" ? "model" : null;
  const candidate = record ?? model ?? null;
  if (user === null) {
    return { verdict: "no_view", basis, user, candidate, reason: "Pick your view to compare." };
  }
  if (candidate === null) {
    return { verdict: "no_record", basis, user, candidate, reason: "No coded position or model-proposed direction on file." };
  }
  const d = Math.abs(user - candidate);
  const verdict: Verdict = d <= 1 ? "aligned" : d >= 3 ? "opposed" : "mixed";
  const source = basis === "record" ? "the coded record" : "the model-proposed direction (unreviewed)";
  const reason =
    verdict === "aligned"
      ? `Your view and ${source} are within one step on the axis.`
      : verdict === "opposed"
        ? `Your view and ${source} point in opposite directions on the axis.`
        : `Your view and ${source} are two steps apart on the axis.`;
  return { verdict, basis, user, candidate, reason };
}

export function USER_VIEW_LABELS(issueId: IssueId): [string, string, string, string, string] {
  return [
    directionLabel(issueId, -2),
    directionLabel(issueId, -1),
    directionLabel(issueId, 0),
    directionLabel(issueId, 1),
    directionLabel(issueId, 2),
  ];
}
