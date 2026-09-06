import Link from "next/link";
import { routes } from "@/lib/format";
import type { RaceSummary } from "@campaign-commons/contracts";

type Item = { href: string; label: string; count?: number };

/** Section tabs for one race: ledger, ads, vendors, stories, and the candidates' stances. */
export function RaceNav({ race, counts, active }: { race: RaceSummary; counts: { ads: number; stories: number; vendors?: number }; active: string }) {
  const raceId = race.race_id;
  const items: Item[] = [
    { href: routes.race(raceId), label: "Ledger" },
    { href: routes.ads(raceId), label: "Ads", count: counts.ads },
    { href: routes.vendors(raceId), label: "Vendors", count: counts.vendors },
    { href: routes.stories(raceId), label: "Stories", count: counts.stories },
    { href: routes.stances(raceId), label: "Stances" },
  ];
  return (
    <nav aria-label="Race sections" className="flex flex-wrap gap-1 border-b border-neutral-200 text-sm">
      {items.map((it) => {
        const on = it.href === active;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={on ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 ${on ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"}`}
          >
            {it.label}
            {it.count !== undefined && <span className="ml-1.5 text-xs tabular-nums text-neutral-400">{it.count.toLocaleString("en-US")}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
