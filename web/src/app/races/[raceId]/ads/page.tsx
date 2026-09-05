// OWNER: Frontend B (ad gallery).
import Link from "next/link";
import { DetailHeader } from "@/components/ui/detail-layout";
import { getAds, getRace, getStories, listChainIds, listEntityIds, listRaceIds } from "@/lib/data";
import { money, range, routes } from "@/lib/format";
import { Breadcrumbs, Card, DataStatusBanner, Stat } from "@/components/ui";
import { AdGallery } from "@/components/ads/ad-gallery";
import { RaceNav } from "@/components/ui/race-nav";

export const generateStaticParams = () => listRaceIds().map((raceId) => ({ raceId }));

export default async function AdsPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const race = getRace(raceId);
  const gallery = getAds(raceId);
  const entityIds = listEntityIds(raceId);
  const chainIds = listChainIds(raceId);
  const candidateNames = Object.fromEntries(race.candidates.map((c) => [c.candidate_id, c.name]));

  const matched = gallery.ads.filter((a) => a.matched_entity_id !== null).length;
  const spendMin = gallery.ads.reduce((s, a) => s + a.spend_range.min, 0);
  const spendMax = gallery.ads.every((a) => a.spend_range.max !== null) ? gallery.ads.reduce((s, a) => s + (a.spend_range.max ?? 0), 0) : null;
  const sponsors = new Set(gallery.ads.map((a) => a.advertiser_id)).size;

  return (
    <div className="detail-page ads-page">
      <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { href: routes.race(raceId), label: race.label }, { label: "Ads" }]} />
      <DataStatusBanner status={gallery.data_status} />
      <RaceNav race={race} counts={{ ads: gallery.ads.length, stories: getStories(raceId).stories.length }} active={routes.ads(raceId)} />

      <DetailHeader label={race.label} title="Political ads">
        <p className="max-w-3xl text-sm text-neutral-600">
          Ads about this race from platform transparency libraries ({gallery.sources.join(", ") || "none loaded"}). Spend and impressions are the ranges the
          platform publishes, not exact figures. Where the advertiser resolves to an FEC committee, the card links to its{" "}
          <Link href={routes.race(raceId)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            ledger entry
          </Link>{" "}
          and funding chain.
        </p>
      </DetailHeader>

      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Ads" value={gallery.ads.length} sub={`${sponsors} ${sponsors === 1 ? "advertiser" : "advertisers"}`} />
          <Stat label="Matched to FEC committee" value={matched} sub={gallery.ads.length > 0 ? `${gallery.ads.length - matched} unmatched` : undefined} />
          <Stat label="Total spend (platform ranges)" value={gallery.ads.length > 0 ? range(spendMin, spendMax, (n) => money(n)) : "—"} sub="sum of per-ad ranges" />
          <Stat label="Sources" value={gallery.sources.length} sub={gallery.sources.join(", ") || "—"} />
        </div>
      </Card>

      <AdGallery ads={gallery.ads} raceId={raceId} entityIds={entityIds} chainIds={chainIds} candidateNames={candidateNames} />

      {gallery.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-neutral-500">
          {gallery.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
