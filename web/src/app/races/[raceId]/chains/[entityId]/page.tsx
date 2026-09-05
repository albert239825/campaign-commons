// OWNER: Frontend B (chain view).
import Link from "next/link";
import { notFound } from "next/navigation";
import { UNWALKED_COLOR, VISIBILITY_COLORS, type TerminusReason } from "@citizen-gotham/contracts";
import { getAds, getChain, getRace, hasChain, listChainIds, listDonorKeys, listEntityIds, listRaceIds } from "@/lib/data";
import { money, routes } from "@/lib/format";
import { Breadcrumbs, Card, DataStatusBanner, FlagBadge, Legend, Money, ShareBar, SourceLink, Stat, Swatch } from "@/components/ui";
import { ChainDiagram } from "@/components/chain/chain-diagram";
import { EdgeTable } from "@/components/chain/edge-table";
import type { NodeLinks } from "@/components/chain/links";
import { SeenAdsStrip } from "@/components/chain/seen-ads-strip";
import { toWire } from "@/components/chain/view";

export const generateStaticParams = () =>
  listRaceIds().flatMap((raceId) => listChainIds(raceId).map((entityId) => ({ raceId, entityId })));

const TERMINUS_LABELS: Record<TerminusReason, string> = {
  individual: "individual donors",
  organization: "business / union treasuries",
  dark: "dark terminals",
  inferable: "inferable (990) terminals",
  cycle: "cycles",
  depth_cap: "FEC committees not walked",
  pruned: "aggregated remainders",
};

export default async function ChainPage({ params }: { params: Promise<{ raceId: string; entityId: string }> }) {
  const { raceId, entityId } = await params;
  const race = getRace(raceId);
  if (!hasChain(raceId, entityId)) notFound();
  const chain = getChain(raceId, entityId);
  const links: NodeLinks = { raceId, entityIds: new Set(listEntityIds(raceId)), donorKeys: new Set(listDonorKeys(raceId)) };
  const root = chain.nodes.find((n) => n.id === chain.root_entity_id);
  const sources = chain.nodes.filter((n) => n.depth > 0);
  const darkOnly = sources.length > 0 && sources.every((n) => n.visibility === "dark");
  const terminusCounts = Object.entries(chain.summary.terminus_counts) as [TerminusReason, number][];
  const verifiedAds = getAds(raceId).ads.filter((a) => a.matched_entity_id === entityId && a.verification?.status === "verified");

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { href: routes.home(), label: "Races" },
          { href: routes.race(raceId), label: race.label },
          { href: routes.entity(raceId, entityId), label: chain.root_name },
          { label: "Funding chain" },
        ]}
      />
      <DataStatusBanner status={chain.data_status} />
      <SeenAdsStrip ads={verifiedAds} raceId={raceId} />

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Where {chain.root_name}&apos;s money came from</h1>
          {chain.flags.map((f) => (
            <FlagBadge key={f.id} flag={f} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600">
          <Link href={routes.entity(raceId, entityId)} className="font-medium text-neutral-900 hover:underline">
            ← Entity page
          </Link>
          {root?.source_url && <SourceLink href={root.source_url} label="FEC committee record" />}
          <span className="text-xs text-neutral-500">
            Backward walk over 2024-cycle receipts, {chain.summary.max_depth} {chain.summary.max_depth === 1 ? "hop" : "hops"} deep. Money edges only; independent
            expenditures are not drawn.
          </span>
        </div>
      </header>

      <Card>
        <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Total receipts traced" value={<Money amount={chain.summary.total_in} />} sub={money(chain.summary.total_in, { compact: false })} />
            <Stat label="Depth" value={chain.summary.max_depth} sub={`${chain.nodes.length} nodes · ${chain.edges.length} edges`} />
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Visibility of traced dollars</div>
            <ShareBar
              shares={{
                disclosed: chain.summary.disclosed_share,
                inferable: chain.summary.inferable_share,
                unwalked: chain.summary.unwalked_share,
                dark: chain.summary.dark_share,
              }}
            />
            <div className="mt-2 text-xs text-neutral-500">
              Ends in{" "}
              {terminusCounts
                .filter(([, c]) => c > 0)
                .map(([k, c]) => `${c} ${TERMINUS_LABELS[k]}`)
                .join(", ") || "—"}
              .
            </div>
          </div>
        </div>
      </Card>

      {chain.flags.length > 0 && (
        <ul className="space-y-1 text-sm">
          {chain.flags.map((f) => (
            <li key={f.id} className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium text-amber-900">⚑ {f.label}.</span>
              <span className="text-neutral-700">{f.detail}</span>
              {f.evidence_url && <SourceLink href={f.evidence_url} label="evidence" />}
            </li>
          ))}
        </ul>
      )}

      <Card
        title="Flow of money into the spender"
        action={
          <Legend
            items={[
              { swatch: <Swatch color={VISIBILITY_COLORS.disclosed} />, label: "disclosed (FEC)" },
              { swatch: <Swatch color={VISIBILITY_COLORS.inferable} />, label: "inferable (990, lagged)" },
              { swatch: <Swatch color={UNWALKED_COLOR} />, label: "not walked (FEC committee, receipts outside this race's neighborhood)" },
              { swatch: <Swatch color={VISIBILITY_COLORS.dark} className="bg-[repeating-linear-gradient(45deg,#e24b4a_0_2px,#fdecec_2px_4px)]" />, label: "dark wall (no disclosure)" },
              { swatch: <Swatch color="#f5f5f5" className="border border-dashed border-neutral-400" />, label: "other (aggregated)" },
            ]}
          />
        }
      >
        {darkOnly && (
          <p className="mb-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            Every traced source for this spender is a layer with no donor-disclosure obligation. The public record stops here.
          </p>
        )}
        {chain.edges.length === 0 ? (
          <p className="text-sm text-neutral-500">No receipts were traced for this spender in the 2024 cycle.</p>
        ) : (
          <ChainDiagram wire={toWire(chain, links)} maxDepth={chain.summary.max_depth} />
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Ribbon width is proportional to dollars; color is how the money is disclosed. Read left to right: sources → intermediaries → spender. Linked source
          names open that donor&apos;s forward view.
        </p>
      </Card>

      <Card title="Receipts — every edge, with its record">
        <EdgeTable chain={chain} links={links} />
      </Card>

      <p className="text-xs text-neutral-500">
        <span className="font-medium text-neutral-700">Method.</span> {chain.method}
      </p>
    </div>
  );
}
