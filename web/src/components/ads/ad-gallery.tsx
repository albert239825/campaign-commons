"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ISSUE_BY_ID, type Ad, type IssueId } from "@campaign-commons/contracts";
import { AdCard, darkShare, isVerified } from "./ad-card";

type Sort = "spend_desc" | "spend_asc" | "recent" | "dark_desc";
type LinkBasis = "any" | "verified" | "inferred" | "adjacent" | "none";

const SORTS: Record<Sort, { label: string; cmp: (a: Ad, b: Ad) => number }> = {
  spend_desc: { label: "Spend: high → low", cmp: (a, b) => b.spend_range.min - a.spend_range.min },
  spend_asc: { label: "Spend: low → high", cmp: (a, b) => a.spend_range.min - b.spend_range.min },
  recent: { label: "Most recently shown", cmp: (a, b) => (b.last_shown ?? "").localeCompare(a.last_shown ?? "") },
  dark_desc: { label: "Sponsor dark share: high → low", cmp: (a, b) => (darkShare(b) ?? -1) - (darkShare(a) ?? -1) || b.spend_range.min - a.spend_range.min },
};

const LINK_BASIS: Record<LinkBasis, string> = {
  any: "Any vendor link",
  verified: "Only verified vendor links",
  inferred: "Only inferred vendor links",
  adjacent: "Only adjacent vendor links",
  none: "No vendor links",
};
const LINK_BASIS_ORDER: LinkBasis[] = ["any", "verified", "inferred", "adjacent", "none"];

const hasLinkBasis = (ad: Ad, want: LinkBasis): boolean => {
  const links = ad.vendor_links ?? [];
  if (want === "none") return links.length === 0;
  if (want === "any") return links.length > 0;
  return links.some((l) => l.basis.basis === want);
};

