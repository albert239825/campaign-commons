import Link from "next/link";
import type { Ad, DonorView } from "@campaign-commons/contracts";
import { money, routes } from "@/lib/format";
import { Card } from "@/components/ui";

type Row = { id: string; name: string; depth: number; amount: number; parentName: string | null; ads: Ad[] };

/**
 * Committees in the donor's forward walk that sponsor ads in the gallery. Amounts are the reported totals on the
 * money edge into that committee — for depth 1 that is this donor's own gift; deeper it is a pooled transfer total.
 * Copy never says the donor's money bought or placed an ad.
 */
export function CommitteeAdsLinks({ view, raceId, adsBySponsor }: { view: DonorView; raceId: string; adsBySponsor: Map<string, Ad[]> }) {
  const names = new Map(view.nodes.map((n) => [n.id, n.name]));
  const parentOf = new Map(view.edges.filter((e) => e.kind === "money").map((e) => [e.to, e.from]));
  const rows: Row[] = view.nodes
    .filter((n) => n.kind === "committee" && n.depth >= 1)
    .flatMap((n) => {
      const ads = adsBySponsor.get(n.id);
      if (!ads || ads.length === 0) return [];
      const parent = parentOf.get(n.id);
      return [{ id: n.id, name: n.name, depth: n.depth, amount: n.amount, parentName: parent && parent !== view.donor_id ? names.get(parent) ?? parent : null, ads }];
    })
    .sort((a, b) => a.depth - b.depth || b.ads.length - a.ads.length);
  if (rows.length === 0) return null;
  const pooled = rows.some((r) => r.depth > 1);
  return (
    <Card title="Ads run by committees in this walk">
      <ul className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
            <span>
              <Link href={routes.entity(raceId, r.id)} className="font-medium text-neutral-900 hover:underline">
                {r.name}
              </Link>
              {r.depth === 1 ? (
                <>, which received {money(r.amount, { compact: false })} from this donor,</>
              ) : (
                <>
                  , which received {money(r.amount, { compact: false })} from {r.parentName ?? "an upstream committee"} (pooled total, not this donor&apos;s share),
                </>
              )}
            </span>
            <Link href={`${routes.ads(raceId)}?sponsor=${encodeURIComponent(r.id)}`} className="text-xs font-medium text-neutral-900 underline decoration-dotted underline-offset-2 hover:decoration-solid">
              ran {r.ads.length} {r.ads.length === 1 ? "ad" : "ads"} →
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">
        Ads are attached to a committee because Google&apos;s advertiser name matched its FEC registration. Ads ran alongside these money edges; the dollar figures
        {pooled ? " past the donor's own gifts are the reported totals between the two parties, not this donor's share, and " : " "}
        say nothing about which dollars paid for which ad.
      </p>
    </Card>
  );
}
