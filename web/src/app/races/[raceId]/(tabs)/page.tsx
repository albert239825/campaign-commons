// OWNER: Frontend A (race ledger).
import Link from "next/link";
import { getIssueFocus, getIssues, getLedger, getRace, getStories, listRaceIds } from "@/lib/data";
import { date, routes } from "@/lib/format";
import { AdjacencyNote, Card } from "@/components/ui";
import { RaceSections } from "@/components/ledger/race-sections";
import { FundingExplorer } from "@/components/ledger/funding-explorer";
import { buildFundingViews } from "@/lib/funding-view";
import { SpenderCards } from "@/components/ledger/spender-cards";
import { IssueCards } from "@/components/ledger/issue-cards";

export const generateStaticParams = () => listRaceIds().map((raceId) => ({ raceId }));

export default async function RaceLedgerPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const race = getRace(raceId);
  const ledger = getLedger(raceId);
  const stories = getStories(raceId);
  const issueFocus = Object.fromEntries(
    ledger.top_outside_spenders.flatMap((s) => {
      const focus = getIssueFocus(raceId, s.entity_id);
      return focus ? [[s.entity_id, focus] as const] : [];
    }),
  );
  const issues = getIssues(raceId);

  return (
    <>
      <RaceSections
        funding={<FundingExplorer views={buildFundingViews(ledger)} raceId={raceId} />}
        issues={issues ? (
          <IssueCards
            raceId={raceId}
            issues={issues}
            candidates={race.candidates}
            spenders={ledger.top_outside_spenders.map((s) => ({ entity_id: s.entity_id, name: s.name }))}
          />
        ) : undefined}
        spenders={
          <Card
            title="Top outside spenders"
            action={
              <Link href={routes.ads(raceId)} className="text-xs text-neutral-600 hover:underline">
                Ad gallery →
              </Link>
            }
          >
            <p className="mb-3 text-xs text-neutral-500">
              Committees reporting independent expenditures (Schedule E) about candidates in this race. Supports / opposes is as declared by
              the spender; these dollars are targeting, not money to a campaign. A self-described focus is the group&apos;s own words about
              itself, not what the dollars were spent on.
            </p>
            <SpenderCards
              raceId={raceId}
              spenders={ledger.top_outside_spenders}
              candidates={race.candidates}
              stories={stories.stories}
              focus={issueFocus}
            />
          </Card>
        }
      />

      <footer className="race-notes space-y-3">
        {ledger.notes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-neutral-500">
            {ledger.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        <AdjacencyNote />
        <p className="text-xs text-neutral-500">
          Generated {date(ledger.generated_at.slice(0, 10))} ·{" "}
          <Link href={routes.methodology()} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            Methodology
          </Link>
        </p>
      </footer>
    </>
  );
}
