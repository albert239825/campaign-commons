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
/** Records shown before the rest fold behind a toggle; everything is in the static HTML either way. */
const OPEN = 5;

function sortEvidence(evidence: Evidence[]): Evidence[] {
  return evidence.slice().sort((a, b) => RANK[a.kind] - RANK[b.kind] || (b.date ?? "").localeCompare(a.date ?? ""));
}

function EvidenceItems({ evidence }: { evidence: Evidence[] }) {
  return (
    <>
      {evidence.map((ev, i) => (
        <li key={`${ev.url}-${i}`}>
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
              {[ev.date ? date(ev.date) : null, ev.bill_id, ev.congress ? `${ev.congress}th Congress` : null, ev.roll_number ? `roll call #${ev.roll_number}` : null]
                .filter(Boolean)
                .join(" · ")}
              {" · "}
              <SourceLink href={ev.url} label={ev.source_label} />
            </div>
            {ev.description && <p className="policies-evidence-desc">{ev.description}</p>}
          </div>
        </li>
      ))}
    </>
  );
}

/**
 * One candidate's complete stance record on one issue (D-09: hand-written, review-marked): the one-line position, the coded
 * direction, confidence and review state, and every evidence record with its source link. Nothing here is derived from who
 * spent money on the race; the funders sit below it, not behind it.
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
  const evidence = stance ? sortEvidence(stance.evidence) : [];
  const open = evidence.slice(0, OPEN);
  const folded = evidence.slice(OPEN);
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
            <Chip tone={CONFIDENCE_TONE[stance.confidence]} title="How well the evidence below supports the one-line position">
              {stance.confidence} confidence
            </Chip>
            {stance.needs_review ? (
              <Chip tone="amber" title="Position and evidence not yet checked by a human">
                needs review
              </Chip>
            ) : (
              <Chip tone="green" title="Position and evidence checked by a human">
                verified
              </Chip>
            )}
          </div>
          <div className="policies-evidence-head">
            Evidence · {evidence.length} {evidence.length === 1 ? "record" : "records"}
          </div>
          {evidence.length === 0 ? (
            <p className="policies-empty">No evidence record on file for this position.</p>
          ) : (
            <>
              <ol className="policies-evidence">
                <EvidenceItems evidence={open} />
              </ol>
              {folded.length > 0 && (
                <details className="policies-evidence-more">
                  <summary>
                    <span className="policies-evidence-more-closed">Show all {evidence.length} evidence records</span>
                    <span className="policies-evidence-more-open">Showing all {evidence.length} evidence records</span>
                  </summary>
                  <ol className="policies-evidence" start={OPEN + 1}>
                    <EvidenceItems evidence={folded} />
                  </ol>
                </details>
              )}
            </>
          )}
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
