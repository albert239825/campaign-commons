// OWNER: Frontend A (race ledger).
import Link from "next/link";
import { getLedger, getRace, getStories, hasChain, listRaceIds } from "@/lib/data";
import { date, pct, routes } from "@/lib/format";
import { AdjacencyNote, Breadcrumbs, Card, DataStatusBanner, Money } from "@/components/ui";
import { PartyTag } from "@/components/ui/party-tag";
import { CandidatePanel } from "@/components/ledger/candidate-panel";
import { TraceabilityCard } from "@/components/ledger/traceability-card";
import { SpendersTable } from "@/components/ledger/spenders-table";
import { FlagsLegend } from "@/components/ledger/flags-legend";
import { StoryCard } from "@/components/ledger/story-card";

const START_HERE_COUNT = 5;

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

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { label: race.label }]} />
        <DataStatusBanner status={ledger.data_status} />
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-300 pb-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{race.label}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600">
              <span>Election {date(race.election_date)}</span>
              <span className="flex flex-wrap gap-3">
                {race.candidates.map((c) => (
                  <span key={c.candidate_id} className="inline-flex items-center gap-1.5">
                    <PartyTag party={c.party} />
                    <Link href={routes.candidate(raceId, c.candidate_id)} className="hover:underline">
                      {c.name}
                    </Link>
                    {c.incumbent && <span className="text-[10px] uppercase tracking-wide text-neutral-400">inc.</span>}
                  </span>
                ))}
              </span>
            </div>
          </div>
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-neutral-500">Campaign</dt>
              <dd className="text-xl font-semibold tabular-nums">
                <Money amount={campaignTotal} />
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-neutral-500">Outside</dt>
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
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
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
        <div className="grid gap-4 md:grid-cols-2">
          {ledger.candidates.map((c) => (
            <CandidatePanel key={c.candidate_id} raceId={raceId} c={c} />
          ))}
        </div>
      )}

      <TraceabilityCard t={ledger.traceability} />

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

      <footer className="space-y-3 border-t border-neutral-200 pt-4">
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
