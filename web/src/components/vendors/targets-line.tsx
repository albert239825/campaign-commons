import Link from "next/link";
import type { EntityVendorRow } from "@citizen-gotham/contracts";
import { money, routes } from "@/lib/format";

export type Target = EntityVendorRow["targets"][number];

/** "for Casey $1.2M · against McCormick $300K" — the spender's own S/O declaration; IE dollars go to the vendor, not the candidate. */
export function TargetsLine({ raceId, targets, candidateNames }: { raceId: string; targets: Target[]; candidateNames: Record<string, string> }) {
  if (targets.length === 0) return <span className="text-neutral-400">—</span>;
  const sorted = [...targets].sort((a, b) => b.amount - a.amount);
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
      {sorted.map((t) => (
        <span key={`${t.support_oppose}:${t.candidate_id}`} className="whitespace-nowrap">
          <span className={t.support_oppose === "S" ? "text-neutral-900" : "text-dark"}>{t.support_oppose === "S" ? "for" : "against"}</span>{" "}
          <Link href={routes.candidate(raceId, t.candidate_id)} className="hover:underline">
            {candidateNames[t.candidate_id] ?? t.candidate_id}
          </Link>{" "}
          <span className="tabular-nums text-neutral-500">{money(t.amount)}</span>
        </span>
      ))}
    </span>
  );
}
