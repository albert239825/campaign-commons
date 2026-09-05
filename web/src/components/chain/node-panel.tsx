"use client";

import Link from "next/link";
import {
  COMMITTEE_TYPE_LABELS,
  VISIBILITY_COLORS,
  VISIBILITY_LABELS,
} from "@citizen-gotham/contracts";
import { money } from "@/lib/format";
import { BASIS_LABELS, BASIS_MEANING, type BasisWire } from "./basis";
import { terminusLabel } from "./terminus";
import type { ViewEdge, ViewNode, VisibleNode } from "./view";

/** An edge touching the selected node, with the far end resolved. */
export type IncidentEdge = {
  edge: ViewEdge;
  other: ViewNode;
  direction: "in" | "out";
};

export type PanelActions = {
  onClose: () => void;
  /** Funding side: show / fold every source of this node. Null when the node has no sources. */
  onToggleSources: (() => void) | null;
  /** Spending side: collapse / expand what hangs off this node. Null when nothing does. */
  onToggleChildren: (() => void) | null;
  onHide: () => void;
};

const MEDIUM_LABELS: Record<NonNullable<ViewNode["medium"]>, string> = {
  tv: "TV / cable",
  radio: "radio",
  digital: "digital",
  mail: "mail",
  phones: "phones / text",
  production: "production",
  consulting: "consulting / research",
  other: "other",
};

export function kindLabel(n: ViewNode): string {
  switch (n.kind) {
    case "vendor":
      return n.medium ? `Vendor · ${MEDIUM_LABELS[n.medium]}` : "Vendor";
    case "ad":
      return "Ad (Google Ads Transparency)";
    case "candidate":
      return "Candidate";
    case "aggregate":
      return n.side === "out"
        ? "Smaller ads, folded"
        : "Smaller sources, folded";
    case "individual":
      return "Individual donor";
    case "organization":
      return "Non-committee organization";
    default:
      return n.committee_type
        ? COMMITTEE_TYPE_LABELS[n.committee_type]
        : "Committee";
  }
}

function BasisLine({ basis, prefix }: { basis: BasisWire; prefix?: string }) {
  const [kind, rule, urls] = basis;
  return (
    <div className="text-xs text-neutral-700">
      {prefix && <span className="text-neutral-500">{prefix} </span>}
      <span
        className={`font-medium ${kind === "verified" ? "text-emerald-800" : kind === "filed" ? "text-neutral-900" : "text-amber-900"}`}
      >
        {BASIS_LABELS[kind]}
      </span>
      <span className="text-neutral-500"> — {BASIS_MEANING[kind]}.</span> {rule}
      {urls.length > 0 && (
        <span className="ml-1">
          {urls.slice(0, 3).map((u, i) => (
            <a
              key={u}
              href={u}
              target="_blank"
              rel="noreferrer"
              className="ml-1 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
            >
              source{urls.length > 1 ? ` ${i + 1}` : ""} ↗
            </a>
          ))}
        </span>
      )}
    </div>
  );
}

function EdgeLine({ ie, self }: { ie: IncidentEdge; self: ViewNode }) {
  const { edge, other, direction } = ie;
  const verb =
    edge.kind === "money"
      ? direction === "in"
        ? "received from"
        : "paid to"
      : edge.kind === "placement"
        ? (direction === "in" ? other : self).kind === "vendor"
          ? direction === "in"
            ? "placed / produced by"
            : "placed / produced"
          : direction === "in"
            ? "sponsored by"
            : "sponsored"
        : direction === "in"
          ? "targeted by"
          : edge.support_oppose === "S"
            ? "supports"
            : edge.support_oppose === "O"
              ? "opposes"
              : "targets";
  const amount =
    edge.kind === "money"
      ? money(edge.amount, { compact: false })
      : edge.kind === "targeting"
        ? `${money(edge.amount, { compact: false })} in independent expenditures — no dollars reach the candidate`
        : self.kind === "ad" || other.kind === "ad"
          ? `${money(edge.amount)} est. ad spend (range midpoint)`
          : money(edge.amount);
  return (
    <li className="space-y-0.5">
      <div className="text-sm">
        <span className="text-neutral-500">{verb}</span>{" "}
        <span className="font-medium">{other.name}</span>
        <span className="ml-2 tabular-nums text-neutral-700">{amount}</span>
        {edge.kind === "money" && (
          <span className="ml-2 text-xs text-neutral-500">
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
              style={{ backgroundColor: VISIBILITY_COLORS[edge.visibility] }}
            />
            {VISIBILITY_LABELS[edge.visibility]} · {edge.count}{" "}
            {edge.count === 1 ? "transaction" : "transactions"}
          </span>
        )}
      </div>
      {edge.basis && <BasisLine basis={edge.basis} prefix="Evidence:" />}
    </li>
  );
}

