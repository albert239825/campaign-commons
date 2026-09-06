"use client";

import { VISIBILITY_COLORS, VISIBILITY_LABELS } from "@campaign-commons/contracts";
import { money } from "@/lib/format";
import { BASIS_MEANING } from "./basis";
import { BasisLine, kindLabel } from "./node-panel";
import type { ViewEdge, ViewNode } from "./view";

export function edgeVerb(edge: ViewEdge, from: ViewNode, to: ViewNode): string {
  if (edge.kind === "money") return to.kind === "vendor" ? "paid" : "gave to";
  if (edge.kind === "placement") return from.kind === "vendor" ? "placed / produced" : "sponsored";
  return edge.support_oppose === "S" ? "supports" : edge.support_oppose === "O" ? "opposes" : "targets";
}

/** One line: the dollars on the edge and what kind of dollars they are. Targeting dollars never reach `to`. */
export function edgeAmountLabel(edge: ViewEdge, to: ViewNode, compact = false): string {
  const amt = money(edge.amount, { compact });
  if (edge.kind === "money") return amt;
  if (edge.kind === "targeting") return `${amt} in independent expenditures — no dollars reach the candidate`;
  return to.kind === "ad" ? `${amt} est. ad spend (range midpoint) — no dollars move on this edge` : amt;
}

export const EDGE_KIND_LABELS = {
  money: "Money edge · contribution or transfer, as filed",
  placement: "Placement edge · who placed or produced the ad",
  targeting: "Targeting edge · independent expenditures aimed at a candidate",
} as const;

/**
 * Detail panel for a selected edge: both ends, the dollars and what they mean, the evidence behind the link (basis
 * rule and sources for derived edges; the filing for money edges) and a way to its row in the table.
 */
export function EdgePanel({
  edge,
  from,
  to,
  hasRow,
  onSelectNode,
  onShowRow,
  onClose,
}: {
  edge: ViewEdge;
  from: ViewNode;
  to: ViewNode;
  hasRow: boolean;
  onSelectNode: (id: string) => void;
  onShowRow: () => void;
  onClose: () => void;
}) {
  return (
    <aside
      className="rounded-lg border border-neutral-300 bg-white p-3 shadow-sm"
      aria-label={`Details for the edge from ${from.name} to ${to.name}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">{EDGE_KIND_LABELS[edge.kind]}</div>
          <div className="text-base font-semibold leading-tight">
            <button type="button" onClick={() => onSelectNode(from.id)} className="text-left hover:underline">
              {from.name}
            </button>
            <span className="mx-2 font-normal text-neutral-500">{edgeVerb(edge, from, to)}</span>
            <button type="button" onClick={() => onSelectNode(to.id)} className="text-left hover:underline">
              {to.name}
            </button>
          </div>
          <div className="mt-0.5 text-xs text-neutral-500">
            {kindLabel(from)} → {kindLabel(to)}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
            <span className="tabular-nums font-medium">{edgeAmountLabel(edge, to)}</span>
            {edge.kind === "money" && (
              <span className="text-xs text-neutral-500">
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: VISIBILITY_COLORS[edge.visibility] }}
                />
                {VISIBILITY_LABELS[edge.visibility]} · {edge.count} {edge.count === 1 ? "transaction" : "transactions"}
              </span>
            )}
          </div>
          <div className="mt-1">
            {edge.basis ? (
              <BasisLine basis={edge.basis} prefix="Evidence:" />
            ) : (
              <div className="text-xs text-neutral-700">
                <span className="text-neutral-500">Evidence: </span>
                <span className="font-medium text-neutral-900">filed</span>
                <span className="text-neutral-500"> — {BASIS_MEANING.filed}.</span>{" "}
                {edge.index >= 0
                  ? "The transactions, their dates and the FEC record are on this edge's row in the table."
                  : "Several smaller sources folded into one edge in the picture; each is its own row in the table."}
              </div>
            )}
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-900" aria-label="Close details">
          ✕
        </button>
      </div>
      {hasRow && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-2">
          <button
            type="button"
            onClick={onShowRow}
            className="rounded-sm border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
          >
            Show its row in the table ↓
          </button>
        </div>
      )}
    </aside>
  );
}
