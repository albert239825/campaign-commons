import type { ISSUES, Stance } from "@citizen-gotham/contracts";
import { Chip, type ChipTone } from "@/components/ui";
import { EvidenceList } from "./evidence-list";

const CONFIDENCE_TONE: Record<Stance["confidence"], ChipTone> = { high: "green", medium: "amber", low: "muted" };

export function IssueSection({ issue, stance }: { issue: (typeof ISSUES)[number]; stance: Stance | undefined }) {
  return (
    <section id={issue.id} className="issue-record scroll-mt-20 rounded-lg border border-neutral-200 bg-white p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold tracking-tight">{issue.label}</h2>
        <span className="text-xs text-neutral-500">{issue.description}</span>
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
              {stance.needs_review && <Chip tone="amber" title="Position and evidence not yet checked by a human">needs review</Chip>}
            </div>
          </div>
          <div className="mt-3 border-t border-neutral-100 pt-1">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              Evidence · {stance.evidence.length} {stance.evidence.length === 1 ? "record" : "records"}
            </div>
            <EvidenceList evidence={stance.evidence} />
          </div>
        </>
      )}
    </section>
  );
}
