import Link from "next/link";
import type { RaceSummary } from "@campaign-commons/contracts";
import { routes } from "@/lib/format";
import { getRaceSections } from "@/lib/data";

/**
 * The race section a page belongs to. Candidate dossiers are keyed by candidate id so the nav never hardcodes a name;
 * `null` is for records (committee, chain, donor) that hang off the ledger rather than any one section.
 */
export type RaceSection = "overview" | "ads" | "vendors" | "stories" | "trails" | `candidate:${string}` | null;

export const candidateSection = (candidateId: string): RaceSection => `candidate:${candidateId}`;

type Item = { section: RaceSection; href: string; label: string; count?: number };

const surname = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;

/**
 * Section tabs for one race. Items come from the race's data: a dossier tab per candidate with a dossier file,
 * Money Trails only when trails.json exists. `record` marks a page inside `section` (an ad, a vendor, an answer)
 * rather than the section index itself.
 */
export function RaceNav({ race, section, record = false }: { race: RaceSummary; section: RaceSection; record?: boolean }) {
  const raceId = race.race_id;
  const sections = getRaceSections(raceId);
  const items: Item[] = [
    { section: "overview", href: routes.race(raceId), label: "Overview" },
    { section: "ads", href: routes.ads(raceId), label: "Ads", count: sections.ads },
    ...(sections.vendors === null ? [] : [{ section: "vendors" as const, href: routes.vendors(raceId), label: "Vendors", count: sections.vendors }]),
    { section: "stories", href: routes.stories(raceId), label: "Stories", count: sections.stories },
    ...race.candidates
      .filter((c) => sections.dossiers.includes(c.candidate_id))
      .map((c) => ({ section: candidateSection(c.candidate_id), href: routes.candidate(raceId, c.candidate_id), label: `${surname(c.name)} Dossier` })),
    ...(sections.trails ? [{ section: "trails" as const, href: routes.ask(raceId), label: "Money Trails" }] : []),
  ];
  return (
    <nav aria-label="Race sections" className="race-nav">
      {items.map((it) => {
        const on = section !== null && it.section === section;
        return (
          <Link key={it.href} href={it.href} aria-current={on ? (record ? "true" : "page") : undefined}>
            {it.label}
            {it.count !== undefined && <small>{it.count.toLocaleString("en-US")}</small>}
          </Link>
        );
      })}
    </nav>
  );
}
