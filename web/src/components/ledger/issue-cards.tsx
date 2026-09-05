"use client";
// Block 2 — issue focus. Two layers that are never summed:
//   Layer B (left)  what tagged ads / IE notices were ABOUT — attributable to those records' dollars.
//   Layer A (right) what the SPENDERS say they are for — about the spender, never about its dollars.
import Link from "next/link";
import { useState } from "react";
import {
  ISSUE_BY_ID,
  type AdIssueSpending,
  type IssueSpending,
  type RaceCandidate,
  type SpenderFocusSpending,
} from "@citizen-gotham/contracts";
import { money, pct, routes } from "@/lib/format";
import { Card, Money } from "@/components/ui";
import { FOCUS_KIND_LABELS, NON_ISSUE_KIND_ORDER } from "@/components/issues/focus-kind";

const AD_COLOR = "#a3a3a3"; // Google ad midpoint (a range estimate)
const IE_COLOR = "#1f2937"; // FEC IE dollars (filed)

type SpenderName = { entity_id: string; name: string };

export function IssueCards({
  raceId,
  issues,
  candidates,
  spenders,
}: {
  raceId: string;
  issues: IssueSpending;
  candidates: RaceCandidate[];
  spenders: SpenderName[];
}) {
  const candidateName = (id: string) => candidates.find((c) => c.candidate_id === id)?.name ?? id;
  const spenderName = new Map(spenders.map((s) => [s.entity_id, s.name]));
  return (
    <section className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <AdIssueCard raceId={raceId} issues={issues} candidateName={candidateName} />
        <SpenderFocusCard raceId={raceId} issues={issues} spenderName={spenderName} />
      </div>
      <p className="rounded-md border border-dashed border-neutral-400 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
        These two cards are different layers and are not comparable or summable. The left card attributes dollars to what a specific ad
        or filed notice was about. The right card groups spenders by how they describe themselves — it says who the spenders are, not
        what their dollars were spent on.
      </p>
      {issues.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-neutral-500">
          {issues.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-sm bg-neutral-100">
      {max > 0 && value > 0 && <div className="h-full" style={{ width: `${(value / max) * 100}%`, backgroundColor: color }} />}
    </div>
  );
}

function AdIssueCard({
  raceId,
  issues,
  candidateName,
}: {
  raceId: string;
  issues: IssueSpending;
  candidateName: (id: string) => string;
}) {
  const c = issues.coverage;
  const rows = [...issues.by_ad_issue].sort((a, b) => b.spend_midpoint + b.ie_amount - (a.spend_midpoint + a.ie_amount));
  const maxAd = Math.max(0, ...rows.map((r) => r.spend_midpoint));
  const maxIe = Math.max(0, ...rows.map((r) => r.ie_amount));
  return (
    <Card title="Outside spending by issue — what the ads and notices were about">
      <p className="mb-3 text-xs text-neutral-500">
        {c.ads_tagged} of {c.ads_total} ads and {c.ies_tagged} independent-expenditure notices ({money(c.ie_dollars_tagged)}) tagged by a
        person from the creative or the filed notice. Google reports ad spend as a range; the midpoint is shown. Ad midpoints and FEC
        dollars are two different measures and are never added together.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No ad or notice has been tagged to an issue yet. Nothing is inferred from spender names.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <AdIssueRow key={r.issue_id} raceId={raceId} r={r} maxAd={maxAd} maxIe={maxIe} candidateName={candidateName} />
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-600">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: AD_COLOR }} /> Google ads · midpoint of reported range
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: IE_COLOR }} /> FEC independent expenditures · filed amount
        </span>
      </div>
    </Card>
  );
}

function AdIssueRow({
  raceId,
  r,
  maxAd,
  maxIe,
  candidateName,
}: {
  raceId: string;
  r: AdIssueSpending;
  maxAd: number;
  maxIe: number;
  candidateName: (id: string) => string;
}) {
  const issue = ISSUE_BY_ID[r.issue_id];
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <Link href={`${routes.ads(raceId)}?issue=${r.issue_id}`} className="font-medium hover:underline" title={issue.description}>
          {issue.label}
        </Link>
        <span className="text-xs text-neutral-500">
          {r.ad_count} ad{r.ad_count === 1 ? "" : "s"} · {r.ie_count} notice{r.ie_count === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-0.5 text-xs tabular-nums">
        <Bar value={r.spend_midpoint} max={maxAd} color={AD_COLOR} />
        <span title={`Range ${money(r.spend_min, { compact: false })}–${money(r.spend_max, { compact: false })}`}>
          ads ≈ <Money amount={r.spend_midpoint} />
        </span>
        <Bar value={r.ie_amount} max={maxIe} color={IE_COLOR} />
        <span>
          IEs <Money amount={r.ie_amount} />
        </span>
      </div>
      {r.by_candidate.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-600">
          {r.by_candidate.map((bc) => (
            <span key={`${bc.candidate_id}-${bc.support_oppose}`}>
              {bc.support_oppose === "S" ? "for" : "against"} {candidateName(bc.candidate_id)}: ads ≈ {money(bc.spend_midpoint)} · IEs{" "}
              {money(bc.ie_amount)}
            </span>
          ))}
        </div>
      )}
      <div className="mt-0.5 text-[11px] text-neutral-500" title={r.basis.rule}>
        {r.basis.basis}
        {r.basis.basis === "verified" && (
          <>
            {" "}
            · {r.basis.checked_by} · {r.basis.source_urls.length} source{r.basis.source_urls.length === 1 ? "" : "s"}
          </>
        )}{" "}
        · {r.basis.rule}
      </div>
    </li>
  );
}

