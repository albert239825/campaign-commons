// OWNER: Block 2 — vendors.
import Link from "next/link";
import { getAds, getRace, getVendors, listRaceIds } from "@/lib/data";
import { date, pct, routes } from "@/lib/format";
import { Breadcrumbs, Card, Chip, DataStatusBanner, Money, SourceLink, Stat } from "@/components/ui";
import { RaceNav } from "@/components/ui/race-nav";
import { EmptyRow, Table, Td, Th } from "@/components/ui/table";
import { MediumBar, MediumBasisNote, MediumMix } from "@/components/vendors/medium";
import { TargetsLine } from "@/components/vendors/targets-line";

export const generateStaticParams = () => listRaceIds().map((raceId) => ({ raceId }));

export default async function VendorsPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const race = getRace(raceId);
  const index = getVendors(raceId);
  const candidateNames = Object.fromEntries(race.candidates.map((c) => [c.candidate_id, c.name]));
  const buys = index.vendors.reduce((s, v) => s + v.count, 0);
  const spenders = new Set(index.vendors.flatMap((v) => v.spenders.map((s) => s.entity_id))).size;
  const handChecked = index.vendors.filter((v) => v.normalization.basis === "verified").length;
  const classified = index.by_medium.filter((m) => m.medium !== "other").reduce((s, m) => s + m.amount, 0);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { href: routes.race(raceId), label: race.label }, { label: "Vendors" }]} />
      <DataStatusBanner status={index.data_status} />
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Vendors · {race.label}</h1>
        <p className="max-w-3xl text-sm text-neutral-600">
          Where outside money went: every independent expenditure in this race names a payee on Schedule E. Payee strings are folded
          into one vendor per firm; each vendor links to the fec.gov rows behind it. These are money edges from spender to vendor —
          the candidate named on a buy received nothing.
        </p>
      </header>
      <RaceNav race={race} counts={{ ads: getAds(raceId).ads.length }} />

      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Paid to vendors" value={<Money amount={index.total} />} sub="equals the race's outside total" />
          <Stat label="Vendors" value={index.vendors.length} sub={`${handChecked} with hand-checked aliases`} />
          <Stat label="Buys" value={buys.toLocaleString("en-US")} sub={`${spenders} ${spenders === 1 ? "spender" : "spenders"}`} />
          <Stat label="Medium classified" value={index.total > 0 ? pct(classified / index.total) : "—"} sub="of dollars not 'other'" />
        </div>
      </Card>

      <Card title="By medium">
        <MediumBar mix={index.by_medium} />
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {index.by_medium.map((m) => (
            <div key={m.medium}>
              <div className="text-neutral-600">
                <MediumMix mix={[m]} max={1} />
              </div>
              <div className="font-medium tabular-nums">
                <Money amount={m.amount} /> <span className="text-neutral-500">{m.count.toLocaleString("en-US")} buys</span>
              </div>
            </div>
          ))}
        </div>
        <MediumBasisNote basis={index.medium_basis} className="mt-3" />
      </Card>

      <Card title="Vendors, by dollars">
        <Table>
          <thead>
            <tr>
              <Th>Vendor</Th>
              <Th align="right">Paid</Th>
              <Th>Medium</Th>
              <Th>Spenders</Th>
              <Th>For / against</Th>
              <Th align="right">Buys</Th>
              <Th>First – last</Th>
              <Th align="right">Source</Th>
            </tr>
          </thead>
          <tbody>
            {index.vendors.length === 0 && <EmptyRow colSpan={8}>No independent expenditures with a payee in this race.</EmptyRow>}
            {index.vendors.map((v) => (
              <tr key={v.vendor_id}>
                <Td>
                  <Link href={routes.vendor(raceId, v.vendor_id)} className="font-medium hover:underline">
                    {v.name}
                  </Link>
                  {v.aliases.length > 1 && (
                    <Chip tone="muted" className="ml-1.5" title={v.aliases.join(" · ")}>
                      {v.aliases.length} spellings · {v.normalization.basis}
                    </Chip>
                  )}
                </Td>
                <Td align="right" className="font-medium">
                  <Money amount={v.total} compact={false} />
                </Td>
                <Td>
                  <MediumMix mix={v.media_mix} />
                </Td>
                <Td className="text-xs">
                  {v.spenders.slice(0, 2).map((s, i) => (
                    <span key={s.entity_id}>
                      {i > 0 && " · "}
                      <Link href={routes.entity(raceId, s.entity_id)} className="hover:underline">
                        {s.name}
                      </Link>
                    </span>
                  ))}
                  {v.spenders.length > 2 && <span className="text-neutral-500"> +{v.spenders.length - 2}</span>}
                </Td>
                <Td className="text-xs">
                  <TargetsLine raceId={raceId} targets={v.targets} candidateNames={candidateNames} />
                </Td>
                <Td align="right">{v.count.toLocaleString("en-US")}</Td>
                <Td className="whitespace-nowrap text-xs text-neutral-600">
                  {v.first_date === v.last_date ? date(v.first_date) : `${date(v.first_date)} – ${date(v.last_date)}`}
                </Td>
                <Td align="right">
                  <SourceLink href={v.source_url} label="FEC" />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {index.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-neutral-500">
          {index.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
