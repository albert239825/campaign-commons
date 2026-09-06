// OWNER: Frontend B (candidate dossier).
import Link from "next/link";
import { DetailHeader } from "@/components/ui/detail-layout";
import { notFound } from "next/navigation";
import { ISSUES, type Dossier, type IssueId } from "@campaign-commons/contracts";
import { getDossier, getRace, listDossierIds, listRaceIds } from "@/lib/data";
import { date, routes } from "@/lib/format";
import { AdjacencyNote, Chip, SourceLink } from "@/components/ui";
import { IssueNav } from "@/components/dossier/issue-nav";
import { candidateSection } from "@/components/ui/race-nav";
import { RaceShell } from "@/components/ui/race-shell";
import { IssueSection } from "@/components/dossier/issue-section";

export const generateStaticParams = () =>
  listRaceIds().flatMap((raceId) => listDossierIds(raceId).map((candidateId) => ({ raceId, candidateId })));

const BASIS: Record<Dossier["evidence_basis"], string> = {
  record: "Positions are drawn from the congressional record: roll-call votes and sponsored bills.",
  statements: "No congressional record. Positions are drawn from the candidate's own published statements.",
  mixed: "Positions combine the congressional record with the candidate's published statements.",
};

const PARTY: Record<Dossier["party"], string> = {
  DEM: "Democrat",
  REP: "Republican",
  LIB: "Libertarian",
  GRE: "Green",
  IND: "Independent",
  CON: "Constitution",
  OTH: "Other",
};

export default async function DossierPage({ params }: { params: Promise<{ raceId: string; candidateId: string }> }) {
  const { raceId, candidateId } = await params;
  if (!listDossierIds(raceId).includes(candidateId)) notFound();
  const race = getRace(raceId);
  const d = getDossier(raceId, candidateId);
  const byIssue = new Map(d.stances.map((s) => [s.issue_id, s]));
  const covered = new Set<IssueId>(byIssue.keys());
  const evidenceCount = d.stances.reduce((n, s) => n + s.evidence.length, 0);
  const others = race.candidates.filter((c) => c.candidate_id !== candidateId && listDossierIds(raceId).includes(c.candidate_id));

  return (
    <RaceShell
      race={race}
      section={candidateSection(candidateId)}
      status={d.data_status}
      crumbs={[{ label: d.name }]}
      className="candidate-page"
      header={
        <DetailHeader
          label={`Candidate profile · ${race.label}`}
          title={d.name}
          actions={
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link href={routes.race(raceId)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
                Race overview →
              </Link>
              {others.map((c) => (
                <Link key={c.candidate_id} href={routes.candidate(raceId, c.candidate_id)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
                  Compare: {c.name} →
                </Link>
              ))}
            </div>
          }
        >
          <p className="detail-candidate-role">{PARTY[d.party]} · {d.role}</p>
          <p className="text-sm text-neutral-600">
            {BASIS[d.evidence_basis]} {covered.size} of {ISSUES.length} issues have a record · {evidenceCount} evidence records · generated {date(d.generated_at.slice(0, 10))}.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <SourceLink href={d.links.fec_url} label="FEC candidate record" />
            {d.links.congress_url && <SourceLink href={d.links.congress_url} label="congress.gov member page" />}
            {d.links.campaign_site && <SourceLink href={d.links.campaign_site} label="campaign website" />}
          </div>
        </DetailHeader>
      }
    >
      <aside className="detail-callout">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Read this first</div>
        <p className="mt-1 leading-relaxed">{d.asymmetry_note}</p>
      </aside>

      <section className="detail-summary">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xs uppercase tracking-wide text-neutral-500">Summary</h2>
          {d.summary_needs_review && <Chip tone="amber" title="Summary not yet checked by a human">needs review</Chip>}
        </div>
        <p className="mt-2 text-sm leading-relaxed">{d.summary}</p>
        <p className="mt-2 text-xs text-neutral-500">Written from the structured record below only; every claim traces to an evidence record.</p>
      </section>

      <div className="detail-sections">
        <div className="detail-sidebar">
          <IssueNav covered={covered} />
        </div>
        <div className="detail-content">
          {ISSUES.map((issue) => (
            <IssueSection key={issue.id} issue={issue} stance={byIssue.get(issue.id)} />
          ))}
        </div>
      </div>

      <AdjacencyNote />
    </RaceShell>
  );
}
