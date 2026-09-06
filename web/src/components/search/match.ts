import type { SearchItem, SearchItemKind } from "@campaign-commons/contracts";

/**
 * Plain-TypeScript matcher over search.json (~2,000 rows; no fuzzy library).
 *
 * A row matches when the query is a case-insensitive substring of its label or any alias, OR every whitespace-separated
 * query token is a prefix of some token of the label/aliases ("sen lead" → SENATE LEADERSHIP FUND).
 * Ranking: match quality (exact > prefix > substring > token-prefix) then `weight` (dollars) descending.
 * Results are then grouped by kind in the order the best-ranked row of each kind appears.
 */

export type Prepared = { item: SearchItem; strings: string[]; tokens: string[] };

export const KIND_LABELS: Record<SearchItemKind, string> = {
  race: "Races",
  candidate: "Candidates",
  committee: "Committees",
  organization: "Organizations",
  donor: "Donors",
  vendor: "Vendors",
};

export const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const tokenize = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);

export function prepare(items: SearchItem[]): Prepared[] {
  return items.map((item) => {
    const strings = [item.label, ...item.aliases].map(normalize);
    return { item, strings, tokens: Array.from(new Set(strings.flatMap(tokenize))) };
  });
}

/** 4 exact, 3 prefix, 2 substring, 1 every-token-is-a-prefix, 0 no match. */
export function quality(p: Prepared, q: string): number {
  let best = 0;
  for (const s of p.strings) {
    if (s === q) return 4;
    if (s.startsWith(q)) best = Math.max(best, 3);
    else if (s.includes(q)) best = Math.max(best, 2);
  }
  if (best > 0) return best;
  const qTokens = tokenize(q);
  if (qTokens.length > 0 && qTokens.every((t) => p.tokens.some((tok) => tok.startsWith(t)))) return 1;
  return 0;
}

export type Hit = { item: SearchItem; quality: number };

/** Ranked hits (no grouping). `limit` caps the list; pass Infinity for a full-results page. */
export function rank(prepared: Prepared[], query: string, limit = 8): Hit[] {
  const q = normalize(query);
  if (!q) return [];
  const hits: Hit[] = [];
  for (const p of prepared) {
    const s = quality(p, q);
    if (s > 0) hits.push({ item: p.item, quality: s });
  }
  hits.sort((a, b) => b.quality - a.quality || b.item.weight - a.item.weight || a.item.label.localeCompare(b.item.label));
  return Number.isFinite(limit) ? hits.slice(0, limit) : hits;
}

export type Group = { kind: SearchItemKind; items: SearchItem[] };

/** Group ranked hits by kind; groups appear in the order their best hit ranked, rows keep rank order within a group. */
export function group(hits: Hit[]): Group[] {
  const groups: Group[] = [];
  for (const h of hits) {
    const g = groups.find((x) => x.kind === h.item.kind);
    if (g) g.items.push(h.item);
    else groups.push({ kind: h.item.kind, items: [h.item] });
  }
  return groups;
}

export const search = (prepared: Prepared[], query: string, limit = 8): Group[] => group(rank(prepared, query, limit));