function ActionButton({
  onClick,
  children,
  tone = "neutral",
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-sm border px-2 py-1 text-xs font-medium hover:bg-neutral-50 ${tone === "danger" ? "border-red-200 text-red-900" : "border-neutral-300 text-neutral-800"}`}
    >
      {children}
    </button>
  );
}

/**
 * Vertex-style detail panel for the selected node: the basics per node type, the evidence behind every derived
 * relationship touching it, the page / record links, and the expand / collapse / hide controls.
 */
export function NodePanel({
  node,
  incident,
  isRoot,
  actions,
}: {
  node: VisibleNode;
  incident: IncidentEdge[];
  isRoot: boolean;
  actions: PanelActions;
}) {
  const term = terminusLabel(node);
  const inEdges = incident.filter((e) => e.direction === "in");
  const outEdges = incident.filter((e) => e.direction === "out");
  const amountLabel =
    node.kind === "vendor"
      ? "Paid by the spender (Schedule E)"
      : node.kind === "ad"
        ? "Estimated spend (Google range midpoint)"
        : node.kind === "candidate"
          ? "Independent expenditures aimed at this candidate"
          : node.side === "out"
            ? "Estimated spend"
            : isRoot
              ? "Receipts traced"
              : "Dollars flowing toward the spender";
  const sourcesLabel =
    node.state === "leaf" || node.side === "out"
      ? null
      : node.state === "full" && node.userOpened
        ? "Fold sources"
        : node.state === "full"
          ? "Fold sources"
          : "Show all sources";
  const childrenLabel =
    node.children === 0
      ? null
      : node.state === "closed" && node.side === "out"
        ? `Expand ${node.children} downstream`
        : isRoot
          ? "Collapse spending side"
          : "Collapse downstream";
  return (
    <aside
      className="rounded-lg border border-neutral-300 bg-white p-3 shadow-sm"
      aria-label={`Details for ${node.name}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        {node.kind === "ad" &&
          (node.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- static file under public/, size unknown
            <img
              src={node.thumbnail}
              alt={node.name}
              className="h-20 w-32 flex-none rounded-sm border border-neutral-200 object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex h-20 w-32 flex-none items-center justify-center rounded-sm bg-neutral-100 text-[10px] uppercase text-neutral-500">
              no creative cached
            </span>
          ))}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">
            {kindLabel(node)}
            {isRoot && " · the spender"}
          </div>
          <div className="text-base font-semibold leading-tight">
            {node.name}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
            <span className="tabular-nums font-medium">
              {money(node.amount_in, { compact: false })}
            </span>
            <span className="text-xs text-neutral-500">{amountLabel}</span>
            {node.side === "in" && (
              <span className="text-xs text-neutral-500">
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                  style={{
                    backgroundColor: VISIBILITY_COLORS[node.visibility],
                  }}
                />
                {VISIBILITY_LABELS[node.visibility]}
              </span>
            )}
            {term && <span className="text-xs text-neutral-600">{term}</span>}
          </div>
          {node.basis && (
            <div className="mt-1">
              <BasisLine
                basis={node.basis}
                prefix="How this number was arrived at:"
              />
            </div>
          )}
          {node.kind === "candidate" && (
            <p className="mt-1 text-xs text-neutral-600">
              Targeting edges show whose independent expenditures named this
              candidate. None of that money goes to the candidate.
            </p>
          )}
          {node.kind === "aggregate" && node.folded > 0 && (
            <p className="mt-1 text-xs text-neutral-600">
              {node.folded} smaller sources folded into this node in the
              picture.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={actions.onClose}
          className="text-neutral-500 hover:text-neutral-900"
          aria-label="Close details"
        >
          ✕
        </button>
      </div>

      {(inEdges.length > 0 || outEdges.length > 0) && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {inEdges.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                {node.side === "out" ? "Upstream" : "Sources drawn"}
              </div>
              <ul className="space-y-1.5">
                {inEdges.slice(0, 8).map((ie) => (
                  <EdgeLine
                    key={`${ie.edge.from}|${ie.edge.kind}`}
                    ie={ie}
                    self={node}
                  />
                ))}
                {inEdges.length > 8 && (
                  <li className="text-xs text-neutral-500">
                    … {inEdges.length - 8} more in the table below
                  </li>
                )}
              </ul>
            </div>
          )}
          {outEdges.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                {node.side === "out" || isRoot ? "Downstream" : "Gave to"}
              </div>
              <ul className="space-y-1.5">
                {outEdges.slice(0, 8).map((ie) => (
                  <EdgeLine
                    key={`${ie.edge.to}|${ie.edge.kind}`}
                    ie={ie}
                    self={node}
                  />
                ))}
                {outEdges.length > 8 && (
                  <li className="text-xs text-neutral-500">
                    … {outEdges.length - 8} more in the table below
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-2">
        {sourcesLabel && actions.onToggleSources && (
          <ActionButton onClick={actions.onToggleSources}>
            {sourcesLabel}
          </ActionButton>
        )}
        {childrenLabel && actions.onToggleChildren && (
          <ActionButton onClick={actions.onToggleChildren}>
            {childrenLabel}
          </ActionButton>
        )}
        {!isRoot && (
          <ActionButton onClick={actions.onHide} tone="danger">
            Hide from picture
          </ActionButton>
        )}
        <span className="ml-auto flex flex-wrap gap-3 text-xs">
          {node.href && node.href.startsWith("/") ? (
            <Link
              href={node.href}
              className="font-medium text-neutral-900 underline underline-offset-2"
            >
              {node.kind === "ad"
                ? "Open in ad gallery"
                : node.kind === "candidate"
                  ? "Open dossier"
                  : node.kind === "vendor"
                    ? "Open vendor page"
                    : "Open full page"}{" "}
              →
            </Link>
          ) : (
            node.href && (
              <a
                href={node.href}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted underline-offset-2"
              >
                {node.kind === "ad" ? "ad library record" : "FEC record"} ↗
              </a>
            )
          )}
          {node.record && (
            <a
              href={node.record}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-2"
            >
              {node.kind === "ad" ? "ad library record" : "FEC record"} ↗
            </a>
          )}
        </span>
      </div>
    </aside>
  );
}
