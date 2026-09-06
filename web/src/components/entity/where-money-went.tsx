import Link from "next/link";
import type { Basis, EntityVendorRow } from "@citizen-gotham/contracts";
import { date, routes } from "@/lib/format";
import { Card, Money, SourceLink } from "@/components/ui";
import { Table, Td, Th } from "@/components/ui/table";
import { MediumBasisNote, MediumMix } from "@/components/vendors/medium";
import { TargetsLine } from "@/components/vendors/targets-line";

/** "Where the money went": this spender's IEs grouped by payee. Money edges to vendors; the candidate column is targeting only. */
export function WhereMoneyWent({
  raceId,
  rows,
  candidateNames,
  mediumBasis,
}: {
  raceId: string;
  rows: EntityVendorRow[];
  candidateNames: Record<string, string>;
  mediumBasis: Basis;
}) {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <Card
      title="Where the money went"
      action={
        <Link href={routes.vendors(raceId)} className="text-xs text-neutral-600 hover:underline">
          All vendors in this race →
        </Link>
      }
    >
      <MediumBasisNote basis={mediumBasis} className="mb-3" />
      <Table>
        <thead>
          <tr>
            <Th>Vendor</Th>
            <Th align="right">Paid</Th>
            <Th>Medium</Th>
            <Th>For / against</Th>
            <Th align="right">Buys</Th>
            <Th>First – last</Th>
            <Th align="right">Source</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.vendor_id}>
              <Td>
                <Link href={routes.vendor(raceId, r.vendor_id)} className="font-medium hover:underline">
                  {r.name}
                </Link>
              </Td>
              <Td align="right" className="font-medium">
                <Money amount={r.amount} compact={false} />
              </Td>
              <Td>
                <MediumMix mix={r.media_mix} />
              </Td>
              <Td className="text-xs">
                <TargetsLine raceId={raceId} targets={r.targets} candidateNames={candidateNames} />
              </Td>
              <Td align="right">{r.count.toLocaleString("en-US")}</Td>
              <Td className="whitespace-nowrap text-xs text-neutral-600">
                {r.first_date === r.last_date ? date(r.first_date) : `${date(r.first_date)} – ${date(r.last_date)}`}
              </Td>
              <Td align="right">
                <SourceLink href={r.source_url} label="FEC" />
              </Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <Td className="text-xs text-neutral-500">
              {rows.length} {rows.length === 1 ? "vendor" : "vendors"}
            </Td>
            <Td align="right" className="font-semibold">
              <Money amount={total} compact={false} />
            </Td>
            <Td colSpan={5} className="text-xs text-neutral-500">
              equals this committee&apos;s independent expenditures in this race
            </Td>
          </tr>
        </tfoot>
      </Table>
    </Card>
  );
}
