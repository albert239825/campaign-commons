import Link from "next/link";
import { EVIDENCE_KINDS, ISSUE_AXES, type Evidence, type EvidenceKind, type IssueId, type RaceCandidate, type Stance } from "@campaign-commons/contracts";
import { directionLabel } from "@/lib/alignment";
import { date, routes } from "@/lib/format";
import { Chip, SourceLink, type ChipTone } from "@/components/ui";
import { PartyTag } from "@/components/ui/party-tag";

const CONFIDENCE_TONE: Record<Stance["confidence"], ChipTone> = { high: "green", medium: "amber", low: "muted" };

const KIND_LABEL: Record<EvidenceKind, string> = {
  roll_call_vote: "roll call",
  sponsored_bill: "sponsored bill",
  cosponsored_bill: "cosponsored bill",
  stated_position: "stated position",
  curated_statement: "statement",
};

/** Contract order is the evidence hierarchy: revealed preference (votes, bills) before stated preference. */
const RANK: Record<EvidenceKind, number> = Object.fromEntries(EVIDENCE_KINDS.map((k, i) => [k, i])) as Record<EvidenceKind, number>;
const SHOWN = 2;

function leadEvidence(evidence: Evidence[]): Evidence[] {
  return evidence
    .slice()
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, SHOWN);
}

/**
 * One candidate's stance on one issue, copied from the dossier record (D-09: hand-written, review-marked). Nothing here is
 * derived from who spent money on the race; the funders column sits beside it, not behind it.
 */
export function StanceCard({ raceId, candidate, issueId, stance, hasDossier }: {
  raceId: string;
  candidate: RaceCandidate;
  issueId: IssueId;
  stance: Stance | undefined;
  hasDossier: boolean;
}) {
  const dossierHref = `${routes.candidate(raceId, candidate.candidate_id)}#${issueId}`;
  const axis = ISSUE_AXES[issueId];
  return (
    <article className="policies-stance" aria-label={`${candidate.name} on this issue`}>
      <header className="policies-stance-head">
        <h4>
          {candidate.name} <PartyTag party={candidate.party} />
        </h4>
        <span className="policies-role">{candidate.incumbent ? "incumbent" : "challenger"}</span>
      </header>
      {!stance ? (
        <p className="policies-empty">No record loaded{hasDossier ? " for this issue" : ""}.</p>
      ) : (
        <>
          <p className="policies-position">{stance.position}</p>
          <div className="policies-chips">
            {stance.direction === undefined ? (
              <Chip tone="muted" title={`Human-coded against the published issue axis (${axis.minus} ↔ ${axis.plus}); this stance has no coded position`}>
                no coded position
              </Chip>
            ) : (
              <Chip tone="neutral" title={`Human-coded against the published issue axis: ${axis.minus} ↔ ${axis.plus}`}>
                {directionLabel(issueId, stance.direction)}
              </Chip>
            )}
            <Chip tone={CONFIDENCE_TONE[stance.confidence]} title="How well the evidence supports the one-line position">
              {stance.confidence} confidence
            </Chip>
            {stance.needs_review && (
              <Chip tone="amber" title="Position and evidence not yet checked by a human">
                needs review
              </Chip>
            )}
          </div>
          {stance.evidence.length > 0 && (
            <ol className="policies-evidence">
              {leadEvidence(stance.evidence).map((ev, i) => (
                <li key={i}>
                  <div>
                    <Chip tone={ev.kind === "stated_position" || ev.kind === "curated_statement" ? "muted" : "neutral"}>{KIND_LABEL[ev.kind]}</Chip>
                    {ev.vote && (
                      <span className="policies-vote">
                        Voted <b>{ev.vote}</b>
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="policies-evidence-title">{ev.title}</div>
                    <div className="policies-meta">
                      {[ev.date ? date(ev.date) : null, ev.bill_id, ev.roll_number ? `roll call #${ev.roll_number}` : null].filter(Boolean).join(" · ")}
                      {" · "}
                      <SourceLink href={ev.url} label={ev.source_label} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="policies-meta">
            {stance.evidence.length} evidence {stance.evidence.length === 1 ? "record" : "records"}
            {stance.evidence.length > SHOWN && ` · ${stance.evidence.length - SHOWN} more in the dossier`}
          </p>
        </>
      )}
      <footer className="policies-links">
        {hasDossier ? (
          <Link href={dossierHref}>Full dossier →</Link>
        ) : (
          <span className="policies-meta">No dossier loaded for this candidate.</span>
        )}
      </footer>
    </article>
  );
}
