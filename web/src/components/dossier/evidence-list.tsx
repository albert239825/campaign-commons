import { EVIDENCE_KINDS, type Evidence, type EvidenceKind } from "@citizen-gotham/contracts";
import { date } from "@/lib/format";
import { Chip, SourceLink } from "@/components/ui";

const KIND_LABEL: Record<EvidenceKind, string> = {
  roll_call_vote: "roll call",
  sponsored_bill: "sponsored bill",
  cosponsored_bill: "cosponsored bill",
  stated_position: "stated position",
  curated_statement: "statement",
};

/** Contract order is the evidence hierarchy: revealed preference (votes, bills) before stated preference. */
const RANK: Record<EvidenceKind, number> = Object.fromEntries(EVIDENCE_KINDS.map((k, i) => [k, i])) as Record<EvidenceKind, number>;

export function sortEvidence(evidence: Evidence[]): Evidence[] {
  return evidence.slice().sort((a, b) => RANK[a.kind] - RANK[b.kind] || (b.date ?? "").localeCompare(a.date ?? ""));
}

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <ol className="divide-y divide-neutral-100">
      {sortEvidence(evidence).map((ev, i) => (
        <li key={i} className="grid gap-x-4 gap-y-1 py-2 text-sm sm:grid-cols-[7.5rem_1fr_auto]">
          <div className="flex flex-col items-start gap-1">
            <Chip tone={ev.kind === "roll_call_vote" || ev.kind === "sponsored_bill" || ev.kind === "cosponsored_bill" ? "neutral" : "muted"}>
              {KIND_LABEL[ev.kind]}
            </Chip>
            {ev.vote && (
              <span className="text-xs tabular-nums text-neutral-700">
                Voted <span className="font-semibold">{ev.vote}</span>
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-medium leading-snug">{ev.title}</div>
            <div className="mt-0.5 text-xs text-neutral-500">
              {[
                ev.date ? date(ev.date) : null,
                ev.bill_id,
                ev.congress ? `${ev.congress}th Congress` : null,
                ev.roll_number ? `roll call #${ev.roll_number}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {ev.description && <p className="mt-1 text-xs leading-relaxed text-neutral-600">{ev.description}</p>}
          </div>
          <div className="sm:text-right">
            <SourceLink href={ev.url} label={ev.source_label} />
          </div>
        </li>
      ))}
    </ol>
  );
}
