import { DetailHeader, SectionNav } from "@/components/ui/detail-layout";
// OWNER: Frontend B (chain view).
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  TARGETING_COLOR,
  UNWALKED_COLOR,
  VISIBILITY_COLORS,
  type TerminusReason,
} from "@campaign-commons/contracts";
import {
  getAds,
  getChain,
  getRace,
  hasChain,
  listChainIds,
  listDonorKeys,
  listEntityIds,
  listRaceIds,
} from "@/lib/data";
import { money, routes } from "@/lib/format";
import {
  Breadcrumbs,
  Card,
  DataStatusBanner,
  FlagBadge,
  Legend,
  Money,
  ShareBar,
  SourceLink,
  Stat,
  Swatch,
} from "@/components/ui";
import {
  PLACEMENT_COLOR,
  ChainDiagram,
} from "@/components/chain/chain-diagram";
import { EdgeTable } from "@/components/chain/edge-table";
import type { NodeLinks } from "@/components/chain/links";
import { SeenAdsStrip } from "@/components/chain/seen-ads-strip";
import { toWire } from "@/components/chain/view";

export const generateStaticParams = () =>
  listRaceIds().flatMap((raceId) =>
    listChainIds(raceId).map((entityId) => ({ raceId, entityId })),
  );

const TERMINUS_LABELS: Record<TerminusReason, string> = {
  individual: "individual donors",
  organization: "business / union treasuries",
  dark: "dark terminals",
  inferable: "inferable (990) terminals",
  cycle: "cycles",
  depth_cap: "FEC committees not walked",
  pruned: "aggregated remainders",
};

