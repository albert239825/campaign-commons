import Link from "next/link";
import type { Ad } from "@citizen-gotham/contracts";
import { range, routes } from "@/lib/format";
import { Chip, SourceLink } from "@/components/ui";

/** Hand-verified ads paid for by this chain's root committee; the link back lands on the card in the gallery. */
export function SeenAdsStrip({ ads, raceId }: { ads: Ad[]; raceId: string }) {
  if (ads.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white p-2">
      <div className="px-1 text-xs text-neutral-600">
        <div className="font-medium text-neutral-900">You may have seen this ad</div>
        <div>Paid for by this committee; the link was checked by a person.</div>
      </div>
      {ads.map((ad) => (
        <Link
          key={ad.ad_id}
          href={`${routes.ads(raceId)}#${ad.ad_id}`}
          className="flex items-center gap-2 rounded-md border border-neutral-200 p-1 pr-2 hover:bg-neutral-50"
          title={`${ad.advertiser_name}: ${range(ad.impressions_range.min, ad.impressions_range.max)} impressions`}
        >
          {ad.cached_creative_path ? (
            // eslint-disable-next-line @next/next/no-img-element -- static file under public/, size unknown
            <img src={ad.cached_creative_path} alt={`${ad.advertiser_name} ${ad.ad_type} ad`} className="h-12 w-20 object-cover" loading="lazy" />
          ) : (
            <span className="flex h-12 w-20 items-center justify-center bg-neutral-100 text-[10px] uppercase text-neutral-500">{ad.ad_type}</span>
          )}
          <span className="text-xs">
            <Chip tone="green">verified by hand</Chip>
            <span className="mt-1 block tabular-nums text-neutral-600">{range(ad.impressions_range.min, ad.impressions_range.max)} impressions</span>
          </span>
        </Link>
      ))}
      <span className="ml-auto text-xs">
        {ads.map((ad) => (
          <SourceLink key={ad.ad_id} href={ad.source_url} label="ad library record" />
        ))}
      </span>
    </div>
  );
}
