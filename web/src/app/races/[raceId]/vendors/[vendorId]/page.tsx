// OWNER: Block 2 — vendors.
import Link from "next/link";
import { getAds, getEntity, getRace, getVendor, getVendors, listEntityIds, listRaceIds, listVendorIds } from "@/lib/data";
import { BASIS_LABELS, BASIS_MEANING } from "@/lib/evidence";
import { date, pct, routes } from "@/lib/format";
import { AdjacencyNote, Breadcrumbs, Card, Chip, DataStatusBanner, Money, SourceLink, Stat } from "@/components/ui";
import { RaceNav } from "@/components/ui/race-nav";
import { Table, Td, Th } from "@/components/ui/table";
import { MEDIUM_LABELS, MediumBar, MediumBasisNote } from "@/components/vendors/medium";
import { TargetsLine } from "@/components/vendors/targets-line";
import { VendorAds } from "@/components/vendors/vendor-ads";

export const generateStaticParams = () => listRaceIds().flatMap((raceId) => listVendorIds(raceId).map((vendorId) => ({ raceId, vendorId })));

export default async function VendorPage({ params }: { params: Promise<{ raceId: string; vendorId: string }> }) {
  const { raceId, vendorId } = await params;
  const race = getRace(raceId);
  const index = getVendors(raceId);
  const v = getVendor(raceId, vendorId);
  const candidateNames = Object.fromEntries(race.candidates.map((c) => [c.candidate_id, c.name]));
  const rank = index.vendors.findIndex((x) => x.vendor_id === v.vendor_id) + 1;
  const share = index.total > 0 ? v.total / index.total : 0;
  const rows = [...v.expenditures].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.amount - a.amount);
  const n = v.normalization;
  const gallery = getAds(raceId);
  const sponsorNames: Record<string, string> = Object.fromEntries(v.spenders.map((s) => [s.entity_id, s.name]));
  const entityIds = new Set(listEntityIds(raceId));
  for (const id of new Set([...v.ads.map((a) => a.sponsor_entity_id), ...gallery.ads.flatMap((a) => (a.matched_entity_id ? [a.matched_entity_id] : []))])) {
    if (!(id in sponsorNames) && entityIds.has(id)) sponsorNames[id] = getEntity(raceId, id).name;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { href: routes.home(), label: "Races" },
          { href: routes.race(raceId), label: race.label },
          { href: routes.vendors(raceId), label: "Vendors" },
          { label: v.name },
        ]}
      />
      <DataStatusBanner status={v.data_status} />
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{v.name}</h1>
          <span className="text-sm text-neutral-500">
            vendor · #{rank} of {index.vendors.length} in {race.label}
          </span>
          <SourceLink href={v.source_url} label="all Schedule E rows for this payee on fec.gov" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
          <span className="font-medium uppercase tracking-wide text-neutral-400">filed as</span>
          {v.aliases.map((a) => (
            <Chip key={a} tone="muted">
              {a}
            </Chip>
          ))}
        </div>
        <p className="max-w-3xl text-[11px] text-neutral-500">
          <span className="font-medium uppercase tracking-wide text-neutral-400" title={BASIS_MEANING[n.basis]}>
            {BASIS_LABELS[n.basis]} · rule
          </span>{" "}
          {n.rule}
          {n.basis === "verified" && (
            <>
              {" "}
              — checked by {n.checked_by} on {date(n.checked_at)}
            </>
          )}
          {n.source_urls.map((u, i) => (
            <SourceLink key={u} href={u} label={i === 0 ? "fec.gov" : "source"} className="ml-1.5" />
          ))}
        </p>
      </header>
      <RaceNav race={race} counts={{ ads: gallery.ads.length }} active={routes.vendors(raceId)} />

      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Paid in this race" value={<Money amount={v.total} />} sub={`${pct(share, 1)} of outside spending`} />
          <Stat label="Buys" value={v.count.toLocaleString("en-US")} sub={v.first_date === v.last_date ? date(v.first_date) : `${date(v.first_date)} – ${date(v.last_date)}`} />
          <Stat label="Spenders" value={v.spenders.length} sub="committees reporting payments" />
          <Stat
            label="Top medium"
            value={v.media_mix.length > 0 ? MEDIUM_LABELS[v.media_mix[0].medium] : "—"}
            sub={v.media_mix.length > 0 ? `${pct(v.media_mix[0].amount / v.total)} of dollars` : undefined}
          />
        </div>
      </Card>

      <Card title="By medium">
        <MediumBar mix={v.media_mix} />
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {v.media_mix.map((m) => (
            <div key={m.medium}>
              <Chip tone={m.medium === "other" ? "muted" : "neutral"}>
                {MEDIUM_LABELS[m.medium]} {pct(v.total > 0 ? m.amount / v.total : 0)}
              </Chip>
              <div className="font-medium tabular-nums">
                <Money amount={m.amount} /> <span className="text-neutral-500">{m.count.toLocaleString("en-US")} buys</span>
              </div>
            </div>
          ))}
        </div>
        <MediumBasisNote basis={index.medium_basis} className="mt-3" />
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Who paid this vendor">
          <Table>
            <thead>
              <tr>
                <Th>Spender</Th>
                <Th align="right">Paid</Th>
                <Th align="right">Buys</Th>
              </tr>
            </thead>
            <tbody>
              {v.spenders.map((s) => (
                <tr key={s.entity_id}>
                  <Td>
                    <Link href={routes.entity(raceId, s.entity_id)} className="hover:underline">
                      {s.name}
                    </Link>
                  </Td>
                  <Td align="right" className="font-medium">
                    <Money amount={s.amount} compact={false} />
                  </Td>
                  <Td align="right">{s.count.toLocaleString("en-US")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title="Candidates named on the buys">
          <p className="mb-2 text-xs text-neutral-500">
            Targeting, not money: the spender declares support or opposition on each Schedule E row; the candidate receives nothing.
          </p>
          <div className="text-sm">
            <TargetsLine raceId={raceId} targets={v.targets} candidateNames={candidateNames} />
          </div>
        </Card>
      </div>

      <VendorAds raceId={raceId} vendor={v} ads={gallery.ads} sponsorNames={sponsorNames} />

      <Card title="Every buy">
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Spender</Th>
              <Th>S/O</Th>
              <Th>Target</Th>
              <Th align="right">Amount</Th>
              <Th>Medium</Th>
              <Th>Filed payee · purpose</Th>
              <Th align="right">Source</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ie) => (
              <tr key={ie.ie_id}>
                <Td className="whitespace-nowrap text-xs text-neutral-600">{date(ie.date)}</Td>
                <Td className="text-xs">
                  <Link href={routes.entity(raceId, ie.spender_entity_id)} className="hover:underline">
                    {ie.spender_name}
                  </Link>
                </Td>
                <Td>
                  <span className={`font-semibold ${ie.support_oppose === "S" ? "text-neutral-900" : "text-dark"}`} title={ie.support_oppose === "S" ? "Supports" : "Opposes"}>
                    {ie.support_oppose}
                  </span>
                </Td>
                <Td className="text-xs">
                  <Link href={routes.candidate(raceId, ie.candidate_id)} className="hover:underline">
                    {ie.candidate_name}
                  </Link>
                </Td>
                <Td align="right" className="font-medium">
                  <Money amount={ie.amount} compact={false} />
                </Td>
                <Td>{ie.medium ? <Chip tone={ie.medium === "other" ? "muted" : "neutral"}>{MEDIUM_LABELS[ie.medium]}</Chip> : "—"}</Td>
                <Td className="text-xs text-neutral-600">
                  {ie.payee ?? "—"}
                  {ie.purpose ? <span className="text-neutral-400"> · {ie.purpose}</span> : null}
                </Td>
                <Td align="right">
                  <SourceLink href={ie.source_url} label="FEC" />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-[11px] text-neutral-500">{v.method}</p>
      </Card>

      <footer className="space-y-3 border-t border-neutral-200 pt-4">
        <AdjacencyNote />
        <Link href={routes.methodology()} className="text-xs text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900">
          Methodology
        </Link>
      </footer>
    </div>
  );
}