export default async function ChainPage({
  params,
}: {
  params: Promise<{ raceId: string; entityId: string }>;
}) {
  const { raceId, entityId } = await params;
  const race = getRace(raceId);
  if (!hasChain(raceId, entityId)) notFound();
  const chain = getChain(raceId, entityId);
  const links: NodeLinks = {
    raceId,
    entityIds: new Set(listEntityIds(raceId)),
    donorKeys: new Set(listDonorKeys(raceId)),
  };
  const root = chain.nodes.find((n) => n.id === chain.root_entity_id);
  const sources = chain.nodes.filter((n) => n.depth > 0);
  const darkOnly =
    sources.length > 0 && sources.every((n) => n.visibility === "dark");
  const terminusCounts = Object.entries(chain.summary.terminus_counts) as [
    TerminusReason,
    number,
  ][];
  const verifiedAds = getAds(raceId).ads.filter(
    (a) =>
      a.matched_entity_id === entityId && a.verification?.status === "verified",
  );
  const outNodes = chain.nodes.filter((n) => n.side === "out");
  const hasOut = outNodes.length > 0;
  const vendorCount = outNodes.filter((n) => n.kind === "vendor").length;
  const adCount =
    outNodes.filter((n) => n.kind === "ad").length +
    outNodes
      .filter((n) => n.kind === "aggregate")
      .reduce((s, n) => s + (n.contributor_count ?? 0), 0);
  const candidateCount = outNodes.filter((n) => n.kind === "candidate").length;

  return (
    <div className="detail-page chain-page">
      <Breadcrumbs
        items={[
          { href: routes.home(), label: "Races" },
          { href: routes.race(raceId), label: race.label },
          { href: routes.entity(raceId, entityId), label: chain.root_name },
          { label: "Funding chain" },
        ]}
      />
      <DataStatusBanner status={chain.data_status} />

      <DetailHeader label={`Funding chain · ${race.label}`} title={hasOut ? <>Where {chain.root_name}&apos;s money came from — and went</> : <>Where {chain.root_name}&apos;s money came from</>}>
        <div className="flex flex-wrap items-center gap-3">
          {chain.flags.map((f) => (
            <FlagBadge key={f.id} flag={f} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600">
          <Link
            href={routes.entity(raceId, entityId)}
            className="font-medium text-neutral-900 hover:underline"
          >
            ← Entity page
          </Link>
          {root?.source_url && (
            <SourceLink href={root.source_url} label="FEC committee record" />
          )}
          <span className="text-xs text-neutral-500">
            Backward walk over 2024-cycle receipts, {chain.summary.max_depth}{" "}
            {chain.summary.max_depth === 1 ? "hop" : "hops"} deep.{" "}
            {hasOut
              ? "To the right: Schedule E payments to vendors, the ads it ran, and the candidate those dollars were aimed at."
              : "Money edges only; this spender reported no independent expenditures or ads in this race, so there is no spending side to draw."}
          </span>
        </div>
      </DetailHeader>

      <SeenAdsStrip ads={verifiedAds} raceId={raceId} />
      <div className="detail-jump-nav"><SectionNav items={[{ id: "overview", label: "Overview" }, { id: "funding-map", label: "Funding map" }, { id: "receipts", label: "Every receipt" }]} /></div>
      <div id="overview" className="detail-section">
        <Card>
          <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Total receipts traced" value={<Money amount={chain.summary.total_in} />} sub={money(chain.summary.total_in, { compact: false })} />
              {chain.summary.out_total !== undefined ? (
                <Stat
                  label="Spent on this race (Schedule E)"
                  value={<Money amount={chain.summary.out_total} />}
                  sub={`${vendorCount > 0 ? `${vendorCount} ${vendorCount === 1 ? "vendor" : "vendors"} · ` : ""}${adCount} ${adCount === 1 ? "ad" : "ads"} · ${candidateCount} ${candidateCount === 1 ? "candidate" : "candidates"} targeted`}
                />
              ) : (
                <Stat label="Depth" value={chain.summary.max_depth} sub={`${chain.nodes.length} nodes · ${chain.edges.length} edges`} />
              )}
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
      </div>

      {chain.flags.length > 0 && (
        <ul className="chain-findings space-y-1 text-sm">
          {chain.flags.map((f) => (
            <li key={f.id} className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium text-amber-900">⚑ {f.label}.</span>
              <span className="text-neutral-700">{f.detail}</span>
              {f.evidence_url && (
                <SourceLink href={f.evidence_url} label="evidence" />
              )}
            </li>
          ))}
        </ul>
      )}
      <div id="funding-map" className="detail-section">
        <Card
          title={hasOut ? "Flow of money into the spender, and where it went" : "Flow of money into the spender"}
          action={
            <Legend
              items={[
                { swatch: <span className="chain-legend-root" />, label: `you are here — ${chain.root_name}, the spender this page is about` },
                { swatch: <Swatch color={VISIBILITY_COLORS.disclosed} />, label: "disclosed (FEC)" },
                { swatch: <Swatch color={VISIBILITY_COLORS.inferable} />, label: "inferable (990, lagged)" },
                { swatch: <Swatch color={UNWALKED_COLOR} />, label: "not walked (FEC committee, receipts outside this race's neighborhood)" },
                { swatch: <Swatch color={VISIBILITY_COLORS.dark} className="bg-[repeating-linear-gradient(45deg,#e24b4a_0_2px,#fdecec_2px_4px)]" />, label: "dark wall (no disclosure)" },
                { swatch: <Swatch color="#f5f5f5" className="border border-dashed border-neutral-400" />, label: "other (aggregated)" },
                ...(hasOut
                  ? [
                      {
                        swatch: <span className="inline-block h-2.5 w-2.5 rounded-sm border-2" style={{ borderColor: PLACEMENT_COLOR }} />,
                        label: "vendor / ad (spending side)",
                      },
                      {
                        swatch: <span className="inline-block h-0.5 w-5 align-middle" style={{ backgroundColor: PLACEMENT_COLOR }} />,
                        label: "placement: solid = filed or verified · dashed = inferred",
                      },
                      {
                        swatch: <span className="inline-block h-0.5 w-5 align-middle" style={{ backgroundColor: TARGETING_COLOR }} />,
                        label: "targeting (for / against) — no money reaches the candidate",
                      },
                    ]
                  : []),
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
            <ChainDiagram wire={toWire(chain, links)} hasTable />
          )}
          <p className="mt-2 text-xs text-neutral-500">
            Ribbon width is proportional to dollars; color is how the money is disclosed. Read left to right: sources → intermediaries → spender
            {hasOut && " → vendors paid → ads ⇢ candidate targeted"}. Hover a node or edge for the basics. Click a node for its details, the evidence behind each link, and the page or record
            behind it; click an edge for its evidence and its row in the table below; + / − expands or folds what hangs off it.
          </p>
          {hasOut && (
            <p className="mt-1 text-xs text-neutral-500">
              <span className="font-medium text-neutral-700">Assumptions on the spending side.</span>{" "}
              Vendor dollars are Schedule E payments as filed. Ad dollars are the midpoint of the range Google reports, not a filed figure. A vendor →
              ad edge is drawn only when a person verified it from a source naming both (solid), or the vendor was the only digital vendor the spender
              paid in the week before and while the ad ran (dashed, inferred). FEC does not record which buy placed which ad, so an ad with no such link
              hangs off the spender alone; vendors merely paid in that window are named on the ad&apos;s page as a sentence, never drawn as an edge. Targeting edges never
              carry money to the candidate.
            </p>
          )}
        </Card>
      </div>
      <div id="receipts" className="detail-section">
        <Card title={hasOut ? "Every edge, with its record — receipts, then spending" : "Receipts — every edge, with its record"}>
          <EdgeTable chain={chain} links={links} />
        </Card>
      </div>

      <p className="text-xs text-neutral-500">
        <span className="font-medium text-neutral-700">Method.</span>{" "}
        {chain.method}
      </p>
    </div>
  );
}
