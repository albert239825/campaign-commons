/**
 * What the ads say about each vendor, folded once per race for the Vendors index. Two separate facts, never merged:
 *   links   — Ad.vendor_links: a rule or a person joined this vendor to an ad (basis verified | inferred)
 *   windows — Ad.same_window_buys: the sponsor paid this vendor for placeable media in the week before / while an ad ran,
 *             linked or not. Context only; the FEC does not record which buy placed which ad (D-74).
 */
import type { Ad, EvidenceBasis, VendorSummary } from "@campaign-commons/contracts";

export type VendorLinks = { ads: number; verified: number; inferred: number; sponsors: number };
export type VendorWindow = { ads: number; sponsors: number };
export type VendorAdContext = {
  links: Record<string, VendorLinks>;
  windows: Record<string, VendorWindow>;
  ads: number;
  adsWithLinks: number;
  adsWithWindowContext: number;
};

export const vendorAdContext = (ads: Ad[]): VendorAdContext => {
  const links = new Map<string, VendorLinks & { sponsorIds: Set<string> }>();
  const windows = new Map<string, VendorWindow & { sponsorIds: Set<string> }>();
  let adsWithLinks = 0;
  let adsWithWindowContext = 0;
  for (const ad of ads) {
    const sponsor = ad.matched_entity_id ?? ad.advertiser_id;
    const vendorLinks = ad.vendor_links ?? [];
    if (vendorLinks.length > 0) adsWithLinks += 1;
    for (const l of vendorLinks) {
      const hit = links.get(l.vendor_id) ?? { ads: 0, verified: 0, inferred: 0, sponsors: 0, sponsorIds: new Set<string>() };
      hit.ads += 1;
      hit[l.basis.basis === "verified" ? "verified" : "inferred"] += 1;
      hit.sponsorIds.add(sponsor);
      links.set(l.vendor_id, hit);
    }
    const context = ad.same_window_buys ?? [];
    if (context.length > 0) adsWithWindowContext += 1;
    for (const b of context) {
      const hit = windows.get(b.vendor_id) ?? { ads: 0, sponsors: 0, sponsorIds: new Set<string>() };
      hit.ads += 1;
      hit.sponsorIds.add(sponsor);
      windows.set(b.vendor_id, hit);
    }
  }
  return {
    links: Object.fromEntries([...links].map(([id, { sponsorIds, ...rest }]) => [id, { ...rest, sponsors: sponsorIds.size }])),
    windows: Object.fromEntries([...windows].map(([id, { sponsorIds, ...rest }]) => [id, { ...rest, sponsors: sponsorIds.size }])),
    ads: ads.length,
    adsWithLinks,
    adsWithWindowContext,
  };
};

/** The strongest evidence behind any of this vendor's ad links; null when nothing links it to an ad (payments are still filed). */
export const linkEvidence = (links: VendorLinks | undefined): Exclude<EvidenceBasis, "filed"> | null =>
  !links || links.ads === 0 ? null : links.verified > 0 ? "verified" : "inferred";

export type LinkFilter = "any" | "verified" | "inferred" | "none";
export const LINK_FILTER_LABELS: Record<LinkFilter, string> = {
  any: "Any",
  verified: "Has verified links",
  inferred: "Has inferred links",
  none: "No linked ads",
};

export const matchesLinkFilter = (links: VendorLinks | undefined, want: LinkFilter): boolean => {
  const n = links?.ads ?? 0;
  if (want === "any") return true;
  if (want === "none") return n === 0;
  return (links?.[want] ?? 0) > 0;
};

/** The medium most of this vendor's dollars went to; null when nothing was classified. */
export const topMedium = (v: VendorSummary) => [...v.media_mix].sort((a, b) => b.amount - a.amount)[0] ?? null;
