import { DetailHeader } from "@/components/ui/detail-layout";
import { getDonor, getRace, listDonorKeys, listRaceIds } from "@/lib/data";
import { date, money, routes } from "@/lib/format";
import { AdjacencyNote, Breadcrumbs, Card, DataStatusBanner, Money, SourceLink, Stat } from "@/components/ui";
import { DonorTree } from "@/components/donor/donor-tree";

export const generateStaticParams = () => listRaceIds().flatMap((raceId) => listDonorKeys(raceId).map((donorId) => ({ raceId, donorId })));

export default async function DonorPage({ params }: { params: Promise<{ raceId: string; donorId: string }> }) {
  const { raceId, donorId } = await params;
  const race = getRace(raceId);
  const view = getDonor(raceId, donorId);
  const donor = view.nodes.find((n) => n.id === view.donor_id);
  const committees = view.nodes.filter((n) => n.depth === 1).length;
  const spenders = view.nodes.filter((n) => n.kind === "committee" && n.is_spender).length;
  const targeting = view.edges.filter((e) => e.kind === "targeting");

  return (
    <div className="detail-page donor-page">
      <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { href: routes.race(raceId), label: race.label }, { label: view.name }]} />
      <DataStatusBanner status={view.data_status} />
      <DetailHeader label={`Donor record · ${race.label}`} title={<>Where {view.name}&apos;s money went</>}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600">
          <span className="capitalize">{view.kind}</span>
          {donor && <SourceLink href={donor.source_url} label="FEC receipts under this name" />}
          <span className="text-xs text-neutral-500">Forward walk over 2024-cycle money edges, ending at independent expenditures in this race.</span>
        </div>
      </DetailHeader>

      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Given to committees shown" value={<Money amount={view.total_given} />} sub={money(view.total_given, { compact: false })} />
          <Stat label="Committees given to" value={committees} sub="first hop" />
          <Stat label="Outside spenders reached" value={spenders} sub="in this race" />
          <Stat label="Independent expenditures" value={targeting.length} sub={`${targeting.length === 1 ? "targeting edge" : "targeting edges"} · ${view.nodes.length} nodes`} />
        </div>
      </Card>

      {view.allocation_note && (
        <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{view.allocation_note}</p>
      )}

      <Card title="Forward walk">
        <DonorTree view={view} raceId={raceId} />
        <p className="mt-3 text-xs text-neutral-500">
          Solid rows are money edges (the reported total between the two parties, not this donor&apos;s share). Dashed amber rows are independent expenditures: they
          name a candidate but move no money to them.{view.truncated && " Tree cut at 200 nodes; smaller branches are not shown."}
        </p>
      </Card>

      <footer className="space-y-2 border-t border-neutral-200 pt-4">
        <AdjacencyNote />
        <p className="text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">Method.</span> {view.method}
        </p>
        <p className="text-xs text-neutral-500">Generated {date(view.generated_at.slice(0, 10))}.</p>
      </footer>
    </div>
  );
}
