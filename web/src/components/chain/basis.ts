import type { Basis, EvidenceBasis } from "@campaign-commons/contracts";

/** Compact wire form of a Basis: [basis, rule, source_urls]. checked_by/at stay server-side. */
export type BasisWire = [EvidenceBasis, string, string[]];

export const toBasisWire = (b: Basis | undefined | null): BasisWire | null =>
  b ? [b.basis, b.rule, b.source_urls] : null;

export const BASIS_LABELS: Record<EvidenceBasis, string> = {
  filed: "filed",
  verified: "verified by hand",
  inferred: "inferred",
  adjacent: "adjacent (dates overlap)",
};

/** One-line meaning shown next to the label so the reader never has to guess what an evidence level promises. */
export const BASIS_MEANING: Record<EvidenceBasis, string> = {
  filed: "read straight off a government filing",
  verified: "a person found a source naming both sides",
  inferred: "derived by a stated rule, not on any filing",
  adjacent: "co-occurrence only — no record links the two",
};

/** SVG stroke dash for an edge drawn on this evidence: solid / dashed / dotted. */
export const BASIS_DASH: Record<EvidenceBasis, string | undefined> = {
  filed: undefined,
  verified: undefined,
  inferred: "7 4",
  adjacent: "2 4",
};
