import type { ReactNode } from "react";
import { EVIDENCE_KINDS, ISSUE_AXES, type EvidenceKind, type ISSUES, type Stance } from "@campaign-commons/contracts";
import { Chip, type ChipTone } from "@/components/ui";
import { directionLabel } from "@/lib/alignment";
import { EvidenceList } from "./evidence-list";

const CONFIDENCE_TONE: Record<Stance["confidence"], ChipTone> = { high: "green", medium: "amber", low: "muted" };
/** Mirrors `campaign_commons.dossier.record_confidence`: a count rule over the evidence, not a judgement of the position. */
const CONFIDENCE_NOTE: Record<Stance["confidence"], string> = {
  high: "Three or more roll-call votes on file.",
  medium: "One roll-call vote, two or more records, or a stated position.",
  low: "A single record and no vote.",
};
const KIND_PLURAL: Record<EvidenceKind, [string, string]> = {
  roll_call_vote: ["roll call", "roll calls"],
  sponsored_bill: ["sponsored bill", "sponsored bills"],
  cosponsored_bill: ["cosponsored bill", "cosponsored bills"],
  stated_position: ["stated position", "stated positions"],
  curated_statement: ["statement", "statements"],
};

function kindSummary(evidence: Stance["evidence"]): string {
  const counts = new Map<EvidenceKind, number>();
  for (const ev of evidence) counts.set(ev.kind, (counts.get(ev.kind) ?? 0) + 1);
  return EVIDENCE_KINDS.filter((kind) => counts.has(kind))
    .map((kind) => `${counts.get(kind)} ${KIND_PLURAL[kind][counts.get(kind) === 1 ? 0 : 1]}`)
    .join(" · ");
}

/** One issue of a dossier. `actions` is the right-hand slot in the section header (empty today). */
export function IssueSection({ issue, stance, actions }: { issue: (typeof ISSUES)[number]; stance: Stance | undefined; actions?: ReactNode }) {
  const axis = ISSUE_AXES[issue.id];
  return (
    <section id={issue.id} className="issue-record scroll-mt-20 rounded-lg border border-neutral-200 bg-white p-4">
      <header className="dossier-section-header">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{issue.label}</h2>
          <p className="text-xs text-neutral-500">{issue.description}</p>
        </div>
        {actions && <div className="dossier-section-actions">{actions}</div>}
      </header>
      {!stance ? (
        <p className="mt-3 text-sm text-neutral-400">No record loaded for this issue.</p>
      ) : (
        <>
          <div className="issue-position mt-3 flex flex-wrap items-start gap-2">
            <p className="min-w-0 flex-1 text-sm leading-relaxed">{stance.position}</p>
            <div className="flex shrink-0 gap-1">
              <Chip tone={CONFIDENCE_TONE[stance.confidence]} title="How well the evidence below supports the one-line position">
                {stance.confidence} confidence
              </Chip>
              {stance.direction === undefined ? (
                <Chip tone="muted" title="Human-coded against the published issue axis; this stance has no coded position">
                  no coded position
                </Chip>
              ) : (
                <Chip tone="neutral" title="Human-coded against the published issue axis">
                  {directionLabel(issue.id, stance.direction)}
                </Chip>
              )}
              {stance.needs_review && <Chip tone="amber" title="Position and evidence not yet checked by a human">needs review</Chip>}
            </div>
          </div>
          <dl className="dossier-stance-meta">
            <div>
              <dt>Coded position</dt>
              <dd>
                {stance.direction === undefined ? "Not coded" : directionLabel(issue.id, stance.direction)}
                <small>Axis: {axis.minus} ↔ {axis.plus}</small>
              </dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>
                {stance.confidence}
                <small>{CONFIDENCE_NOTE[stance.confidence]}</small>
              </dd>
            </div>
            <div>
              <dt>Review status</dt>
              <dd>
                {stance.needs_review ? "Needs review" : "Checked"}
                <small>{stance.needs_review ? "Position and evidence not yet checked by a human." : "Position and evidence checked by a human."}</small>
              </dd>
            </div>
          </dl>
          <div className="mt-3 border-t border-neutral-100 pt-1">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              Evidence · {stance.evidence.length} {stance.evidence.length === 1 ? "record" : "records"} · {kindSummary(stance.evidence)}
            </div>
            <EvidenceList evidence={stance.evidence} />
          </div>
        </>
      )}
    </section>
  );
}
