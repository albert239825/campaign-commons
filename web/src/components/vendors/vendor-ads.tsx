import Link from "next/link";
import type { Ad, EvidenceBasis, Vendor } from "@campaign-commons/contracts";
import { BASIS_LABELS, BASIS_MEANING, BASIS_TONE } from "@/lib/evidence";
import { date, routes } from "@/lib/format";
import { Card, Chip, SourceLink } from "@/components/ui";
import { AdThumb } from "@/components/entity/ads-section";

const BASIS_ORDER: EvidenceBasis[] = ["verified", "filed", "inferred"];
const THUMBS_PER_GROUP = 8;

type Row = { link: Vendor["ads"][number]; ad: Ad };

/**
 * Ads whose run window overlapped this vendor's buys but that are not linked to it: the date fact as a sentence, drawn
 * from each ad's `same_window_buys`. Says who was paying while what ran; never that this vendor placed anything.
 */
function SameWindowAds({ raceId, vendor, ads, sponsorNames }: { raceId: string; vendor: Vendor; ads: Ad[]; sponsorNames: Record<string, string> }) {
  const linked = new Set(vendor.ads.map((l) => l.ad_id));
  const overlapping = ads.filter((ad) => !linked.has(ad.ad_id) && (ad.same_window_buys ?? []).some((b) => b.vendor_id === vendor.vendor_id));
  if (overlapping.length === 0) return null;
  const bySponsor = new Map<string, number>();
  for (const ad of overlapping) {
    const id = ad.matched_entity_id ?? ad.advertiser_name;
    bySponsor.set(id, (bySponsor.get(id) ?? 0) + 1);
  }
  return (
    <p className="text-xs text-neutral-600">
      Separately, {overlapping.length} other {overlapping.length === 1 ? "ad" : "ads"} ran while this vendor was being paid for placeable media —{" "}
      {[...bySponsor.entries()].map(([id, n], i) => (
        <span key={id}>
          {i > 0 && (i === bySponsor.size - 1 ? " and " : ", ")}
          {n} by{" "}
          <Link href={`${routes.ads(raceId)}?sponsor=${encodeURIComponent(id)}`} className="font-medium text-neutral-900 hover:underline">
            {sponsorNames[id] ?? id}
          </Link>
        </span>
      ))}
      . FEC records do not identify which vendor placed them, so they are listed here as a fact about dates, not as this vendor&apos;s ads.
    </p>
  );
}

/**
 * Ads joined to this vendor by a person's check or a stated rule, grouped by the evidence behind the link, followed by
 * the date-overlap fact as a sentence. Date overlap alone is never a link (D-74).
 */
