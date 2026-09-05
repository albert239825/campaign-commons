import type { ChainNode, OrganizationClass } from "@citizen-gotham/contracts";

const DARK_ORG_LABELS: Record<OrganizationClass, string> = {
  nonprofit: "Advocacy nonprofit — funders not on file",
  llc: "LLC / trust — owner not on file",
  unknown: "Organization — funding not on file",
  union: "Organization — funding not on file",
  business: "Organization — funding not on file",
};

/** Plain-language reason a chain stops at this node. */
export function terminusLabel(n: Pick<ChainNode, "terminus_reason" | "kind" | "organization_class">): string | null {
  switch (n.terminus_reason) {
    case "dark":
      return n.kind === "organization" ? DARK_ORG_LABELS[n.organization_class ?? "unknown"] : "No donor disclosure required";
    case "organization":
      return n.organization_class === "union" ? "Union treasury — named source" : "Business treasury — named source";
    case "inferable":
      return "Funding reconstructable from IRS 990s (lagged)";
    case "individual":
      return "Individual donor — disclosed";
    case "pruned":
      return "Aggregated: each under 1% of receipts";
    case "cycle":
      return "Already shown elsewhere in this chain";
    case "depth_cap":
      return "FEC-registered committee — its receipts were not walked here";
    default:
      return null;
  }
}
