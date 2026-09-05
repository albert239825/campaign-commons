// OWNER: Frontend A (race ledger).
import Link from "next/link";
import Image from "next/image";
import type { Party } from "@citizen-gotham/contracts";
import { getLedger, getRace, getStories, hasChain, listRaceIds } from "@/lib/data";
import { date, pct, routes } from "@/lib/format";
import { AdjacencyNote, Card, DataStatusBanner, Money } from "@/components/ui";
import { CandidatePanel } from "@/components/ledger/candidate-panel";
import { TraceabilityCard } from "@/components/ledger/traceability-card";
import { SpendersTable } from "@/components/ledger/spenders-table";
import { FlagsLegend } from "@/components/ledger/flags-legend";
import { StoryCard } from "@/components/ledger/story-card";

const START_HERE_COUNT = 5;
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
  const campaignTotal = ledger.candidates.reduce((s, c) => s + c.campaign.receipts, 0);
  const outsideTotal = ledger.candidates.reduce((s, c) => s + c.outside.total, 0);
  const allFlags = ledger.top_outside_spenders.flatMap((s) => s.flags);
  const stories = getStories(raceId);
  const topStories = stories.stories.slice(0, START_HERE_COUNT);
  const parties = Array.from(new Set(race.candidates.map((c) => c.party)));

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
              <h1 className="race-title">{race.label}</h1>
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
          <dl className="race-totals">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-neutral-500">Campaign receipts</dt>
              <dd className="text-xl font-semibold tabular-nums">
                <Money amount={campaignTotal} />
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-neutral-500">Outside spending</dt>
              <dd className="text-xl font-semibold tabular-nums">
                <Money amount={outsideTotal} />
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-neutral-500">Outside share</dt>
              <dd className="text-xl font-semibold tabular-nums">{campaignTotal + outsideTotal > 0 ? pct(outsideTotal / (campaignTotal + outsideTotal)) : "—"}</dd>
            </div>
          </dl>
        </header>
      </div>

      {topStories.length > 0 && (
        <Card
          title="Start here"
          action={
            <Link href={routes.stories(raceId)} className="text-xs text-neutral-600 hover:underline">
              All {stories.stories.length} stories →
            </Link>
          }
        >
          <p className="mb-3 text-xs text-neutral-500">
            Spenders ranked by the pipeline (amount, dark share, structural flags). The text is templated from FEC filings, not written by a person;
            each card says whether a human has checked it.
          </p>
          <div className="race-stories">
            {topStories.map((s) => (
              <StoryCard key={s.story_id} story={s} raceId={raceId} hasChain={hasChain(raceId, s.root_entity_id)} />
            ))}
          </div>
        </Card>
      )}

      {ledger.candidates.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">No candidate committees loaded for this race yet.</p>
        </Card>
      ) : (
        <div className="race-candidates">
          {ledger.candidates.map((c) => (
            <CandidatePanel key={c.candidate_id} raceId={raceId} c={c} />
          ))}
        </div>
      )}

      <div className="race-traceability">
        <TraceabilityCard t={ledger.traceability} />
      </div>

      <Card
        title="Top outside spenders"
        action={
          <Link href={routes.ads(raceId)} className="text-xs text-neutral-600 hover:underline">
            Ad gallery →
          </Link>
        }
      >
        <p className="mb-3 text-xs text-neutral-500">
          Committees reporting independent expenditures (Schedule E) about candidates in this race. S = supports, O = opposes, as
          declared by the spender. Dot = how visible the spender&apos;s own funding is. Click a column to sort.
        </p>
        <SpendersTable raceId={raceId} spenders={ledger.top_outside_spenders} candidates={race.candidates} />
        {allFlags.length > 0 && (
          <div className="mt-4 border-t border-neutral-100 pt-3">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Flags</div>
            <FlagsLegend flags={allFlags} />
          </div>
        )}
      </Card>

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
