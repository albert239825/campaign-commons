// OWNER: Frontend A (race ledger).
import Link from "next/link";
import Image from "next/image";
import type { Party } from "@campaign-commons/contracts";
import { getAds, getIssueFocus, getIssues, getLedger, getRace, getStories, hasTrails, listRaceIds } from "@/lib/data";
import { date, routes } from "@/lib/format";
import { AdjacencyNote, Card, DataStatusBanner } from "@/components/ui";
import { RaceNav } from "@/components/ui/race-nav";
import { RaceSections } from "@/components/ledger/race-sections";
import { FundingExplorer } from "@/components/ledger/funding-explorer";
import { buildFundingViews } from "@/lib/funding-view";
import { SpenderCards } from "@/components/ledger/spender-cards";
import { IssueCards } from "@/components/ledger/issue-cards";

const PARTY_NAMES: Record<Party, string> = {
  DEM: "Democratic Party",
  REP: "Republican Party",
  LIB: "Libertarian Party",
  GRE: "Green Party",
  IND: "Independent",
  CON: "Constitution Party",
  OTH: "Other",
};

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
  const parties = Array.from(new Set(race.candidates.map((c) => c.party)));
  const officeName = { S: "US Senate", H: "US House", P: "US President" }[race.office];
  const stateName = race.label.split("·")[0].trim();
  const adCount = getAds(raceId).ads.length;
  const issues = getIssues(raceId);

  return (
    <div className="race-dashboard">
      <div>
        <DataStatusBanner status={ledger.data_status} />
        <header className="race-overview">
          <div className={`race-banner ${race.office === "S" ? "race-banner--senate" : ""}`}>
            {race.office === "S" && (
              <Image
                className="race-banner-seal"
                src="/images/united-states-senate.webp"
                alt="United States Senate seal"
                width={160}
                height={160}
                sizes="(max-width: 680px) 88px, 140px"
                priority
              />
            )}
            <div className="race-banner-heading">
              <h1 className="race-title">
                <span className="block">{officeName} {race.cycle}</span>
                <span className="block">{stateName}</span>
              </h1>
              <p className="race-election-date">
                {race.status === "complete" ? "Election held" : "Election day"}
                {" · "}<time dateTime={race.election_date}>{date(race.election_date)}</time>
              </p>
            </div>
            <section className="race-banner-candidates" aria-labelledby="notable-candidates-title">
              <h2 id="notable-candidates-title">Notable candidates</h2>
              {parties.length > 0 ? (
                <dl>
                  {parties.map((party) => (
                    <div key={party}>
                      <dt>{PARTY_NAMES[party]}</dt>
                      <dd>
                        <ul>
                          {race.candidates.filter((c) => c.party === party).map((c) => (
                            <li key={c.candidate_id}>
                              <Link href={routes.candidate(raceId, c.candidate_id)}>{c.name}</Link>
                              {c.incumbent && <span className="race-candidate-role">{race.status === "complete" ? "Incumbent at election" : "Incumbent"}</span>}
                              <Link href={routes.candidate(raceId, c.candidate_id)} className="race-candidate-dossier" aria-label={`${c.name} dossier`}>
                                Dossier →
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : <p>Candidate information has not been added yet.</p>}
            </section>
          </div>
        </header>
        <RaceNav race={race} counts={{ ads: adCount }} active={routes.race(raceId)} trails={hasTrails(raceId)} />
        {hasTrails(raceId) && (
          <Link
            href={routes.ask(raceId)}
            className="mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm hover:border-neutral-900"
          >
            <span>
              <span className="font-medium">Money Trails</span> — ask in plain English: who funds a committee, who is spending for or against a candidate, who paid
              for the ads about them.
            </span>
            <span className="text-xs text-neutral-500">Ask →</span>
          </Link>
        )}
      </div>

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
    </div>
  );
}