const bucketLabel = (b: SpenderFocusSpending) =>
  b.issue_id ? `${ISSUE_BY_ID[b.issue_id].label} (${FOCUS_KIND_LABELS[b.kind].toLowerCase()})` : FOCUS_KIND_LABELS[b.kind];

const sortBuckets = (rows: SpenderFocusSpending[]) =>
  [...rows].sort((a, b) => {
    const ai = a.issue_id === null ? NON_ISSUE_KIND_ORDER.indexOf(a.kind) : NON_ISSUE_KIND_ORDER.length;
    const bi = b.issue_id === null ? NON_ISSUE_KIND_ORDER.indexOf(b.kind) : NON_ISSUE_KIND_ORDER.length;
    return ai !== bi ? ai - bi : b.amount - a.amount;
  });

function SpenderFocusCard({
  raceId,
  issues,
  spenderName,
}: {
  raceId: string;
  issues: IssueSpending;
  spenderName: Map<string, string>;
}) {
  const [primaryOnly, setPrimaryOnly] = useState(true);
  const c = issues.coverage;
  const rows = sortBuckets(issues.by_spender_focus.filter((b) => b.primary_only === primaryOnly));
  const max = Math.max(0, ...rows.map((r) => r.amount));
  const total = c.dollars_total;
  const generalPartisan = rows.find((r) => r.kind === "general_partisan" && r.issue_id === null);
  return (
    <Card
      title="Spenders' self-described focus"
      action={
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <input type="checkbox" checked={primaryOnly} onChange={(e) => setPrimaryOnly(e.target.checked)} />
          primary focus only
        </label>
      }
    >
      <p className="mb-3 text-xs text-neutral-500">
        {c.spenders_tagged} of {c.spenders_total} outside spenders ({money(c.dollars_tagged)} of {money(total)}) have a focus read by a
        person from the organisation&apos;s own site or filing. This groups spenders, not dollars: a spender&apos;s outside total counts
        under how it describes itself, whatever its ads were about.
        {primaryOnly
          ? " Each spender appears once, under its primary focus."
          : " A spender naming several issues appears under each of them, so rows overlap."}
      </p>
      {generalPartisan && (
        <p className="mb-3 text-sm">
          <span className="font-medium">General partisan / leadership committees — name no issue:</span> <Money amount={generalPartisan.amount} />{" "}
          <span className="text-neutral-500">({total > 0 ? pct(generalPartisan.amount / total) : "—"} of outside spending)</span>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No spender has a sourced self-description yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((b) => (
            <li key={`${b.kind}:${b.issue_id ?? "-"}`}>
              <details className="group">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">
                      <span className="mr-1 inline-block text-neutral-400 group-open:rotate-90">▸</span>
                      {bucketLabel(b)}
                    </span>
                    <span className="tabular-nums">
                      <Money amount={b.amount} />
                      <span className="ml-1 text-xs text-neutral-500">{total > 0 ? pct(b.amount / total) : "—"}</span>
                    </span>
                  </div>
                  <Bar value={b.amount} max={max} color={IE_COLOR} />
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-neutral-600">
                    <span>
                      {b.spender_ids.length} spender{b.spender_ids.length === 1 ? "" : "s"}
                    </span>
                    <span title="Dollar-weighted traceability score over these spenders' funding chains">
                      traceability {b.traceability_score === null ? "—" : pct(b.traceability_score)}
                    </span>
                    <span title="Dollar-weighted share of these spenders' funding that stops at a layer with no disclosure obligation">
                      dark {b.dark_share === null ? "—" : pct(b.dark_share)}
                    </span>
                  </div>
                </summary>
                <div className="mt-1.5 border-l-2 border-neutral-200 pl-3 text-xs">
                  <p className="mb-1 text-neutral-600">
                    Spenders who describe themselves as {b.issue_id ? `focused on ${ISSUE_BY_ID[b.issue_id].label.toLowerCase()}` : FOCUS_KIND_LABELS[b.kind].toLowerCase()}{" "}
                    account for <Money amount={b.amount} /> of outside spending in this race.
                  </p>
                  <ul className="space-y-0.5">
                    {b.spender_ids.map((id) => (
                      <li key={id}>
                        <Link href={routes.entity(raceId, id)} className="hover:underline">
                          {spenderName.get(id) ?? id}
                        </Link>
                        <span className="ml-1 text-neutral-400">own words + source on the entity page →</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
