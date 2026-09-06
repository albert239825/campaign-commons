// OWNER: Frontend B (candidate stances).
import Link from "next/link";
import { DetailHeader } from "@/components/ui/detail-layout";
import { ISSUES, type Dossier, type IssueId } from "@campaign-commons/contracts";
import { getAds, getDossier, getRace, getStories, listDossierIds, listRaceIds } from "@/lib/data";
import { date, routes } from "@/lib/format";
import { AdjacencyNote, Breadcrumbs, Chip, DataStatusBanner, SourceLink } from "@/components/ui";
import { PartyTag } from "@/components/ui/party-tag";
import { RaceNav } from "@/components/ui/race-nav";
import { IssueSection } from "@/components/dossier/issue-section";
import { IssueTabs } from "@/components/dossier/issue-tabs";

export const generateStaticParams = () => listRaceIds().map((raceId) => ({ raceId }));

const BASIS: Record<Dossier["evidence_basis"], string> = {
  record: "Congressional record: roll-call votes and sponsored bills.",
  statements: "No congressional record. The candidate's own published statements.",
  mixed: "Congressional record plus the candidate's published statements.",
};

const BASIS_SHORT: Record<Dossier["evidence_basis"], string> = {
  record: "record-based",
  statements: "statements-based",
  mixed: "record and statements",
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

const worst = (statuses: Dossier["data_status"][]): Dossier["data_status"] =>
  statuses.includes("mock") ? "mock" : statuses.includes("partial") ? "partial" : "real";

export default async function StancesPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const race = getRace(raceId);
  const dossierIds = new Set(listDossierIds(raceId));
  // Race order (as on the ledger) so the columns match the rest of the site.
  const dossiers = race.candidates.filter((c) => dossierIds.has(c.candidate_id)).map((c) => getDossier(raceId, c.candidate_id));
  const byCandidate = dossiers.map((d) => ({ d, byIssue: new Map(d.stances.map((s) => [s.issue_id, s])) }));
  const covered = new Set<IssueId>(dossiers.flatMap((d) => d.stances.map((s) => s.issue_id)));
  const defaultIssue = ISSUES.find((issue) => covered.has(issue.id)) ?? ISSUES[0];
  const notes = Array.from(new Set(dossiers.map((d) => d.asymmetry_note)));
  const generated = dossiers.map((d) => d.generated_at.slice(0, 10)).sort().at(-1);

  return (
    <div className="detail-page candidate-page">
      <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { href: routes.race(raceId), label: race.label }, { label: "Stances" }]} />
      <DataStatusBanner status={worst(dossiers.map((d) => d.data_status))} />

      <DetailHeader label={`Stances · ${race.label}`} title="Where the candidates stand" actions={
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href={routes.race(raceId)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            Race ledger →
          </Link>
        </div>
      }>
        <p className="text-sm text-neutral-600">
          One issue at a time, every candidate side by side. Positions are drawn only from the structured record: each one-line position,
          coded direction and confidence traces to the evidence listed under it.
          {generated && <> Generated {date(generated)}.</>}
        </p>
      </DetailHeader>

      <RaceNav
        race={race}
        counts={{ ads: getAds(raceId).ads.length, stories: getStories(raceId).stories.length }}
        active={routes.stances(raceId)}
      />

      {dossiers.length === 0 ? (
        <p className="text-sm text-neutral-500">No candidate records have been loaded for this race yet.</p>
      ) : (
        <>
          <div className="dossier-notes stances-notes">
            {notes.map((note) => (
              <aside key={note} className="detail-callout">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Read this first</div>
                <p className="mt-1 leading-relaxed">{note}</p>
              </aside>
            ))}
            <div className="stances-candidates">
              {byCandidate.map(({ d, byIssue }) => {
                const evidenceCount = d.stances.reduce((n, s) => n + s.evidence.length, 0);
                return (
                  <section key={d.candidate_id} className="detail-summary stances-candidate" aria-label={d.name}>
                    <div className="flex items-baseline justify-between gap-4">
                      <h2 className="flex items-center gap-2">
                        <PartyTag party={d.party} />
                        {d.name}
                      </h2>
                      {d.summary_needs_review && <Chip tone="amber" title="Summary not yet checked by a human">needs review</Chip>}
                    </div>
                    <p className="mt-1 text-sm text-neutral-600">
                      {PARTY[d.party]} · {d.role} · {BASIS[d.evidence_basis]} {byIssue.size} of {ISSUES.length} issues have a record ·{" "}
                      {evidenceCount} evidence records.
                    </p>
                    <details className="stances-summary">
                      <summary>Summary</summary>
                      <p className="mt-2 text-sm leading-relaxed">{d.summary}</p>
                      <p className="mt-2 text-xs text-neutral-500">Written from the structured record only; every claim traces to an evidence record.</p>
                    </details>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <SourceLink href={d.links.fec_url} label="FEC candidate record" />
                      {d.links.congress_url && <SourceLink href={d.links.congress_url} label="congress.gov member page" />}
                      {d.links.campaign_site && <SourceLink href={d.links.campaign_site} label="campaign website" />}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          <IssueTabs
            items={ISSUES.map((issue) => ({
              id: issue.id,
              label: issue.label,
              records: byCandidate.reduce((n, { byIssue }) => n + (byIssue.get(issue.id)?.evidence.length ?? 0), 0),
            }))}
            defaultId={defaultIssue.id}
            panels={Object.fromEntries(
              ISSUES.map((issue) => [
                issue.id,
                <div key={issue.id} className="stances-issue">
                  <header className="dossier-section-header stances-issue-header">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold tracking-tight">{issue.label}</h2>
                      <p className="text-xs text-neutral-500">{issue.description}</p>
                    </div>
                  </header>
                  <div className="stances-grid">
                    {byCandidate.map(({ d, byIssue }) => (
                      <IssueSection
                        key={d.candidate_id}
                        issue={issue}
                        stance={byIssue.get(issue.id)}
                        title={
                          <span className="flex items-center gap-2">
                            <PartyTag party={d.party} />
                            {d.name}
                          </span>
                        }
                        subtitle={`${d.role} · ${BASIS_SHORT[d.evidence_basis]}`}
                      />
                    ))}
                  </div>
                </div>,
              ]),
            )}
          />
        </>
      )}

      <AdjacencyNote />
    </div>
  );
}
