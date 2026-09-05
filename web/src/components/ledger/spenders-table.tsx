"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  COMMITTEE_TYPE_LABELS,
  UNWALKED_LABEL,
  type OutsideSpender,
  type RaceCandidate,
} from "@citizen-gotham/contracts";
import { pct, routes } from "@/lib/format";
import { FlagBadge, Money, SourceLink } from "@/components/ui";
import {
  BarLegend,
  StackedBar,
  visibilitySegments,
} from "@/components/ui/stacked-bar";
import { EmptyRow, Table, Td, Th } from "@/components/ui/table";

type SortKey = "total" | "name" | "traceability";

export function SpendersTable({
  raceId,
  spenders,
  candidates,
}: {
  raceId: string;
  spenders: OutsideSpender[];
  candidates: RaceCandidate[];
}) {
  const [sort, setSort] = useState<SortKey>("total");
  const [desc, setDesc] = useState(true);
  const byId = useMemo(
    () => new Map(candidates.map((c) => [c.candidate_id, c])),
    [candidates],
  );

  const rows = useMemo(() => {
    const cmp: Record<
      SortKey,
      (a: OutsideSpender, b: OutsideSpender) => number
    > = {
      total: (a, b) => a.total - b.total,
      name: (a, b) => a.name.localeCompare(b.name),
      traceability: (a, b) =>
        (a.traceability_score ?? -1) - (b.traceability_score ?? -1),
    };
    const sorted = [...spenders].sort(cmp[sort]);
    return desc ? sorted.reverse() : sorted;
  }, [spenders, sort, desc]);

  const toggle = (k: SortKey) => {
    if (k === sort) setDesc(!desc);
    else {
      setSort(k);
      setDesc(k !== "name");
    }
  };
  const arrow = (k: SortKey) => (k === sort ? (desc ? " ↓" : " ↑") : "");
  const sortable = "cursor-pointer select-none hover:text-neutral-900";

  return (
    <div>
      <Table>
        <thead>
          <tr>
            <Th
              className={sortable}
              onClick={() => toggle("name")}
              aria-sort={
                sort === "name" ? (desc ? "descending" : "ascending") : "none"
              }
            >
              Spender{arrow("name")}
            </Th>
            <Th>Type</Th>
            <Th>Supports / opposes</Th>
            <Th
              align="right"
              className={sortable}
              onClick={() => toggle("total")}
              aria-sort={
                sort === "total" ? (desc ? "descending" : "ascending") : "none"
              }
            >
              In race{arrow("total")}
            </Th>
            <Th>Visibility of receipts</Th>
            <Th
              align="right"
              className={sortable}
              onClick={() => toggle("traceability")}
              aria-sort={
                sort === "traceability"
                  ? desc
                    ? "descending"
                    : "ascending"
                  : "none"
              }
            >
              Traceability{arrow("traceability")}
            </Th>
            <Th>Flags</Th>
            <Th align="right">Links</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow colSpan={8}>
              No independent expenditures reported in this race yet.
            </EmptyRow>
          )}
          {rows.map((s) => {
            return (
              <tr key={s.entity_id}>
                <Td>
                  <Link
                    href={routes.entity(raceId, s.entity_id)}
                    className="font-medium hover:underline"
                  >
                    {s.name}
                  </Link>
                  <div className="font-mono text-[10px] text-neutral-400">
                    {s.entity_id}
                  </div>
                </Td>
                <Td className="text-xs text-neutral-600">
                  {s.committee_type
                    ? COMMITTEE_TYPE_LABELS[s.committee_type]
                    : s.committee_type_label}
                </Td>
                <Td>
                  <ul className="space-y-0.5 text-xs">
                    {s.by_candidate.map((bc) => (
                      <li
                        key={`${bc.candidate_id}-${bc.support_oppose}`}
                        className="flex items-baseline gap-1.5 whitespace-nowrap"
                      >
                        <span
                          className={`w-3 font-semibold ${bc.support_oppose === "S" ? "text-neutral-900" : "text-dark"}`}
                        >
                          {bc.support_oppose}
                        </span>
                        <span className="text-neutral-700">
                          {byId.get(bc.candidate_id)?.name ?? bc.candidate_id}
                        </span>
                        <Money
                          amount={bc.amount}
                          className="text-neutral-500"
                        />
                      </li>
                    ))}
                  </ul>
                </Td>
                <Td align="right" className="font-semibold">
                  <Money amount={s.total} />
                </Td>
                <Td>
                  {s.visibility_shares ? (
                    <div className="w-24">
                      <StackedBar
                        segments={visibilitySegments(s.visibility_shares)}
                      />
                    </div>
                  ) : (
                    <span
                      className="text-xs text-neutral-400"
                      title="No chain: this filer reports no receipts to walk"
                    >
                      no chain
                    </span>
                  )}
                </Td>
                <Td align="right">
                  {s.traceability_score === null ? (
                    <span className="text-xs text-neutral-400">—</span>
                  ) : (
                    pct(s.traceability_score)
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {s.flags.map((f) => (
                      <FlagBadge key={f} flag={f} />
                    ))}
                  </div>
                </Td>
                <Td align="right" className="whitespace-nowrap text-xs">
                  <Link
                    href={routes.entity(raceId, s.entity_id)}
                    className="hover:underline"
                  >
                    entity
                  </Link>
                  {s.has_chain && (
                    <>
                      <span className="mx-1 text-neutral-300">·</span>
                      <Link
                        href={routes.chain(raceId, s.entity_id)}
                        className="hover:underline"
                      >
                        chain
                      </Link>
                    </>
                  )}
                  <span className="mx-1 text-neutral-300">·</span>
                  <SourceLink href={s.source_url} label="FEC" />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <BarLegend
        className="mt-2"
        segments={visibilitySegments({
          disclosed: 1,
          inferable: 1,
          unwalked: 1,
          dark: 1,
        }).map((s) =>
          s.label === "Not walked" ? { ...s, label: UNWALKED_LABEL } : s,
        )}
      />
    </div>
  );
}