export function VendorAds({
  raceId,
  vendor,
  ads,
  sponsorNames,
}: {
  raceId: string;
  vendor: Vendor;
  ads: Ad[];
  sponsorNames: Record<string, string>;
}) {
  const adsById = new Map(ads.map((a) => [a.ad_id, a]));
  const rows: Row[] = vendor.ads.flatMap((link) => {
    const ad = adsById.get(link.ad_id);
    return ad ? [{ link, ad }] : [];
  });
  const sameWindow = <SameWindowAds raceId={raceId} vendor={vendor} ads={ads} sponsorNames={sponsorNames} />;
  if (rows.length === 0) {
    return (
      <Card title="Ads linked to this vendor">
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">
            None. An ad is linked only when a person verified it from a source naming both, or when this was the only digital vendor its sponsor paid while
            it ran — the FEC does not record which buy placed which ad, so this is not evidence that the vendor made no ads.
          </p>
          {sameWindow}
        </div>
      </Card>
    );
  }
  const groups = BASIS_ORDER.map((basis) => ({
    basis,
    rows: rows
      .filter((r) => r.link.basis.basis === basis)
      .sort((a, b) => b.ad.spend_range.min - a.ad.spend_range.min || a.ad.ad_id.localeCompare(b.ad.ad_id)),
  })).filter((g) => g.rows.length > 0);
  const sponsors = [...new Set(rows.map((r) => r.link.sponsor_entity_id))];
  return (
    <Card title="Ads linked to this vendor">
      <p className="mb-3 text-xs text-neutral-600">
        {rows.length} {rows.length === 1 ? "ad" : "ads"} from {sponsors.length} {sponsors.length === 1 ? "spender" : "spenders"} who paid this vendor.
        The FEC does not record which buy placed which ad; each link below says what it rests on.
      </p>
      <div className="space-y-4">
        {groups.map((g) => {
          const rule = g.rows[0].link.basis.rule;
          const sameRule = g.rows.every((r) => r.link.basis.rule === rule);
          return (
            <section key={g.basis} className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Chip tone={BASIS_TONE[g.basis]} title={BASIS_MEANING[g.basis]}>
                  {BASIS_LABELS[g.basis]}
                </Chip>
                <span className="text-neutral-600">
                  {g.rows.length} {g.rows.length === 1 ? "ad" : "ads"} · {BASIS_MEANING[g.basis]}
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {g.rows.slice(0, THUMBS_PER_GROUP).map(({ ad }) => (
                  <AdThumb key={ad.ad_id} ad={ad} raceId={raceId} />
                ))}
                {g.rows.length > THUMBS_PER_GROUP && (
                  <Link
                    href={`${routes.ads(raceId)}?vendor=${encodeURIComponent(vendor.vendor_id)}`}
                    className="flex h-20 w-28 shrink-0 items-center justify-center rounded-sm border border-dashed border-neutral-300 text-xs text-neutral-600 hover:text-neutral-900"
                  >
                    +{g.rows.length - THUMBS_PER_GROUP} more
                  </Link>
                )}
              </div>
              <ul className="space-y-1 text-[11px] text-neutral-600">
                {sameRule ? (
                  <li>{rule}</li>
                ) : (
                  g.rows.map(({ link, ad }) => (
                    <li key={ad.ad_id}>
                      <Link href={routes.ad(raceId, ad.ad_id)} className="font-medium text-neutral-900 hover:underline">
                        {sponsorNames[link.sponsor_entity_id] ?? link.sponsor_entity_id}
                      </Link>
                      {ad.first_shown && (
                        <span className="text-neutral-500">
                          {" "}
                          · ran {date(ad.first_shown)}
                          {ad.last_shown && ad.last_shown !== ad.first_shown ? ` – ${date(ad.last_shown)}` : ""}
                        </span>
                      )}{" "}
                      · {link.basis.rule}
                      {link.basis.source_urls.map((u, i) => (
                        <SourceLink key={u} href={u} label={link.basis.source_urls.length > 1 ? `source ${i + 1}` : "source"} className="ml-1.5" />
                      ))}
                    </li>
                  ))
                )}
                {sameRule && g.basis === "verified" && (
                  <li className="flex flex-wrap gap-x-3">
                    {g.rows.map(({ link, ad }) => (
                      <span key={ad.ad_id}>
                        {sponsorNames[link.sponsor_entity_id] ?? link.sponsor_entity_id} · checked by {link.basis.checked_by ?? "—"}{" "}
                        {link.basis.checked_at ? date(link.basis.checked_at) : ""}
                        {link.basis.source_urls.map((u, i) => (
                          <SourceLink key={u} href={u} label={link.basis.source_urls.length > 1 ? `source ${i + 1}` : "source"} className="ml-1.5" />
                        ))}
                      </span>
                    ))}
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-neutral-500">
        Spenders in the picture:{" "}
        {sponsors.map((id, i) => (
          <span key={id}>
            {i > 0 && ", "}
            <Link href={routes.entity(raceId, id)} className="hover:underline">
              {sponsorNames[id] ?? id}
            </Link>
          </span>
        ))}
        . Ad spend is the range Google publishes; the vendor totals above are filed dollars. The two are never added together.
      </p>
      <div className="mt-3">{sameWindow}</div>
    </Card>
  );
}