export function AdGallery({
  ads,
  raceId,
  entityIds,
  chainIds,
  candidateNames,
}: {
  ads: Ad[];
  raceId: string;
  entityIds: string[];
  chainIds: string[];
  candidateNames: Record<string, string>;
}) {
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sponsor, setSponsor] = useState<string | null>(null);
  const [vendor, setVendor] = useState<string | null>(null);
  // `?sponsor=<committee_id>` / `?vendor=<vendor_id>` are read after mount so the page stays fully static (no useSearchParams bail-out).
  const pendingHash = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sponsorFromUrl = params.get("sponsor");
    const vendorFromUrl = params.get("vendor");
    if (!sponsorFromUrl && !vendorFromUrl) return;
    pendingHash.current = window.location.hash || null;
    if (sponsorFromUrl) setSponsor(sponsorFromUrl);
    if (vendorFromUrl) setVendor(vendorFromUrl);
  }, []);
  // Applying a URL filter remounts the cards; re-run the fragment navigation so `:target` and scroll land on the new card.
  useEffect(() => {
    if ((sponsor === null && vendor === null) || pendingHash.current === null) return;
    window.location.replace(pendingHash.current);
    pendingHash.current = null;
  }, [sponsor, vendor]);
  const [issue, setIssue] = useState<IssueId | "">("");
  const [linkBasis, setLinkBasis] = useState<LinkBasis | "">("");
  const [sort, setSort] = useState<Sort>("spend_desc");
  const entities = useMemo(() => new Set(entityIds), [entityIds]);
  const chains = useMemo(() => new Set(chainIds), [chainIds]);
  const verifiedCount = useMemo(() => ads.filter(isVerified).length, [ads]);
  const taggedCount = useMemo(() => ads.filter((a) => a.issues !== undefined).length, [ads]);
  const withSharesCount = useMemo(() => ads.filter((a) => darkShare(a) !== null).length, [ads]);
  const linkedCount = useMemo(() => ads.filter((a) => (a.vendor_links ?? []).length > 0).length, [ads]);
  // Only offer link-basis filters that match at least one ad, so a reader never picks an always-empty option.
  const linkBasisOptions = useMemo(
    () => LINK_BASIS_ORDER.map((k) => [k, ads.filter((a) => hasLinkBasis(a, k)).length] as const).filter(([, n]) => n > 0),
    [ads],
  );
  const taggedIssues = useMemo(() => {
    const counts = new Map<IssueId, number>();
    for (const ad of ads) for (const id of ad.issues?.issue_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1]);
  }, [ads]);
  const sponsorName = useMemo(() => (sponsor ? ads.find((a) => a.matched_entity_id === sponsor)?.advertiser_name ?? sponsor : null), [ads, sponsor]);
  const vendorName = useMemo(
    () => (vendor ? ads.flatMap((a) => a.vendor_links ?? []).find((l) => l.vendor_id === vendor)?.vendor_name ?? vendor : null),
    [ads, vendor],
  );
  const shown = useMemo(
    () =>
      ads
        .filter((a) => !matchedOnly || a.matched_entity_id !== null)
        .filter((a) => !verifiedOnly || isVerified(a))
        .filter((a) => sponsor === null || a.matched_entity_id === sponsor)
        .filter((a) => vendor === null || (a.vendor_links ?? []).some((l) => l.vendor_id === vendor))
        .filter((a) => issue === "" || (a.issues?.issue_ids ?? []).includes(issue))
        .filter((a) => linkBasis === "" || hasLinkBasis(a, linkBasis))
        .sort(SORTS[sort].cmp),
    [ads, matchedOnly, verifiedOnly, sponsor, vendor, issue, linkBasis, sort],
  );

  return (
    <div className="ad-gallery space-y-3">
      <div className="ad-gallery-controls flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={matchedOnly} onChange={(e) => setMatchedOnly(e.target.checked)} className="h-3.5 w-3.5 accent-neutral-900" />
          Only ads with a matched FEC sponsor
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2" title="Advertiser matched to its FEC committee by a person, using adstransparency.google.com and fec.gov">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="h-3.5 w-3.5 accent-neutral-900" />
          Verified ({verifiedCount})
        </label>
        <label className="inline-flex items-center gap-2 text-neutral-600" title="Only ads a person has tagged from the creative can be filtered by issue">
          Issue
          <select value={issue} onChange={(e) => setIssue(e.target.value as IssueId | "")} className="rounded-sm border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900" disabled={taggedIssues.length === 0}>
            <option value="">{taggedIssues.length === 0 ? "No ads tagged yet" : "Any (tagged or not)"}</option>
            {taggedIssues.map(([id, n]) => (
              <option key={id} value={id}>
                {ISSUE_BY_ID[id].label} ({n})
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-neutral-600" title="Vendor links are time-window co-occurrences with the sponsor's reported buys; the label says how each was derived">
          Vendor links
          <select value={linkBasis} onChange={(e) => setLinkBasis(e.target.value as LinkBasis | "")} className="rounded-sm border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900">
            <option value="">Any ({linkedCount} linked)</option>
            {linkBasisOptions.map(([k, n]) => (
              <option key={k} value={k}>
                {LINK_BASIS[k]} ({n})
              </option>
            ))}
          </select>
        </label>
        <label className="ml-auto inline-flex items-center gap-2 text-neutral-600">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-sm border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900">
            {(Object.keys(SORTS) as Sort[]).map((k) => (
              <option key={k} value={k}>
                {SORTS[k].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {sponsor !== null && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-sm border border-neutral-300 bg-white px-2 py-0.5">
            Sponsor: <span className="font-medium">{sponsorName}</span>
          </span>
          <button type="button" onClick={() => setSponsor(null)} className="text-xs text-neutral-600 underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            show all sponsors
          </button>
        </p>
      )}
      {vendor !== null && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-sm border border-neutral-300 bg-white px-2 py-0.5" title="Ads whose run window overlapped this vendor's reported buys; the link basis on each card says how">
            Ran during buys by: <span className="font-medium">{vendorName}</span>
          </span>
          <button type="button" onClick={() => setVendor(null)} className="text-xs text-neutral-600 underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            show all vendors
          </button>
        </p>
      )}
      <p role="status" aria-live="polite" className="ad-gallery-count text-xs text-neutral-500">
        Showing {shown.length} of {ads.length} ads. {taggedCount} of {ads.length} ads tagged by a person; {withSharesCount} carry the sponsor&apos;s dark share; {linkedCount} carry vendor
        links.
      </p>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-10 text-center text-sm text-neutral-500">
          {ads.length === 0 ? "No ads loaded for this race yet." : "No ads match this filter."}
        </p>
      ) : (
        <div className="ad-gallery-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((ad) => (
            <AdCard key={ad.ad_id} ad={ad} raceId={raceId} sponsorHasPage={ad.matched_entity_id !== null && entities.has(ad.matched_entity_id)}
              sponsorHasChain={ad.matched_entity_id !== null && chains.has(ad.matched_entity_id)} candidateNames={candidateNames} />
          ))}
        </div>
      )}
    </div>
  );
}
