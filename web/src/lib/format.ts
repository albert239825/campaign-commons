export function money(n: number, opts: { compact?: boolean } = { compact: true }): string {
  if (opts.compact) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function pct(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}

export function range(min: number, max: number | null, fmt: (n: number) => string = (n) => n.toLocaleString("en-US")): string {
  return max === null ? `${fmt(min)}+` : `${fmt(min)}–${fmt(max)}`;
}

export function date(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** File stem of a donor view for a chain-node id; mirrors pipeline/campaign_commons/donors.py `donor_key`. */
export const donorKey = (nodeId: string) => nodeId.split("@")[0].replace(/[^A-Za-z0-9_-]/g, "-");

/** Routes, in one place so children don't drift. */
export const routes = {
  home: () => "/",
  races: () => "/#races",
  race: (raceId: string) => `/races/${raceId}`,
  entity: (raceId: string, entityId: string) => `/races/${raceId}/entities/${entityId}`,
  chain: (raceId: string, entityId: string) => `/races/${raceId}/chains/${entityId}`,
  ads: (raceId: string) => `/races/${raceId}/ads`,
  ad: (raceId: string, adId: string) => `/races/${raceId}/ads/${adId}`,
  vendors: (raceId: string) => `/races/${raceId}/vendors`,
  vendor: (raceId: string, vendorId: string) => `/races/${raceId}/vendors/${vendorId}`,
  stories: (raceId: string) => `/races/${raceId}/stories`,
  donor: (raceId: string, donorKey: string) => `/races/${raceId}/donors/${donorKey}`,
  candidate: (raceId: string, candidateId: string) => `/races/${raceId}/candidates/${candidateId}`,
  ask: (raceId: string) => `/races/${raceId}/ask`,
  personalize: () => "/personalize",
  methodology: () => "/methodology",
};
