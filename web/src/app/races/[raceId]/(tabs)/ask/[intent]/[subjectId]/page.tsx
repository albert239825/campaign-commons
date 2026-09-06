// OWNER: Money Trails (D-73).
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRace, getTrails, hasTrails, listChainIds, listEntityIds, listRaceIds } from "@/lib/data";
import { routes } from "@/lib/format";
import { canonicalQuestion, INTENT_LABELS, isIntent } from "@/lib/ask";
import { Breadcrumbs, Card } from "@/components/ui";
import { DetailHeader } from "@/components/ui/detail-layout";
import { AskBox } from "@/components/ask/ask-box";
import { AskMethod } from "@/components/ask/method";
import { Headline, TrailAnswerView } from "@/components/ask/answer";

export const generateStaticParams = () =>
  listRaceIds()
    .filter(hasTrails)
    .flatMap((raceId) => getTrails(raceId).answers.map((a) => ({ raceId, intent: a.intent, subjectId: a.subject_id })));

export default async function AnswerPage({ params }: { params: Promise<{ raceId: string; intent: string; subjectId: string }> }) {
  const { raceId, intent, subjectId } = await params;
  const race = getRace(raceId);
  if (!hasTrails(raceId) || !isIntent(intent)) notFound();
  const trails = getTrails(raceId);
  const answer = trails.answers.find((a) => a.intent === intent && a.subject_id === subjectId);
  const subject = trails.subjects.find((s) => s.id === subjectId);
  if (!answer || !subject) notFound();
  const question = canonicalQuestion(intent, subject);
  const pages = { entityIds: new Set(listEntityIds(raceId)), chainIds: new Set(listChainIds(raceId)) };

  const related = trails.answers.filter((a) => a.subject_id === subjectId && a.intent !== intent);
  const subjectPage =
    subject.kind === "candidate" ? routes.candidate(raceId, subject.id) : pages.entityIds.has(subject.id) ? routes.entity(raceId, subject.id) : null;

  return (
    <div className="detail-page ask-page">
      <div>
        <Breadcrumbs
          items={[
            { href: routes.home(), label: "Races" },
            { href: routes.race(raceId), label: race.label },
            { href: routes.ask(raceId), label: "Money Trails" },
            { label: INTENT_LABELS[intent] },
          ]}
        />
        <DetailHeader
          label={`Money Trails · ${race.label}`}
          title={question}
          actions={
            <div>
              {subjectPage && <Link href={subjectPage}>{subject.kind === "candidate" ? "Candidate profile" : "Committee record"} →</Link>}
              <Link href={routes.ask(raceId)}>Ask another question →</Link>
            </div>
          }
        >
          <Headline answer={answer} />
        </DetailHeader>
      </div>

      <div className="detail-sections">
        <aside className="detail-sidebar">
          <nav className="detail-section-nav" aria-label={`Other questions about ${subject.name}`}>
            <p>Also about {subject.name}</p>
            <ul>
              {related.map((a) => (
                <li key={a.intent}>
                  <Link href={routes.answer(raceId, a.intent, a.subject_id)}>{INTENT_LABELS[a.intent]}</Link>
                </li>
              ))}
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
          <TrailAnswerView answer={answer} raceId={raceId} pages={pages} />
        </div>
      </div>

      <AskMethod dataMethod={trails.method} />
    </div>
  );
}
