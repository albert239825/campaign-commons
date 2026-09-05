import Link from "next/link";
import type { CandidateLedger } from "@citizen-gotham/contracts";
import { pct, routes } from "@/lib/format";
import { Card, Money, SourceLink } from "@/components/ui";
import { PartyTag } from "@/components/ui/party-tag";
import { BarLegend, MONEY_COLORS, StackedBar } from "@/components/ui/stacked-bar";

function Line({ label, amount, href, indent = false, strong = false }: { label: string; amount: number; href: string; indent?: boolean; strong?: boolean }) {
  return (
    <div className={`candidate-line flex items-baseline justify-between gap-3 py-1 ${indent ? "pl-4 text-neutral-600" : ""} ${strong ? "font-semibold" : ""}`}>
      <span className="truncate">{label}</span>
      <span className="flex shrink-0 items-baseline gap-2">
        <Money amount={amount} compact={false} />
        <SourceLink href={href} label="FEC" />
      </span>
    </div>
  );
}

export function CandidatePanel({ raceId, c }: { raceId: string; c: CandidateLedger }) {
  const { campaign, outside } = c;
  const other = Math.max(0, campaign.receipts - campaign.from_individuals - campaign.from_committees);
  const outsideTotal = outside.total;
  const compare = [
    { label: "Campaign receipts", value: campaign.receipts, color: MONEY_COLORS.campaign },
    { label: "Outside spending about this candidate", value: outsideTotal, color: MONEY_COLORS.outside },
  ];
  return (
    <Card
      title={
        <span className="candidate-heading flex items-center gap-2 normal-case tracking-normal">
          <PartyTag party={c.party} />
          <Link href={routes.candidate(raceId, c.candidate_id)} className="text-base font-semibold text-neutral-900 hover:underline">
            {c.name}
          </Link>
          <span className="text-xs font-normal text-neutral-500">
            {c.incumbent ? "incumbent" : "challenger"}
            {c.result && c.result !== "pending" ? ` · ${c.result}` : ""}
          </span>
        </span>
      }
      action={<SourceLink href={campaign.source_url} label="FEC candidate page" />}
    >
      <div className="text-sm">
        <div className="candidate-subheading mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Campaign committee</div>
        <Line label="Receipts" amount={campaign.receipts} href={campaign.source_url} strong />
        <Line label="Individuals (FEC summary, incl. unitemized)" amount={campaign.from_individuals} href={campaign.source_url} indent />
        <Line label="of which via conduits (ActBlue/WinRed)" amount={campaign.via_conduit_total} href={campaign.source_url} indent />
        <Line label="from committees (PACs, party)" amount={campaign.from_committees} href={campaign.source_url} indent />
        <Line label="other" amount={other} href={campaign.source_url} indent />
        <Line label="Disbursements" amount={campaign.disbursements} href={campaign.source_url} strong />
        {campaign.cash_on_hand !== undefined && <Line label="cash on hand" amount={campaign.cash_on_hand} href={campaign.source_url} indent />}

        <div className="candidate-subheading mb-1 mt-4 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Outside spending (independent expenditures)</div>
        <Line label="Supporting" amount={outside.support} href={outside.source_url} />
        <Line label="Opposing" amount={outside.oppose} href={outside.source_url} />
        <Line label="Total" amount={outsideTotal} href={outside.source_url} strong />
        <p className="mt-1 text-[11px] text-neutral-500">Targeting, not money: none of this reaches the campaign.</p>

        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between text-xs text-neutral-600">
            <span>Campaign vs outside</span>
            <span className="tabular-nums">
              {campaign.receipts + outsideTotal > 0 ? `${pct(outsideTotal / (campaign.receipts + outsideTotal))} outside` : "—"}
            </span>
          </div>
          <StackedBar segments={compare} height="h-3" />
          <BarLegend segments={compare} className="mt-1" />
        </div>

        <div className="candidate-traceability mt-4 flex items-baseline justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-600">
          <span>Traceability of outside money about this candidate</span>
          <span className="tabular-nums">
            {c.traceability_score === null ? "not yet computed" : `${pct(c.traceability_score)} preliminary`}
          </span>
        </div>
      </div>
    </Card>
  );
}
