import type { Basis, EvidenceBasis } from "@campaign-commons/contracts";

export { BASIS_DASH, BASIS_LABELS, BASIS_MEANING } from "@/lib/evidence";

/** Compact wire form of a Basis: [basis, rule, source_urls]. checked_by/at stay server-side. */
export type BasisWire = [EvidenceBasis, string, string[]];

export const toBasisWire = (b: Basis | undefined | null): BasisWire | null =>
  b ? [b.basis, b.rule, b.source_urls] : null;
