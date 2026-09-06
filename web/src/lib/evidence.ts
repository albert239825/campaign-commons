import type { EvidenceBasis } from "@campaign-commons/contracts";
import type { ChipTone } from "@/components/ui";

/** One vocabulary for the evidence behind a relationship, shared by the chain graph, ad cards, vendor and issue pages. */
export const BASIS_LABELS: Record<EvidenceBasis, string> = {
  filed: "filed",
  verified: "verified by hand",
  inferred: "inferred",
};

/** One-line meaning shown next to the label so the reader never has to guess what an evidence level promises. */
export const BASIS_MEANING: Record<EvidenceBasis, string> = {
  filed: "read straight off a government filing",
  verified: "a person found a source naming both sides",
  inferred: "derived by a stated rule, not on any filing",
};

export const BASIS_TONE: Record<EvidenceBasis, ChipTone> = {
  filed: "neutral",
  verified: "green",
  inferred: "amber",
};

/** SVG stroke dash for an edge drawn on this evidence: solid (filed, verified) / dashed (inferred). Co-occurrence is never an edge. */
export const BASIS_DASH: Record<EvidenceBasis, string | undefined> = {
  filed: undefined,
  verified: undefined,
  inferred: "7 4",
};
