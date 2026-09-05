import Link from "next/link";
import type { Transfer } from "@citizen-gotham/contracts";
import { date, money, routes } from "@/lib/format";
import { Money, SourceLink, VisibilityDot } from "@/components/ui";
import { EmptyRow, Table, Td, Th } from "@/components/ui/table";

export function Counterparty({ raceId, id, name, linkable }: { raceId: string; id: string; name: string; linkable: boolean }) {
  return linkable ? (
    <Link href={routes.entity(raceId, id)} className="font-medium hover:underline">
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  );
}

const limitLabel = (l: Transfer["limit"]) => (l === null ? "—" : l === "unlimited" ? "unlimited" : money(l, { compact: false }));

/** Money edges into or out of the entity. `direction` picks which side is the counterparty. */
export function FlowsTable({
  raceId,
  rows,
  direction,
  raceEntityIds,
  emptyText,
}: {
  raceId: string;
  rows: Transfer[];
  direction: "in" | "out";
  raceEntityIds: Set<string>;
  emptyText: string;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>{direction === "in" ? "From" : "To"}</Th>
          <Th>Date</Th>
          <Th>Type</Th>
          <Th align="right">Limit</Th>
          <Th align="right">Amount</Th>
          <Th align="right">Source</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow colSpan={6}>{emptyText}</EmptyRow>}
        {rows.map((t) => {
          const id = direction === "in" ? t.from_entity_id : t.to_entity_id;
          const name = direction === "in" ? t.from_name : t.to_name;
          return (
            <tr key={t.transfer_id}>
              <Td>
                <span className="flex items-center gap-2">
                  <VisibilityDot visibility={t.visibility} />
                  <Counterparty raceId={raceId} id={id} name={name} linkable={raceEntityIds.has(id)} />
                </span>
              </Td>
              <Td className="whitespace-nowrap text-xs text-neutral-600">{date(t.date)}</Td>
              <Td className="font-mono text-xs text-neutral-600">{t.transaction_type ?? "—"}</Td>
              <Td align="right" className="text-xs text-neutral-600">
                {limitLabel(t.limit)}
              </Td>
              <Td align="right" className="font-medium">
                <Money amount={t.amount} compact={false} />
              </Td>
              <Td align="right">
                <SourceLink href={t.source_url} label="FEC" />
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
