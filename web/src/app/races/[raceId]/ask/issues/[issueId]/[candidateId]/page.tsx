// OWNER: Money Trails (D-73).
import Link from "next/link";
import { notFound } from "next/navigation";
import { ISSUE_BY_ID, ISSUE_IDS, type IssueId } from "@campaign-commons/contracts";
import { getRace, hasTrails, getTrails, listEntityIds, listRaceIds } from "@/lib/data";
import { canonicalQuestion, INTENT_LABELS } from "@/lib/ask";
import { getSpenderIssueAnswer } from "@/lib/ask-issues";
import { routes } from "@/lib/format";
import { Breadcrumbs, Card, DataStatusBanner } from "@/components/ui";
import { DetailHeader } from "@/components/ui/detail-layout";
import { AskBox } from "@/components/ask/ask-box";
import { AskMethod } from "@/components/ask/method";
import { IssueAnswerView } from "@/components/ask/issue-answer";

export const generateStaticParams = () =>
  listRaceIds()
    .filter(hasTrails)
    .flatMap((raceId) => {
      const trails = getTrails(raceId);
      return trails.answers
        .filter((answer) => answer.intent === "candidate_spender")
        .flatMap((answer) => ISSUE_IDS.map((issueId) => ({ raceId, issueId, candidateId: answer.candidate_id })));
    });

export default async function IssueAnswerPage({ params }: { params: Promise<{ raceId: string; issueId: string; candidateId: string }> }) {
  const { raceId, issueId, candidateId } = await params;
  const race = getRace(raceId);
  if (!hasTrails(raceId) || !(ISSUE_IDS as readonly string[]).includes(issueId)) notFound();
  const typedIssueId = issueId as IssueId;
  const trails = getTrails(raceId);
  const answer = getSpenderIssueAnswer(raceId, candidateId, typedIssueId);
  const subject = trails.subjects.find((candidate) => candidate.id === candidateId && candidate.kind === "candidate");
  if (!answer || !subject) notFound();
  const question = canonicalQuestion("spender_issue", subject, typedIssueId);
  const entityIds = new Set(listEntityIds(raceId));
  const related = trails.answers.filter((trailAnswer) => trailAnswer.subject_id === candidateId && trailAnswer.intent !== "candidate_spender");

  return (
    <div className="detail-page ask-page">
      <div>
        <Breadcrumbs
          items={[
            { href: routes.home(), label: "Races" },
            { href: routes.race(raceId), label: race.label },
            { href: routes.ask(raceId), label: "Money Trails" },
            { label: INTENT_LABELS.spender_issue },
          ]}
        />
        <DataStatusBanner status={trails.data_status} />
        <DetailHeader
          label={`Money Trails · ${race.label}`}
          title={question}
          actions={
            <div>
              <Link href={routes.candidate(raceId, subject.id)}>Candidate profile →</Link>
              <Link href={routes.ask(raceId)}>Ask another question →</Link>
            </div>
          }
        >
          <p className="max-w-3xl text-lg leading-snug text-neutral-900">{answer.headline}</p>
        </DetailHeader>
      </div>

      <div className="detail-sections">
        <aside className="detail-sidebar">
          <nav className="detail-section-nav" aria-label={`Other questions about ${subject.name}`}>
            <p>Also about {subject.name}</p>
            <ul>
              {related.map((trailAnswer) => (
                <li key={trailAnswer.intent}>
                  <Link href={routes.answer(raceId, trailAnswer.intent, trailAnswer.subject_id)}>{INTENT_LABELS[trailAnswer.intent]}</Link>
                </li>
              ))}
              <li>
                <span>Same question, other issues</span>
                <ul>
                  {ISSUE_IDS.filter((otherIssue) => otherIssue !== typedIssueId).map((otherIssue) => (
                    <li key={otherIssue}>
                      <Link href={routes.issueAnswer(raceId, otherIssue, subject.id)}>{ISSUE_BY_ID[otherIssue].label}</Link>
                    </li>
                  ))}
                </ul>
              </li>
              <li>
                <Link href={routes.ask(raceId)}>
                  All questions<small>for this race</small>
                </Link>
              </li>
            </ul>
          </nav>
        </aside>
        <div className="detail-content">
          <Card>
            <AskBox raceId={raceId} subjects={trails.subjects} examples={trails.examples} initial={question} />
          </Card>
          <IssueAnswerView answer={answer} raceId={raceId} entityIds={entityIds} />
        </div>
      </div>

      <AskMethod dataMethod={trails.method} />
    </div>
  );
}
