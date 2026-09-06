// OWNER: Money Trails (D-73).
import Link from "next/link";
import { notFound } from "next/navigation";
import { ISSUE_BY_ID, ISSUE_IDS } from "@campaign-commons/contracts";
import { getRace, getTrails, hasTrails, listRaceIds } from "@/lib/data";
import { routes } from "@/lib/format";
import { ASK_INTENTS, canonicalQuestion, INTENT_LABELS } from "@/lib/ask";
import { Breadcrumbs, Card, DataStatusBanner } from "@/components/ui";
import { DetailHeader, SectionNav } from "@/components/ui/detail-layout";
import { AskBox, SuggestionLink } from "@/components/ask/ask-box";
import { AskMethod } from "@/components/ask/method";

export const generateStaticParams = () => listRaceIds().filter(hasTrails).map((raceId) => ({ raceId }));

export default async function AskPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const race = getRace(raceId);
  if (!hasTrails(raceId)) notFound();
  const trails = getTrails(raceId);
  const candidates = trails.subjects.filter((s) => s.kind === "candidate");
  const committees = trails.subjects.filter((s) => s.kind === "committee");

  return (
    <div className="detail-page ask-page">
      <div>
        <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { href: routes.race(raceId), label: race.label }, { label: "Money Trails" }]} />
        <DataStatusBanner status={trails.data_status} />
        <DetailHeader
          label={race.label}
          title="Money Trails"
          actions={
            <div>
              <Link href={routes.race(raceId)}>Race dashboard →</Link>
              <Link href={routes.ads(raceId)}>Ad gallery →</Link>
              <Link href={routes.methodology()}>Methodology →</Link>
            </div>
          }
        >
          <p>
            Ask a plain-English money question about this race. Four kinds are answered, each from the filed records already on this site. A model
            only reads the question to pick which; every answer is precomputed, and every number links to where it was read.
          </p>
        </DetailHeader>
      </div>

      <Card>
        <AskBox raceId={raceId} subjects={trails.subjects} examples={trails.examples} autoFocus />
        <ul className="ask-examples mt-5 flex flex-wrap gap-2">
          {trails.examples.map((q) => (
            <li key={q}>
              <SuggestionLink raceId={raceId} subjects={trails.subjects} question={q} />
            </li>
          ))}
        </ul>
      </Card>

      <div className="detail-sections">
        <aside className="detail-sidebar">
          <SectionNav
            label="Questions answered"
            items={ASK_INTENTS.map((intent) => ({
              id: intent,
              label: INTENT_LABELS[intent],
              note:
                intent === "committee_funding"
                  ? `${committees.length} committees`
                  : intent === "spender_issue"
                    ? `${candidates.length} candidates × ${ISSUE_IDS.length} issues`
                    : `${candidates.length} candidates`,
            }))}
          />
        </aside>
        <div className="detail-content">
          {ASK_INTENTS.map((intent) => {
            const subjects = intent === "committee_funding" ? committees : candidates;
            const shown = subjects.slice(0, intent === "committee_funding" ? 12 : subjects.length);
            return (
              <div key={intent} id={intent} className="detail-section">
                <Card title={INTENT_LABELS[intent]}>
                  <ul className="ask-question-list">
                    {shown.map((s) => (
                      <li key={s.id}>
                        {intent === "spender_issue" ? (
                          <>
                            <span className="font-medium">{s.name}</span>
                            <span className="ml-2 inline-flex flex-wrap gap-x-2 gap-y-1">
                              {ISSUE_IDS.map((issueId) => (
                                <Link key={issueId} href={routes.issueAnswer(raceId, issueId, s.id)} className="text-xs">
                                  {ISSUE_BY_ID[issueId].label}
                                </Link>
                              ))}
                            </span>
                          </>
                        ) : (
                          <Link href={routes.answer(raceId, intent, s.id)}>{canonicalQuestion(intent, s)}</Link>
                        )}
                      </li>
                    ))}
                  </ul>
                  {intent === "committee_funding" && committees.length > shown.length && (
                    <p className="text-xs text-neutral-500">…and {committees.length - shown.length} more committees on the ledger; type a name in the box above.</p>
                  )}
                </Card>
              </div>
            );
          })}
        </div>
      </div>

      <AskMethod dataMethod={trails.method} />
    </div>
  );
}
