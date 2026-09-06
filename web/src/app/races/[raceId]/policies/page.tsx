// OWNER: Block 3 child E (policies tab).
import Link from "next/link";
import { ISSUES, type IssueFocus, type IssueId } from "@campaign-commons/contracts";
import { DetailHeader } from "@/components/ui/detail-layout";
import { getAds, getDossier, getEntity, getLedger, getRace, getStories, hasDossier, hasEntity, listRaceIds } from "@/lib/data";
import { routes } from "@/lib/format";
import { AdjacencyNote, Breadcrumbs, DataStatusBanner } from "@/components/ui";
import { RaceNav } from "@/components/ui/race-nav";
import { PolicyTabs } from "@/components/policies/policy-tabs";
import { IssuePanel, type CandidateStance } from "@/components/policies/issue-panel";
import type { IssueFunder } from "@/components/policies/funder-row";

export const generateStaticParams = () => listRaceIds().map((raceId) => ({ raceId }));

export default async function PoliciesPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const race = getRace(raceId);
  const ledger = getLedger(raceId);
  const gallery = getAds(raceId);
  const candidateNames = Object.fromEntries(race.candidates.map((c) => [c.candidate_id, c.name]));

  const dossiers = race.candidates.map((candidate) => ({
    candidate,
    dossier: hasDossier(raceId, candidate.candidate_id) ? getDossier(raceId, candidate.candidate_id) : null,
  }));

  // Self-described focus lives on the entity record, not the ledger row; `general_partisan` rows have no issue_ids and land nowhere.
  const focused: IssueFunder[] = ledger.top_outside_spenders
    .flatMap((spender) => {
      if (!hasEntity(raceId, spender.entity_id)) return [];
      const focus: IssueFocus | undefined = getEntity(raceId, spender.entity_id).issue_focus;
      return focus && focus.issue_ids.length > 0 ? [{ spender, focus }] : [];
    })
    .sort((a, b) => b.spender.total - a.spender.total);

  const byIssue = ISSUES.map((issue) => {
    const stances: CandidateStance[] = dossiers.map(({ candidate, dossier }) => ({
      candidate,
      stance: dossier?.stances.find((s) => s.issue_id === issue.id),
      hasDossier: dossier !== null,
    }));
    const funders = focused.filter((f) => f.focus.issue_ids.includes(issue.id));
    const ads = gallery.ads.filter((a) => (a.issues?.issue_ids ?? []).includes(issue.id));
    return { issue, stances, funders, ads };
  });

  const defaultIssue: IssueId = (byIssue.find((b) => b.funders.length > 0) ?? byIssue[0]).issue.id;
  const withFocus = focused.length;
  const issuesWithFunder = byIssue.filter((b) => b.funders.length > 0).length;
  const taggedAds = gallery.ads.filter((a) => (a.issues?.issue_ids ?? []).length > 0).length;

  return (
    <div className="detail-page policies-page">
      <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { href: routes.race(raceId), label: race.label }, { label: "Policies" }]} />
      <DataStatusBanner status={ledger.data_status} />
      <DetailHeader label={race.label} title="Policies">
        <p>
          Each of the ten issues, one at a time: what the record shows each candidate holds, beside the outside spenders that describe
          themselves as focused on the same issue and what they spent for or against each candidate. Same topic is the only link
          between the two columns.
        </p>
      </DetailHeader>
      <RaceNav race={race} counts={{ ads: gallery.ads.length, stories: getStories(raceId).stories.length }} active={routes.policies(raceId)} />

      <aside className="detail-callout policies-howto" aria-label="How to read this page">
        <h2>How to read this</h2>
        <p>
          <b>Candidate stances</b> come from the dossier record: a one-line position written by a person from roll-call votes, bills and
          archived statements, each linked to its government record, with a coded direction where one exists. <b>Funder focus</b> is
          self-description: the organisation&apos;s own account of what it is for, sourced to its own material. It says what the group
          says it stands for, not what its dollars bought, and it carries no direction, so a funder appears beside a stance only
          because both name the same issue, never because it agrees with, backs or opposes that stance. The <b>support / oppose
          amounts</b> are independent expenditures reported to the FEC: spending that targets a candidate, not money that reached a
          campaign. {withFocus} of {ledger.top_outside_spenders.length} outside spenders in this race name at least one issue in their
          self-described focus, covering {issuesWithFunder} of {ISSUES.length} issues; {taggedAds} of {gallery.ads.length} ads carry an
          issue tag. Dollar totals by issue live on the <Link href={routes.race(raceId)}>ledger</Link>; that is a different layer and is
          not compared or summed here.
        </p>
      </aside>

      <PolicyTabs
        items={byIssue.map((b) => ({
          id: b.issue.id,
          label: b.issue.label,
          stances: b.stances.filter((s) => s.stance !== undefined).length,
          funders: b.funders.length,
          ads: b.ads.length,
        }))}
        defaultId={defaultIssue}
        panels={Object.fromEntries(
          byIssue.map((b) => [
            b.issue.id,
            <IssuePanel key={b.issue.id} raceId={raceId} issue={b.issue} stances={b.stances} funders={b.funders} ads={b.ads} candidateNames={candidateNames} />,
          ]),
        )}
      />

      <AdjacencyNote />
    </div>
  );
}
