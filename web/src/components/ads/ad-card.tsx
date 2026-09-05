import Link from "next/link";
import { ISSUE_BY_ID, type Ad, type AdVendorLink } from "@campaign-commons/contracts";
import { BASIS_LABELS, BASIS_MEANING, BASIS_TONE } from "@/lib/evidence";
import { date, money, pct, range, routes } from "@/lib/format";
import { Chip, SourceLink } from "@/components/ui";
import { MEDIUM_LABELS } from "@/components/vendors/medium";

const CONFIDENCE: Record<Ad["match_confidence"], { label: string; tone: "green" | "amber" | "muted"; title: string }> = {
  verified: { label: "sponsor verified", tone: "green", title: "Advertiser → FEC committee match checked by a human" },
  auto: { label: "sponsor auto-matched", tone: "amber", title: "String match on advertiser name; not yet human-verified" },
  none: { label: "sponsor not matched to FEC committee", tone: "muted", title: "No FEC committee resolved for this advertiser" },
};

export const AD_TYPE_LABEL: Record<Ad["ad_type"], string> = { video: "Video", image: "Image", text: "Text", unknown: "Unknown format" };

export function Creative({ ad, className = "h-40" }: { ad: Ad; className?: string }) {
  if (ad.cached_creative_path) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- creatives are static files under public/, sizes unknown; next/image would need a loader.
      <img src={ad.cached_creative_path} alt={`${ad.advertiser_name} ${ad.ad_type} ad`} className={`w-full object-contain ${className}`} loading="lazy" />
    );
  }
  return (
    <div className={`flex w-full flex-col items-center justify-center gap-1 bg-[repeating-linear-gradient(135deg,#f5f5f5_0_8px,#fafafa_8px_16px)] text-neutral-500 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide">{AD_TYPE_LABEL[ad.ad_type]}</span>
      <span className="text-[11px]">creative not cached</span>
    </div>
  );
}

export const isVerified = (ad: Ad) => ad.verification?.status === "verified";
export const darkShare = (ad: Ad): number | null => ad.sponsor_visibility_shares?.dark ?? null;

export function DarkShareLine({ ad, raceId, sponsorHasChain }: { ad: Ad; raceId: string; sponsorHasChain: boolean }) {
  const dark = darkShare(ad);
  if (dark === null || !ad.matched_entity_id) return null;
  const text = `${pct(dark)} of this sponsor's traced money is dark`;
  const title = "Share of the sponsor committee's traced receipts that stopped at an organization with no donor-disclosure obligation. Describes the sponsor's funding, not this ad.";
  return (
    <p className="text-xs text-neutral-700" title={title}>
      {sponsorHasChain ? (
        <Link href={routes.chain(raceId, ad.matched_entity_id)} className="font-medium text-neutral-900 underline decoration-dotted underline-offset-2 hover:decoration-solid">
          {text}
        </Link>
      ) : (
        <span className="font-medium text-neutral-900">{text}</span>
      )}
    </p>
  );
}

export function IssueChips({ ad }: { ad: Ad }) {
  if (!ad.issues) return null;
  const title = `${ad.issues.basis.rule} (${ad.issues.basis.checked_by ?? "unknown"}, ${ad.issues.basis.checked_at ?? "—"})`;
  return (
    <div className="flex flex-wrap gap-1">
      {ad.issues.issue_ids.map((id, i) => (
        <Chip key={id} tone={i === 0 ? "neutral" : "muted"} title={title}>
          {ISSUE_BY_ID[id].label}
        </Chip>
      ))}
    </div>
  );
}

/** Full vendor-link list with each link's rule and sources; the ad page renders it, the card shows `VendorSummary`. */
export function VendorLines({ links, raceId }: { links: AdVendorLink[]; raceId: string }) {
  if (links.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1.5">
        {links.map((link) => {
          const basis = link.basis.basis;
          return (
            <li key={link.vendor_id} className="text-xs text-neutral-700">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link href={routes.vendor(raceId, link.vendor_id)} className="font-medium text-neutral-900 hover:underline">
                  {link.vendor_name}
                </Link>
                <Chip tone="muted">{MEDIUM_LABELS[link.medium]}</Chip>
                <Chip tone={BASIS_TONE[basis]} title={BASIS_MEANING[basis]}>
                  {BASIS_LABELS[basis]}
                </Chip>
                <span className="tabular-nums text-neutral-500">
                  {money(link.amount_in_window, { compact: false })} · {link.buys_in_window} {link.buys_in_window === 1 ? "buy" : "buys"}
                </span>
              </div>
              <p className="mt-0.5 text-neutral-600">{link.basis.rule}</p>
              {link.basis.source_urls.length > 0 && (
                <span className="flex flex-wrap gap-2">
                  {link.basis.source_urls.map((u, i) => (
                    <SourceLink key={u} href={u} label={link.basis.source_urls.length > 1 ? `source ${i + 1}` : "source"} />
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One line per card: vendor names with their basis; the rules and sources live on the ad page. */
function VendorSummary({ ad, raceId }: { ad: Ad; raceId: string }) {
  const links = ad.vendor_links ?? [];
  if (links.length === 0) return null;
  return (
    <p
      className="border-t border-neutral-100 pt-2 text-xs text-neutral-600"
      title="Vendors the sponsor paid whose buys fall in this ad's run window. The FEC does not record which buy placed which ad; the label says how each link was derived."
    >
      <span className="text-neutral-500">Vendors in window: </span>
      {links.map((link, i) => (
        <span key={link.vendor_id}>
          {i > 0 && ", "}
          <Link href={routes.vendor(raceId, link.vendor_id)} className="font-medium text-neutral-900 hover:underline">
            {link.vendor_name}
          </Link>{" "}
          <span className="text-neutral-500" title={BASIS_MEANING[link.basis.basis]}>
            ({BASIS_LABELS[link.basis.basis]})
          </span>
        </span>
      ))}
    </p>
  );
}

export function AdCard({
  ad,
  raceId,
  sponsorHasPage,
  sponsorHasChain,
  candidateNames,
}: {
  ad: Ad;
  raceId: string;
  sponsorHasPage: boolean;
  sponsorHasChain: boolean;
  candidateNames: Record<string, string>;
}) {
  const conf = CONFIDENCE[ad.match_confidence];
  const targets = ad.candidate_ids.map((id) => candidateNames[id] ?? id);
  const verified = isVerified(ad);
  const fecEvidence = verified ? ad.verification?.evidence_urls.find((u) => u.startsWith("https://www.fec.gov/data/committee/")) : undefined;
  return (
    <article id={ad.ad_id} className="ad-record flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white target:ring-2 target:ring-neutral-900">
      <Link
        href={routes.ad(raceId, ad.ad_id)}
        className="block border-b border-neutral-100 hover:bg-neutral-50"
        title="Open this ad's page: the creative, who was paid while it ran, and where the sponsor's money came from"
      >
        <Creative ad={ad} />
      </Link>
      <div className="ad-record-content flex flex-1 flex-col gap-2 p-3">
        <header>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold leading-tight">
              <Link href={routes.ad(raceId, ad.ad_id)} className="hover:underline">
                {ad.advertiser_name}
              </Link>
            </h3>
            <Chip tone="muted" className="shrink-0 capitalize">
              {ad.platform}
            </Chip>
          </div>
        </header>

        <div className="flex flex-wrap gap-1">
          {verified ? (
            <Chip tone="green" title="A person matched the advertiser's legal name on adstransparency.google.com to this committee's fec.gov record. Google's bulk data names the advertiser and carries no paid-for-by field for US ads.">
              sponsor verified by hand
            </Chip>
          ) : (
            <Chip tone={conf.tone} title={conf.title}>
              {conf.label}
            </Chip>
          )}
          {ad.support_oppose && targets.length > 0 && (
            <Chip tone="neutral">
              {ad.support_oppose === "S" ? "supports" : "opposes"} {targets.join(", ")}
            </Chip>
          )}
        </div>

        <DarkShareLine ad={ad} raceId={raceId} sponsorHasChain={sponsorHasChain} />
        <IssueChips ad={ad} />

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-neutral-500">Spend</dt>
          <dd className="text-right tabular-nums">{range(ad.spend_range.min, ad.spend_range.max, (n) => money(n, { compact: false }))}</dd>
          <dt className="text-neutral-500">Impressions</dt>
          <dd className="text-right tabular-nums">{range(ad.impressions_range.min, ad.impressions_range.max)}</dd>
          <dt className="text-neutral-500">Shown</dt>
          <dd className="text-right">
            {date(ad.first_shown)} – {date(ad.last_shown)}
          </dd>
          {ad.regions.length > 0 && (
            <>
              <dt className="text-neutral-500">Regions</dt>
              <dd className="text-right">{ad.regions.join(", ")}</dd>
            </>
          )}
        </dl>

        <VendorSummary ad={ad} raceId={raceId} />

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-2 text-xs">
          <span className="flex gap-3">
            <Link href={routes.ad(raceId, ad.ad_id)} className="font-medium text-neutral-900 hover:underline">
              Ad page →
            </Link>
            <SourceLink href={ad.creative_url} label="ad library record" />
            {fecEvidence && <SourceLink href={fecEvidence} label="fec.gov record" />}
          </span>
          {ad.matched_entity_id && sponsorHasPage && (
            <span className="flex gap-3">
              <Link href={routes.entity(raceId, ad.matched_entity_id)} className="font-medium text-neutral-900 hover:underline">
                Sponsor
              </Link>
              {verified && sponsorHasChain && (
                <Link
                  href={routes.chain(raceId, ad.matched_entity_id)}
                  className="font-medium text-neutral-900 hover:underline"
                  title="The advertiser-to-committee match on this card was checked by a person; follow it into the committee's funding chain"
                >
                  Verified sponsor → chain
                </Link>
              )}
            </span>
          )}
        </footer>
      </div>
    </article>
  );
}
