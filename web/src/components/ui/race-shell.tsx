import type { ReactNode } from "react";
import type { DataStatus, RaceSummary } from "@campaign-commons/contracts";
import { routes } from "@/lib/format";
import { Breadcrumbs, DataStatusBanner } from "@/components/ui";
import { RaceNav, type RaceSection } from "@/components/ui/race-nav";

type Crumb = { href?: string; label: string };

/**
 * The frame every race-scoped page sits in: breadcrumbs back to the race, the data-status banner, the page's own
 * header (a `DetailHeader` or the overview banner), then the race section tabs, then the page.
 *
 * `crumbs` are the trail *below* the race ("Ads", then the ad's title); omit for the overview. `record` is for pages
 * inside a section (one ad, one vendor, one answer): the tab stays marked but as the parent, not the current page.
 * `variant="dashboard"` keeps the overview's own grid (`.race-dashboard`); everything else is a `.detail-page`.
 */
export function RaceShell({
  race,
  section,
  record,
  status,
  crumbs,
  header,
  variant = "detail",
  className = "",
  children,
}: {
  race: RaceSummary;
  section: RaceSection;
  record?: boolean;
  status?: DataStatus;
  crumbs?: Crumb[];
  header: ReactNode;
  variant?: "detail" | "dashboard";
  className?: string;
  children: ReactNode;
}) {
  const frame = variant === "dashboard" ? "race-dashboard" : "detail-page";
  const items: Crumb[] = crumbs ? [{ href: routes.races(), label: "Races" }, { href: routes.race(race.race_id), label: race.label }, ...crumbs] : [];
  return (
    <div className={`${frame} ${className}`.trim()}>
      {items.length > 0 && <Breadcrumbs items={items} />}
      {variant === "dashboard" ? (
        <div>
          {status && <DataStatusBanner status={status} />}
          {header}
          <RaceNav race={race} section={section} record={record} />
        </div>
      ) : (
        <>
          {status && <DataStatusBanner status={status} />}
          {header}
          <RaceNav race={race} section={section} record={record} />
        </>
      )}
      {children}
    </div>
  );
}
