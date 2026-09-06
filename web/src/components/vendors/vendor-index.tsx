"use client";

import { useEffect, useMemo, useState } from "react";
import type { Medium, VendorSummary } from "@campaign-commons/contracts";
import { money } from "@/lib/format";
import { LINK_FILTER_LABELS, matchesLinkFilter, topMedium, type LinkFilter, type VendorAdContext } from "@/lib/vendors";
import { MEDIUM_LABELS } from "./medium";
import { VendorRow } from "./vendor-row";

const LINK_FILTERS: LinkFilter[] = ["any", "verified", "inferred", "none"];
const MIN_AMOUNTS = [0, 10_000, 100_000, 1_000_000, 10_000_000];
const PAGE = 25;

type Filters = { q: string; medium: Medium | ""; sponsor: string; evidence: LinkFilter; min: number };
const EMPTY: Filters = { q: "", medium: "", sponsor: "", evidence: "any", min: 0 };

const isMedium = (s: string, media: Medium[]): s is Medium => (media as string[]).includes(s);
const isLinkFilter = (s: string): s is LinkFilter => (LINK_FILTERS as string[]).includes(s);

/** `?q=&medium=&sponsor=&evidence=&min=` ⇄ state, so a filtered view is a shareable URL. Read after mount to stay static. */
const fromSearch = (search: string, media: Medium[]): Filters => {
  const p = new URLSearchParams(search);
  const medium = p.get("medium") ?? "";
  const evidence = p.get("evidence") ?? "";
  const min = Number(p.get("min") ?? 0);
  return {
    q: p.get("q") ?? "",
    medium: isMedium(medium, media) ? medium : "",
    sponsor: p.get("sponsor") ?? "",
    evidence: isLinkFilter(evidence) ? evidence : "any",
    min: MIN_AMOUNTS.includes(min) ? min : 0,
  };
};

const toSearch = (f: Filters): string => {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.medium) p.set("medium", f.medium);
  if (f.sponsor) p.set("sponsor", f.sponsor);
  if (f.evidence !== "any") p.set("evidence", f.evidence);
  if (f.min > 0) p.set("min", String(f.min));
  const s = p.toString();
  return s ? `?${s}` : "";
};

const isFiltered = (f: Filters) => toSearch(f) !== "";

/**
 * The complete vendor index behind the editorial sections: every vendor, filterable by name, medium, sponsor, the evidence
 * for its ad links and a floor on reported dollars. Disclosed a page at a time unless a filter is on. Fully static: filters
 * run in the browser. Below 680px the fields sit behind a disclosure button (CSS keeps them open on wider screens).
 */
export function VendorIndex({
  raceId,
  vendors,
  context,
  candidateNames,
}: {
  raceId: string;
  vendors: VendorSummary[];
  context: VendorAdContext;
  candidateNames: Record<string, string>;
}) {
  const media = useMemo(() => {
    const seen = new Map<Medium, number>();
    for (const v of vendors) for (const m of v.media_mix) seen.set(m.medium, (seen.get(m.medium) ?? 0) + m.amount);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  }, [vendors]);
  const sponsors = useMemo(() => {
    const seen = new Map<string, { name: string; amount: number }>();
    for (const v of vendors)
      for (const s of v.spenders) seen.set(s.entity_id, { name: s.name, amount: (seen.get(s.entity_id)?.amount ?? 0) + s.amount });
    return [...seen.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [vendors]);
  const linkCounts = useMemo(
    () => Object.fromEntries(LINK_FILTERS.map((k) => [k, vendors.filter((v) => matchesLinkFilter(context.links[v.vendor_id], k)).length])) as Record<LinkFilter, number>,
    [vendors, context],
  );

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const initial = fromSearch(window.location.search, media);
    setFilters(initial);
    if (isFiltered(initial)) setOpen(true);
  }, [media]);
  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setLimit(PAGE);
    window.history.replaceState(null, "", `${window.location.pathname}${toSearch(next)}${window.location.hash}`);
  };

  const shown = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return vendors
      .filter((v) => q === "" || v.name.toLowerCase().includes(q) || v.aliases.some((a) => a.toLowerCase().includes(q)))
      .filter((v) => filters.medium === "" || topMedium(v)?.medium === filters.medium)
      .filter((v) => filters.sponsor === "" || v.spenders.some((s) => s.entity_id === filters.sponsor))
      .filter((v) => matchesLinkFilter(context.links[v.vendor_id], filters.evidence))
      .filter((v) => v.total >= filters.min);
  }, [vendors, filters, context]);
  const visible = isFiltered(filters) ? shown : shown.slice(0, limit);
  const filterId = "vendor-filters";

  return (
    <div className="vendor-index">
      <div className="vendor-filters" data-open={open}>
        <button type="button" className="vendor-filters-toggle" aria-expanded={open} aria-controls={filterId} onClick={() => setOpen(!open)}>
          Filters{isFiltered(filters) && " · on"}
        </button>
        <div id={filterId} className="vendor-filters-fields" hidden={!open}>
          <label>
            Vendor name
            <input type="search" value={filters.q} onChange={(e) => update({ q: e.target.value })} placeholder="Search vendors" autoComplete="off" />
          </label>
          <label>
            Medium
            <select value={filters.medium} onChange={(e) => update({ medium: isMedium(e.target.value, media) ? e.target.value : "" })}>
              <option value="">Any</option>
              {media.map((m) => (
                <option key={m} value={m}>
                  {MEDIUM_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sponsor
            <select value={filters.sponsor} onChange={(e) => update({ sponsor: e.target.value })}>
              <option value="">Any</option>
              {sponsors.map(([id, s]) => (
                <option key={id} value={id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label title="A vendor is linked to an ad only when a person found a source naming both, or it was the only digital vendor the sponsor paid in the week before and while the ad ran">
            Ad links
            <select value={filters.evidence} onChange={(e) => update({ evidence: isLinkFilter(e.target.value) ? e.target.value : "any" })}>
              {LINK_FILTERS.map((k) => (
                <option key={k} value={k} disabled={linkCounts[k] === 0}>
                  {LINK_FILTER_LABELS[k]} ({linkCounts[k]})
                </option>
              ))}
            </select>
          </label>
          <label>
            Reported at least
            <select value={filters.min} onChange={(e) => update({ min: Number(e.target.value) })}>
              {MIN_AMOUNTS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "Any amount" : money(n)}
                </option>
              ))}
            </select>
          </label>
          {isFiltered(filters) && (
            <button type="button" className="vendor-filters-clear" onClick={() => update(EMPTY)}>
              Clear filters
            </button>
          )}
        </div>
      </div>
      <p role="status" aria-live="polite" className="vendor-index-count">
        {isFiltered(filters) ? `${shown.length} of ${vendors.length} vendors match.` : `${vendors.length} vendors, by reported dollars.`}
      </p>
      {shown.length === 0 ? (
        <p className="detail-empty">No vendors match these filters.</p>
      ) : (
        <ol className="vendor-list">
          {visible.map((v) => (
            <VendorRow key={v.vendor_id} raceId={raceId} vendor={v} links={context.links[v.vendor_id]} context={context.windows[v.vendor_id]} candidateNames={candidateNames} />
          ))}
        </ol>
      )}
      {visible.length < shown.length && (
        <button type="button" className="vendor-index-more" onClick={() => setLimit(shown.length)}>
          Show all {shown.length.toLocaleString("en-US")} vendors
        </button>
      )}
    </div>
  );
}
