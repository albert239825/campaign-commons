import { VISIBILITY_LABELS } from "@campaign-commons/contracts";
import { money } from "@/lib/format";
import { MEDIUM_LABELS } from "@/components/vendors/medium";
import { BASIS_LABELS } from "./basis";
import { pathSet, type NavGraph } from "./graph-nav";
import { isRootNode } from "./label";
import { kindLabel } from "./node-panel";

/** Mid-sentence form of a label: lowercase the leading letter, keep acronyms such as FEC. */
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * What the live region says when the keyboard cursor lands on a node: the node, its kind, the dollars on its largest
 * edge (one edge, one record — never a sum along the route), what is drawn behind it, and how much of the picture is
 * lit. Records language only: "gave to", "paid", "aimed at"; independent expenditures are never money to a candidate.
 */
export function announceNode(g: NavGraph, id: string): string {
  const n = g.nodes.get(id);
  if (!n) return "";
  const named = (nid: string) => g.nodes.get(nid)?.name ?? nid;
  const upstream = g.upstream.get(id) ?? [];
  const downstream = g.downstream.get(id) ?? [];
  const lit = pathSet(g, id);
  const litNote = `${lit.edges.size} ${lit.edges.size === 1 ? "edge" : "edges"} lit`;

  if (isRootNode(n)) {
    const sources = upstream.filter((e) => e.kind === "money").length;
    const vendors = downstream.filter((e) => e.kind === "money").length;
    return [
      `${n.name}, the spender this page is about`,
      `${money(n.amount_in)} in receipts traced`,
      `${sources} ${sources === 1 ? "source" : "sources"} drawn${vendors > 0 ? `, ${vendors} ${vendors === 1 ? "vendor" : "vendors"} paid` : ""}`,
      litNote,
    ].join("; ");
  }

  if (n.kind === "candidate") {
    const arrows = upstream.filter((e) => e.kind === "targeting");
    const stance = new Set(arrows.map((e) => e.support_oppose));
    const how = stance.size === 1 && stance.has("O") ? "opposing" : stance.size === 1 && stance.has("S") ? "supporting" : "";
    return [
      `${n.name}, candidate — aimed at by ${arrows.length} ${how ? `${how} ` : ""}${arrows.length === 1 ? "ad" : "ads"}, ${money(n.amount_in)} in independent expenditures`,
      "no money reaches the candidate",
      litNote,
    ].join("; ");
  }

  if (n.kind === "ad") {
    const placed = upstream.filter((e) => e.kind === "placement");
    const aimed = downstream.filter((e) => e.kind === "targeting");
    return [
      `${n.name}, ad, ~${money(n.amount_in)} est. spend`,
      placed.length > 0
        ? `placed by ${placed.map((e) => `${named(e.from)} (${BASIS_LABELS[e.basis?.[0] ?? "filed"]})`).join(", ")}`
        : "no vendor identified in FEC records",
      aimed.length > 0 ? `aimed at ${aimed.map((e) => named(e.to)).join(", ")}` : null,
      litNote,
    ]
      .filter((s): s is string => s !== null)
      .join("; ");
  }

  if (n.kind === "vendor") {
    const paid = upstream.filter((e) => e.kind === "money");
    const placed = downstream.filter((e) => e.kind === "placement").length;
    return [
      `${n.name}, vendor${n.medium ? `, ${MEDIUM_LABELS[n.medium]}` : ""}`,
      ...paid.map((e) => `paid ${money(e.amount)} by ${named(e.from)}`),
      placed > 0 ? `${placed} ${placed === 1 ? "ad" : "ads"} placed` : null,
      litNote,
    ]
      .filter((s): s is string => s !== null)
      .join("; ");
  }

  if (n.side === "out" && n.kind === "aggregate") {
    return [`${n.name}, smaller ads folded, ~${money(n.amount_in)} est. spend`, litNote].join("; ");
  }

  // Funding side: what it gave to, what is drawn behind it.
  let best = downstream[0];
  for (const e of downstream) if (e.amount > best.amount) best = e;
  const drawn = upstream.filter((e) => g.nodes.get(e.from)?.kind !== "aggregate").length;
  const folded = upstream
    .filter((e) => g.nodes.get(e.from)?.kind === "aggregate")
    .reduce((s, e) => s + (g.nodes.get(e.from)?.folded ?? 0), 0);
  const behind =
    n.kind === "aggregate"
      ? `${n.folded > 0 ? `${n.folded} smaller sources folded` : "smaller sources rolled up"}`
      : n.state === "closed"
        ? "sources not drawn, press Enter then expand"
        : n.state === "leaf"
          ? n.terminus_reason === "dark"
            ? "dark wall, no further sources on record"
            : "no sources in the chain"
          : `${drawn} ${drawn === 1 ? "source" : "sources"} drawn${folded > 0 ? `, ${folded} folded` : ""}`;
  return [
    `${n.name}, ${lc(kindLabel(n))}`,
    best ? `gave ${money(best.amount)} to ${named(best.to)}, ${lc(VISIBILITY_LABELS[best.visibility])}` : null,
    behind,
    litNote,
  ]
    .filter((s): s is string => s !== null)
    .join("; ");
}
