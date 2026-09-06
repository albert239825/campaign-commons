// OWNER: Frontend B (candidate dossier).
import Link from "next/link";
import { DetailHeader } from "@/components/ui/detail-layout";
import { notFound } from "next/navigation";
import { ISSUES, type Dossier, type IssueId } from "@campaign-commons/contracts";
import { getAds, getDossier, getRace, getStories, listDossierIds, listRaceIds } from "@/lib/data";
import { date, routes } from "@/lib/format";
import { AdjacencyNote, Breadcrumbs, Chip, DataStatusBanner, SourceLink } from "@/components/ui";
import { RaceNav } from "@/components/ui/race-nav";
import { CompareLink } from "@/components/dossier/compare-link";
import { IssueSection } from "@/components/dossier/issue-section";
import { IssueTabs } from "@/components/dossier/issue-tabs";

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
  const defaultIssue = ISSUES.find((issue) => covered.has(issue.id)) ?? ISSUES[0];

  return (
    <div className="detail-page candidate-page">
      <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { href: routes.race(raceId), label: race.label }, { label: d.name }]} />
      <DataStatusBanner status={d.data_status} />

      <DetailHeader label={`Candidate profile · ${race.label}`} title={d.name} actions={
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={routes.race(raceId)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
              Race ledger →
            </Link>
            {others.map((c) => (
              <CompareLink key={c.candidate_id} href={routes.candidate(raceId, c.candidate_id)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
                Compare: {c.name} →
              </CompareLink>
            ))}
          </div>
      }>
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

      <RaceNav
        race={race}
        counts={{ ads: getAds(raceId).ads.length, stories: getStories(raceId).stories.length }}
        active={routes.candidate(raceId, candidateId)}
      />

      <div className="dossier-notes">
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
      </div>

      <IssueTabs
        items={ISSUES.map((issue) => ({ id: issue.id, label: issue.label, records: byIssue.get(issue.id)?.evidence.length ?? 0 }))}
        defaultId={defaultIssue.id}
        panels={Object.fromEntries(ISSUES.map((issue) => [issue.id, <IssueSection key={issue.id} issue={issue} stance={byIssue.get(issue.id)} />]))}
      />

      <AdjacencyNote />
    </div>
  );
}
