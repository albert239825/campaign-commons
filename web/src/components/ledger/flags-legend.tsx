import { FLAG_LABELS, type FlagId } from "@campaign-commons/contracts";

const FLAG_MEANINGS: Record<FlagId, string> = {
  popup: "Registered within ~60 days of the election, reported independent expenditures, and had filed no donor report at the time.",
  single_transfer_funded: "Roughly 90% or more of itemized receipts came from one counterparty (a committee, organization, or person).",
  shell_cluster: "Shares a street address, registered agent, or treasurer with other committees in this race.",
  dead_end_dark: "Backward walk reaches an organization with no donor-disclosure obligation (501(c)(4), LLC).",
  one_way_valve_violation: "Data shows a money edge from a super PAC to a candidate or party committee; this should not occur and is surfaced for review.",
  transfer_mismatch: "The sender's Schedule B and the receiver's Schedule A disagree by more than 1%.",
};

export function FlagsLegend({ flags }: { flags: FlagId[] }) {
  const ids = Array.from(new Set(flags));
  if (ids.length === 0) return null;
  return (
    <dl className="flags-legend grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
      {ids.map((id) => (
        <div key={id} className="flex gap-2">
          <dt className="shrink-0 font-medium text-amber-900">⚑ {FLAG_LABELS[id]}</dt>
          <dd className="text-neutral-600">{FLAG_MEANINGS[id]}</dd>
        </div>
      ))}
    </dl>
  );
}
