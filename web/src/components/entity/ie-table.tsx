import Link from "next/link";
import type { IndependentExpenditure } from "@citizen-gotham/contracts";
import { date, routes } from "@/lib/format";
import { Money, SourceLink } from "@/components/ui";
import { EmptyRow, Table, Td, Th } from "@/components/ui/table";

export function IeTable({ raceId, rows }: { raceId: string; rows: IndependentExpenditure[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>S/O</Th>
          <Th>Target</Th>
          <Th align="right">Amount</Th>
          <Th>Payee · purpose</Th>
          <Th align="right">Source</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow colSpan={6}>No independent expenditures reported in this race.</EmptyRow>}
        {rows.map((ie) => (
          <tr key={ie.ie_id}>
            <Td className="whitespace-nowrap text-xs text-neutral-600">{date(ie.date)}</Td>
            <Td>
              <span className={`font-semibold ${ie.support_oppose === "S" ? "text-neutral-900" : "text-dark"}`} title={ie.support_oppose === "S" ? "Supports" : "Opposes"}>
                {ie.support_oppose}
              </span>
            </Td>
            <Td>
              <Link href={routes.candidate(raceId, ie.candidate_id)} className="hover:underline">
                {ie.candidate_name}
              </Link>
            </Td>
            <Td align="right" className="font-medium">
              <Money amount={ie.amount} compact={false} />
            </Td>
            <Td className="text-xs text-neutral-600">
              {ie.payee ?? "—"}
              {ie.purpose ? <span className="text-neutral-400"> · {ie.purpose}</span> : null}
            </Td>
            <Td align="right">
              <SourceLink href={ie.source_url} label="FEC" />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
