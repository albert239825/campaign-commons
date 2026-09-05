import Link from "next/link";
import type { Figure, RangeFigure, TrailMoneyEdge, TrailTargetingEdge } from "@campaign-commons/contracts";
import { Chip, Money, SourceLink, VisibilityDot } from "@/components/ui";
import { money, range, routes } from "@/lib/format";

/** A dollar figure that cannot appear without its record. */
export function Fig({ figure, label = "FEC", className = "" }: { figure: Figure; label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <Money amount={figure.amount} />
      <SourceLink href={figure.source_url} label={label} />
    </span>
  );
}

/** A platform-published range. Never summed with FEC dollars; the copy says so wherever this appears. */
export function RangeFig({ figure, label = "Google", className = "" }: { figure: RangeFigure; label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="tabular-nums">{range(figure.min, figure.max, (n) => money(n))}</span>
      <SourceLink href={figure.source_url} label={label} />
    </span>
  );
}

const KIND_LABEL: Record<TrailMoneyEdge["from_kind"], string> = {
  committee: "committee",
  individual: "individual",
  organization: "organization",
  aggregate: "many small contributors",
  conduit: "conduit (earmarked gifts)",
};

/**
 * One money edge: a filed transfer into a committee's account. Kept visually distinct from targeting rows
 * (solid left rule, dollar sign, visibility dot) so a funder never reads as having bought anything downstream.
 */
export function MoneyEdgeRow({ edge, raceId, hasPage }: { edge: TrailMoneyEdge; raceId: string; hasPage: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-l-2 border-neutral-900 py-1.5 pl-3 text-sm">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <VisibilityDot visibility={edge.visibility} className="mr-1 self-center" />
        {hasPage ? (
          <Link href={routes.entity(raceId, edge.from_id)} className="font-medium hover:underline">
            {edge.from_name}
          </Link>
        ) : (
          <span className="font-medium">{edge.from_name}</span>
        )}
        <span className="text-xs text-neutral-500">{edge.from_committee_type ?? KIND_LABEL[edge.from_kind]}</span>
        {edge.depth > 1 && <Chip tone="muted">{edge.depth === 2 ? "one hop back" : `${edge.depth} hops back`}</Chip>}
        {edge.contributor_count !== undefined && edge.contributor_count > 1 && <span className="text-xs text-neutral-500">{edge.contributor_count.toLocaleString("en-US")} gifts</span>}
      </span>
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-xs text-neutral-500">gave</span>
        <Money amount={edge.amount} />
        <span className="text-xs text-neutral-500">to {edge.to_name}</span>
        <SourceLink href={edge.source_url} label="FEC" />
      </span>
    </li>
  );
}

/**
 * One targeting edge: a Schedule E declaration by the spender about a candidate. Dashed rule, for/against
 * chip, and no dollar-sign framing toward the candidate — this money went to the spender's vendors.
 */
export function TargetingRow({ edge, raceId, hasChain, showCandidate = true }: { edge: TrailTargetingEdge; raceId: string; hasChain: boolean; showCandidate?: boolean }) {
  const oppose = edge.support_oppose === "O";
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-l-2 border-dashed border-neutral-400 py-1.5 pl-3 text-sm">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <Link href={routes.entity(raceId, edge.spender_id)} className="font-medium hover:underline">
          {edge.spender_name}
        </Link>
        <span className="text-xs text-neutral-500">{edge.spender_type_label}</span>
        {hasChain && (
          <Link href={routes.chain(raceId, edge.spender_id)} className="text-xs text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            its funders
          </Link>
        )}
      </span>
      <span className="inline-flex items-baseline gap-1.5">
        <Chip tone={oppose ? "red" : "green"}>{oppose ? "against" : "for"}</Chip>
        {showCandidate && <span className="text-xs text-neutral-500">{edge.candidate_name}</span>}
        <Money amount={edge.amount} />
        <SourceLink href={edge.source_url} label="FEC Sched. E" />
      </span>
    </li>
  );
}

export function EdgeLegend({ money: showMoney = true, targeting = true, ranges = false }: { money?: boolean; targeting?: boolean; ranges?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500">
      {showMoney && (
        <li className="flex items-center gap-2">
          <span className="inline-block h-3 w-0.5 bg-neutral-900" /> money edge — a filed transfer into a committee&apos;s account
        </li>
      )}
      {targeting && (
        <li className="flex items-center gap-2">
          <span className="inline-block h-3 w-0.5 border-l-2 border-dashed border-neutral-400" /> targeting edge — the spender&apos;s for/against declaration; no money reaches the candidate
        </li>
      )}
      {ranges && <li>ranges — Google&apos;s per-ad spend buckets, summed; never added to FEC dollars</li>}
    </ul>
  );
}

export function Caveats({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-1">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Assumptions and limits</h2>
      <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-600">
        {items.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </section>
  );
}
