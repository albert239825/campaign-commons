import Link from "next/link";
import type { RaceSummary } from "@campaign-commons/contracts";
import { date, pct, routes } from "@/lib/format";
import { Money } from "@/components/ui";
import { PartyTag } from "@/components/ui/party-tag";
import { MONEY_COLORS, StackedBar } from "@/components/ui/stacked-bar";
import { Td } from "@/components/ui/table";

export function RaceRow({ race }: { race: RaceSummary }) {
  const stub = race.status === "stub";
  const { campaign_receipts, outside_spending, outside_share } = race.totals;
  return (
    <tr className={stub ? "text-neutral-400" : ""}>
      <Td>
        {stub ? (
          <span className="font-medium">{race.label}</span>
        ) : (
          <Link href={routes.race(race.race_id)} className="font-medium text-neutral-900 hover:underline">
            {race.label}
          </Link>
        )}
        <div className="mt-0.5 text-xs text-neutral-500">
          {date(race.election_date)}
          {stub && (
            <span className="ml-2 rounded-sm border border-dashed border-neutral-400 px-1 py-px text-[10px] uppercase tracking-wide text-neutral-500">
              stub · no data yet
            </span>
          )}
        </div>
      </Td>
      <Td>
        {race.candidates.length === 0 ? (
          <span className="text-xs text-neutral-400">—</span>
        ) : (
          <ul className="space-y-0.5">
            {race.candidates.map((c) => (
              <li key={c.candidate_id} className="flex items-center gap-1.5 whitespace-nowrap">
                <PartyTag party={c.party} />
                <span>{c.name}</span>
                {c.incumbent && <span className="text-[10px] uppercase tracking-wide text-neutral-400">inc.</span>}
                {c.result === "won" && <span className="text-[10px] uppercase tracking-wide text-neutral-500">won</span>}
              </li>
            ))}
          </ul>
        )}
      </Td>
      <Td align="right">
        <Money amount={campaign_receipts} />
      </Td>
      <Td align="right">
        <Money amount={outside_spending} />
      </Td>
      <Td className="min-w-40">
        <div className="flex items-center gap-2">
          <StackedBar
            segments={[
              { label: "Campaign", value: campaign_receipts, color: MONEY_COLORS.campaign },
              { label: "Outside", value: outside_spending, color: MONEY_COLORS.outside },
            ]}
            className="flex-1"
          />
          <span className="w-10 text-right text-xs tabular-nums">{stub ? "—" : pct(outside_share)}</span>
        </div>
      </Td>
      <Td align="right">
        {race.traceability_score === null ? (
          <span className="text-xs text-neutral-400">not yet computed</span>
        ) : (
          <>
            <span className="font-semibold">{pct(race.traceability_score)}</span>
            <div className="text-[10px] uppercase tracking-wide text-neutral-400">preliminary</div>
          </>
        )}
      </Td>
      <Td align="right" className="text-xs">
        <span className="capitalize">{race.status}</span>
        {race.data_status !== "real" && (
          <div className="text-[10px] uppercase tracking-wide text-amber-700">{race.data_status} data</div>
        )}
      </Td>
    </tr>
  );
}
