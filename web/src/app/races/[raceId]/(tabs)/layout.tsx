import type { ReactNode } from "react";
import { getAds, getLedger, getRace, hasTrails } from "@/lib/data";
import { DataStatusBanner } from "@/components/ui";
import { RaceBanner } from "@/components/race/race-banner";
import { RaceNav } from "@/components/ui/race-nav";

export default async function RaceTabsLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ raceId: string }>;
}>) {
  const { raceId } = await params;
  const race = getRace(raceId);
  const ledger = getLedger(raceId);
  const adCount = getAds(raceId).ads.length;

  return (
    <div className="race-dashboard">
      <div>
        <DataStatusBanner status={ledger.data_status} />
        <RaceBanner race={race} />
        <RaceNav race={race} counts={{ ads: adCount }} trails={hasTrails(raceId)} />
      </div>
      {children}
    </div>
  );
}
