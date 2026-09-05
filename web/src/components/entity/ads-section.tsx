import Link from "next/link";
import type { Ad } from "@citizen-gotham/contracts";
import { money, range, routes } from "@/lib/format";
import { Card, Chip, SourceLink } from "@/components/ui";

const THUMBS = 12;

/** Sum of the platform's per-ad spend ranges; the max is null when any ad has an open-ended top. */
export function spendRangeSum(ads: Ad[]): { min: number; max: number | null } {
  const min = ads.reduce((s, a) => s + a.spend_range.min, 0);
  const max = ads.every((a) => a.spend_range.max !== null) ? ads.reduce((s, a) => s + (a.spend_range.max ?? 0), 0) : null;
  return { min, max };
}

function Thumb({ ad, raceId }: { ad: Ad; raceId: string }) {
  const href = `${routes.ads(raceId)}?sponsor=${encodeURIComponent(ad.matched_entity_id ?? "")}#${ad.ad_id}`;
  const title = `${ad.ad_type} ad, ${range(ad.spend_range.min, ad.spend_range.max, (n) => money(n, { compact: false }))}, first shown ${ad.first_shown ?? "—"}`;
  return (
    <Link href={href} title={title} className="block h-20 w-28 shrink-0 overflow-hidden rounded-sm border border-neutral-200 bg-neutral-50 hover:ring-2 hover:ring-neutral-900">
      {ad.cached_creative_path ? (
        // eslint-disable-next-line @next/next/no-img-element -- static creatives under public/, sizes unknown
        <img src={ad.cached_creative_path} alt={`${ad.advertiser_name} ${ad.ad_type} ad`} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
          {ad.ad_type}
          <span className="normal-case tracking-normal">{money(ad.spend_range.min)}+</span>
        </span>
      )}
    </Link>
  );
}

export function AdsSection({ raceId, entityId, ads }: { raceId: string; entityId: string; ads: Ad[] }) {
  if (ads.length === 0) return null;
  const sorted = [...ads].sort((a, b) => b.spend_range.min - a.spend_range.min);
  const spend = spendRangeSum(sorted);
  const verified = sorted.filter((a) => a.verification?.status === "verified").length;
  const tagged = sorted.filter((a) => a.issues !== undefined).length;
  const galleryHref = `${routes.ads(raceId)}?sponsor=${encodeURIComponent(entityId)}`;
  const advertiserUrl = sorted[0].creative_url.replace(/\/creative\/.*$/, "?region=US");
  return (
    <Card
      title="Ads this committee ran"
      action={
        <Link href={galleryHref} className="text-xs font-medium text-neutral-900 hover:underline">
          All {sorted.length} in the gallery →
        </Link>
      }
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="text-2xl font-semibold tabular-nums">{sorted.length}</span> <span className="text-neutral-600">{sorted.length === 1 ? "ad" : "ads"}</span>
        </span>
        <span className="tabular-nums">
          {range(spend.min, spend.max, (n) => money(n))} <span className="text-neutral-500">spend (sum of the platform&apos;s per-ad ranges)</span>
        </span>
        <span className="flex gap-1">
          {verified > 0 && (
            <Chip tone="green" title="A person matched the advertiser's legal name to this committee's fec.gov record">
              {verified} sponsor-verified
            </Chip>
          )}
          {tagged > 0 && <Chip tone="neutral">{tagged} tagged by a person</Chip>}
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {sorted.slice(0, THUMBS).map((ad) => (
          <Thumb key={ad.ad_id} ad={ad} raceId={raceId} />
        ))}
        {sorted.length > THUMBS && (
          <Link href={galleryHref} className="flex h-20 w-28 shrink-0 items-center justify-center rounded-sm border border-dashed border-neutral-300 text-xs text-neutral-600 hover:text-neutral-900">
            +{sorted.length - THUMBS} more
          </Link>
        )}
      </div>
      <p className="mt-2 text-[11px] text-neutral-500">
        Google shows the advertiser, not the paid-for-by line; these ads are attached to this committee because the advertiser&apos;s name matched its FEC
        registration{verified > 0 ? ` (${verified} checked by a person)` : ""}. Spend is the range Google publishes, not a filed figure.{" "}
        <SourceLink href={advertiserUrl} label="advertiser page" />
      </p>
    </Card>
  );
}
