"use client";

import { useMemo, useState } from "react";
import type { Ad } from "@citizen-gotham/contracts";
import { AdCard, isVerified } from "./ad-card";

type Sort = "spend_desc" | "spend_asc" | "recent";

const SORTS: Record<Sort, { label: string; cmp: (a: Ad, b: Ad) => number }> = {
  spend_desc: { label: "Spend: high → low", cmp: (a, b) => b.spend_range.min - a.spend_range.min },
  spend_asc: { label: "Spend: low → high", cmp: (a, b) => a.spend_range.min - b.spend_range.min },
  recent: { label: "Most recently shown", cmp: (a, b) => (b.last_shown ?? "").localeCompare(a.last_shown ?? "") },
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
  const [sort, setSort] = useState<Sort>("spend_desc");
  const entities = useMemo(() => new Set(entityIds), [entityIds]);
  const chains = useMemo(() => new Set(chainIds), [chainIds]);
  const verifiedCount = useMemo(() => ads.filter(isVerified).length, [ads]);
  const shown = useMemo(
    () =>
      ads
        .filter((a) => !matchedOnly || a.matched_entity_id !== null)
        .filter((a) => !verifiedOnly || isVerified(a))
        .sort(SORTS[sort].cmp),
    [ads, matchedOnly, verifiedOnly, sort],
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
      <p role="status" aria-live="polite" className="ad-gallery-count text-xs text-neutral-500">
        Showing {shown.length} of {ads.length} ads.
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
