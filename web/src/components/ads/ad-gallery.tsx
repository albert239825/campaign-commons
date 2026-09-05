"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ISSUE_BY_ID, type Ad, type IssueId } from "@citizen-gotham/contracts";
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
  // `?sponsor=<committee_id>` is read after mount so the page stays fully static (no useSearchParams bail-out).
  const pendingHash = useRef<string | null>(null);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("sponsor");
    if (!fromUrl) return;
    pendingHash.current = window.location.hash || null;
    setSponsor(fromUrl);
  }, []);
  // Applying the URL sponsor filter remounts the cards; re-run the fragment navigation so `:target` and scroll land on the new card.
  useEffect(() => {
    if (sponsor === null || pendingHash.current === null) return;
    window.location.replace(pendingHash.current);
    pendingHash.current = null;
  }, [sponsor]);
  const [issue, setIssue] = useState<IssueId | "">("");
  const [linkBasis, setLinkBasis] = useState<LinkBasis | "">("");
  const [sort, setSort] = useState<Sort>("spend_desc");
  const entities = useMemo(() => new Set(entityIds), [entityIds]);
  const chains = useMemo(() => new Set(chainIds), [chainIds]);
  const verifiedCount = useMemo(() => ads.filter(isVerified).length, [ads]);
  const taggedCount = useMemo(() => ads.filter((a) => a.issues !== undefined).length, [ads]);
  const withSharesCount = useMemo(() => ads.filter((a) => darkShare(a) !== null).length, [ads]);
  const linkedCount = useMemo(() => ads.filter((a) => (a.vendor_links ?? []).length > 0).length, [ads]);
  const taggedIssues = useMemo(() => {
    const counts = new Map<IssueId, number>();
    for (const ad of ads) for (const id of ad.issues?.issue_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1]);
  }, [ads]);
  const sponsorName = useMemo(() => (sponsor ? ads.find((a) => a.matched_entity_id === sponsor)?.advertiser_name ?? sponsor : null), [ads, sponsor]);
  const shown = useMemo(
    () =>
      ads
        .filter((a) => !matchedOnly || a.matched_entity_id !== null)
        .filter((a) => !verifiedOnly || isVerified(a))
        .filter((a) => sponsor === null || a.matched_entity_id === sponsor)
        .filter((a) => issue === "" || (a.issues?.issue_ids ?? []).includes(issue))
        .filter((a) => linkBasis === "" || hasLinkBasis(a, linkBasis))
        .sort(SORTS[sort].cmp),
    [ads, matchedOnly, verifiedOnly, sponsor, issue, linkBasis, sort],
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
            {(Object.keys(LINK_BASIS) as LinkBasis[]).map((k) => (
              <option key={k} value={k}>
                {LINK_BASIS[k]}
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
