import type { FocusKind } from "@campaign-commons/contracts";

/** Labels for a spender's self-described focus kind (Layer A). About the spender, never about its dollars. */
export const FOCUS_KIND_LABELS: Record<FocusKind, string> = {
  general_partisan: "General partisan / leadership committee",
  candidate_aligned: "Single-candidate vehicle",
  business_trade: "Business / trade association",
  labor: "Labor union",
  single_issue: "Single-issue group",
  multi_issue: "Multi-issue advocacy group",
};

/** Kinds whose bucket is the kind itself (issue_id null); shown before the issue-named kinds. */
export const NON_ISSUE_KIND_ORDER: FocusKind[] = ["general_partisan", "candidate_aligned", "business_trade", "labor"];
