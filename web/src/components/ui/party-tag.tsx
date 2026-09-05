import type { Party } from "@citizen-gotham/contracts";

const PARTY_STYLES: Record<Party, string> = {
  DEM: "bg-blue-50 text-blue-800 border-blue-200",
  REP: "bg-red-50 text-red-800 border-red-200",
  LIB: "bg-yellow-50 text-yellow-800 border-yellow-200",
  GRE: "bg-green-50 text-green-800 border-green-200",
  IND: "bg-neutral-100 text-neutral-700 border-neutral-300",
  CON: "bg-neutral-100 text-neutral-700 border-neutral-300",
  OTH: "bg-neutral-100 text-neutral-700 border-neutral-300",
};

export function PartyTag({ party }: { party: Party }) {
  return <span className={`inline-block rounded-sm border px-1 py-px text-[10px] font-semibold leading-tight ${PARTY_STYLES[party]}`}>{party}</span>;
}
