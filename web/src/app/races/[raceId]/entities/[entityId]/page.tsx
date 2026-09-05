// OWNER: Frontend A (entity page).
import Link from "next/link";
import { getEntity, getRace, hasChain, listEntityIds, listRaceIds } from "@/lib/data";
import { pct, routes } from "@/lib/format";
import { AdjacencyNote, Breadcrumbs, Card, DataStatusBanner, Money } from "@/components/ui";
import { VISIBILITY_COLORS } from "@citizen-gotham/contracts";
import { BarLegend, MONEY_COLORS, StackedBar, visibilitySegments } from "@/components/ui/stacked-bar";
import { EntityHeader } from "@/components/entity/entity-header";
import { FlowsTable } from "@/components/entity/flows-table";
import { IeTable } from "@/components/entity/ie-table";

export const generateStaticParams = () =>
  listRaceIds().flatMap((raceId) => listEntityIds(raceId).map((entityId) => ({ raceId, entityId })));

export default async function EntityPage({ params }: { params: Promise<{ raceId: string; entityId: string }> }) {
  const { raceId, entityId } = await params;
  const race = getRace(raceId);
  const e = getEntity(raceId, entityId);
  const raceEntityIds = new Set(listEntityIds(raceId));
  const chain = e.has_chain && hasChain(raceId, entityId);
  const isCampaign = e.designation === "P" && (e.committee_type === "S" || e.committee_type === "H" || e.committee_type === "P");
  const segs = [
    { label: "Itemized individual receipts", value: e.totals.from_individuals, color: VISIBILITY_COLORS.disclosed },
    { label: "From committees", value: e.totals.from_committees, color: MONEY_COLORS.campaign },
    { label: "From business / union treasuries", value: e.totals.from_organizations ?? 0, color: MONEY_COLORS.outside },
    { label: "From orgs with funding not on file", value: e.totals.from_undisclosed, color: VISIBILITY_COLORS.dark },
  ].filter((s) => s.value > 0);
  const known = segs.reduce((s, x) => s + x.value, 0);

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { href: routes.race(raceId), label: race.label }, { label: e.name }]} />
        <DataStatusBanner status={e.data_status} />
        <EntityHeader raceId={raceId} e={e} chain={chain} />
      </div>

      <Card title="Where the money came from">
        {known > 0 ? (
          <>
            <StackedBar segments={segs} height="h-4" />
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {segs.map((s) => (
                <div key={s.label}>
                  <div className="flex items-center gap-1 text-neutral-600">
                    <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </div>
                  <div className="font-medium tabular-nums">
                    <Money amount={s.value} /> <span className="text-neutral-500">{pct(s.value / known)}</span>
                  </div>
                </div>
              ))}
            </div>
            {isCampaign && (
              <p className="mt-2 text-[11px] text-neutral-500">
                Itemized Schedule A receipts only (individuals giving over $200 in the cycle). The race ledger&apos;s &quot;Individuals (FEC summary, incl.
                unitemized)&quot; figure is larger because the FEC candidate summary also counts unitemized small-dollar receipts.
              </p>
            )}
            <p className="mt-2 text-[11px] text-neutral-500">
              Committee transfers are disclosed at this hop but may carry undisclosed money from further back.{" "}
              {chain ? (
                <Link href={routes.chain(raceId, e.entity_id)} className="underline decoration-dotted underline-offset-2">
                  The chain page walks them backward.
                </Link>
              ) : (
                "No chain has been computed for this committee."
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-neutral-500">No 2024-cycle receipts on file.</p>
        )}
      </Card>

      <Card title="Inflows (money in)">
        <FlowsTable raceId={raceId} rows={e.inflows} direction="in" raceEntityIds={raceEntityIds} emptyText="No inflows on file for this cycle." />
        <p className="mt-2 text-[11px] text-neutral-500">Top counterparties, aggregated. Limit = statutory cap per election or year for that transaction type.</p>
      </Card>

      <Card title="Outflows (money out, to other committees)">
        <FlowsTable raceId={raceId} rows={e.outflows} direction="out" raceEntityIds={raceEntityIds} emptyText="No committee-to-committee outflows on file." />
      </Card>

      <Card title="Independent expenditures in this race">
        <p className="mb-2 text-xs text-neutral-500">
          Targeting edges, not money edges: these dollars go to vendors, not to the candidate named. Support/oppose is the
          spender&apos;s own declaration.
        </p>
        <IeTable raceId={raceId} rows={e.independent_expenditures} />
      </Card>

      <footer className="space-y-3 border-t border-neutral-200 pt-4">
        <BarLegend segments={visibilitySegments({ disclosed: 1, inferable: 1, dark: 1 })} />
        <AdjacencyNote />
        <Link href={routes.methodology()} className="text-xs text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900">
          Methodology
        </Link>
      </footer>
    </div>
  );
}
