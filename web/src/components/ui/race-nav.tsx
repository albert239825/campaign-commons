"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { routes } from "@/lib/format";
import type { RaceSummary } from "@campaign-commons/contracts";

type Item = { href: string; label: string; count?: number };

/** Top-level tabs for one race. Dossiers and vendor pages are reached from the ledger, not from here. */
export function RaceNav({ race, counts, trails = false }: { race: RaceSummary; counts: { ads: number }; trails?: boolean }) {
  const pathname = usePathname() ?? "";
  const current = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const raceId = race.race_id;
  const items: Item[] = [
    { href: routes.race(raceId), label: "Ledger" },
    { href: routes.ads(raceId), label: "Ads", count: counts.ads },
    { href: routes.policies(raceId), label: "Policies" },
    ...(trails ? [{ href: routes.ask(raceId), label: "Money Trails" }] : []),
  ];
  return (
    <nav aria-label="Race sections" className="flex flex-wrap gap-1 border-b border-neutral-200 text-sm">
      {items.map((it) => {
        const href = it.href.length > 1 ? it.href.replace(/\/+$/, "") : it.href;
        const on = href === current || (it.href === routes.ask(raceId) && current.startsWith(href + "/"));
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
