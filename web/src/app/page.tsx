// OWNER: Frontend A (race table).
import Link from "next/link";
import { getRaces } from "@/lib/data";
import { date, routes } from "@/lib/format";
import { DataStatusBanner } from "@/components/ui";
import { BarLegend, MONEY_COLORS } from "@/components/ui/stacked-bar";
import { Table, Th } from "@/components/ui/table";
import { RaceRow } from "@/components/race-table/race-row";

export default function RaceTablePage() {
  const { races, generated_at } = getRaces();
  const live = races.filter((r) => r.status !== "stub");
  const worst = live.some((r) => r.data_status === "mock") ? "mock" : live.some((r) => r.data_status === "partial") ? "partial" : "real";
  return (
    <div className="space-y-8">
      <section className="max-w-3xl">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
          Who paid for this race, and how much of it can be traced to a named source.
        </h1>
        <p className="mt-3 text-base text-neutral-600">
          Campaign money and outside money for each race, from FEC filings. Every number links to the record it came from. We
          show adjacency, never causation.{" "}
          <Link href={routes.methodology()} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            How the numbers are computed
          </Link>
          .
        </p>
      </section>

      <DataStatusBanner status={worst} />

      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">Races</h2>
          <BarLegend
            segments={[
              { label: "Campaign receipts", value: 1, color: MONEY_COLORS.campaign },
              { label: "Outside spending", value: 1, color: MONEY_COLORS.outside },
            ]}
          />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Race</Th>
              <Th>Candidates</Th>
              <Th align="right">Campaign</Th>
              <Th align="right">Outside</Th>
              <Th>Outside share</Th>
              <Th align="right">Traceability</Th>
              <Th align="right">Status</Th>
            </tr>
          </thead>
          <tbody>
            {races.map((r) => (
              <RaceRow key={r.race_id} race={r} />
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-neutral-500">
          Traceability is the share of outside dollars that resolve to a named source (an individual, business or union) after
          walking committee-to-committee transfers backward. Preliminary; see methodology. Index generated {date(generated_at.slice(0, 10))}.
        </p>
      </section>
    </div>
  );
}
