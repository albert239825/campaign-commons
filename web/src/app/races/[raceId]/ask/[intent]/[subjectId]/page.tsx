// OWNER: Money Trails (D-73).
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRace, getTrails, hasTrails, listChainIds, listEntityIds, listRaceIds } from "@/lib/data";
import { routes } from "@/lib/format";
import { canonicalQuestion, INTENT_LABELS, isIntent } from "@/lib/ask";
import { DetailHeader } from "@/components/ui/detail-layout";
import { RaceShell } from "@/components/ui/race-shell";
import { AskBox } from "@/components/ask/ask-box";
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

  return (
    <RaceShell
      race={race}
      section="trails"
      record
      status={trails.data_status}
      crumbs={[{ href: routes.ask(raceId), label: "Money Trails" }, { label: INTENT_LABELS[intent] }]}
      className="ask-page"
      header={
        <DetailHeader label={`Money Trails · ${race.label}`} title={question}>
          <Headline answer={answer} />
        </DetailHeader>
      }
    >
      <AskBox raceId={raceId} subjects={trails.subjects} examples={trails.examples} initial={question} />

      <TrailAnswerView answer={answer} raceId={raceId} pages={pages} />

      {related.length > 0 && (
        <p className="text-xs text-neutral-500">
          Also about {subject.name}:{" "}
          {related.map((a, i) => (
            <span key={a.intent}>
              {i > 0 && " · "}
              <Link href={routes.answer(raceId, a.intent, a.subject_id)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
                {canonicalQuestion(a.intent, subject)}
              </Link>
            </span>
          ))}
        </p>
      )}
      <p className="text-xs text-neutral-500">{trails.method}</p>
    </RaceShell>
  );
}
