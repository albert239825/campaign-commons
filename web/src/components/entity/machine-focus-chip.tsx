import { ISSUE_BY_ID, type MachineIssueFocus } from "@campaign-commons/contracts";
import { Chip, SourceLink } from "@/components/ui";
import { FOCUS_KIND_LABELS } from "@/components/issues/focus-kind";

/** Machine layer beside FocusChip: self-description found on the org's own website by the enrichment stage. Never "spent on". */
export function MachineFocusChip({ focus }: { focus: MachineIssueFocus }) {
  const primary = focus.issue_ids[0];
  const label = primary ? `${FOCUS_KIND_LABELS[focus.kind]} · ${ISSUE_BY_ID[primary].label}` : FOCUS_KIND_LABELS[focus.kind];
  const status = focus.provenance.review_status;
  return (
    <div className="machine-focus mt-3 rounded-md border border-dashed border-violet-300 bg-violet-50/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-violet-700">Machine-tagged self-description · not part of the record</span>
        <Chip title={focus.basis.rule}>{label}</Chip>
        {focus.issue_ids.slice(1).map((id) => (
          <Chip key={id} tone="muted" title={focus.basis.rule}>
            {ISSUE_BY_ID[id].label}
          </Chip>
        ))}
        <Chip tone={status === "accepted" ? "green" : "amber"} title="Human review status of this machine row">
          {status === "accepted" ? "human-accepted" : "pending review"}
        </Chip>
      </div>
      <p className="mt-1.5 text-sm text-neutral-800">{focus.description}</p>
      <blockquote className="mt-1 border-l-2 border-neutral-200 pl-2 text-sm text-neutral-700">“{focus.quote}”</blockquote>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {focus.basis.source_urls.map((u) => (
          <SourceLink key={u} href={u} label={new URL(u).hostname.replace(/^www\./, "")} />
        ))}
        <span className="text-[11px] text-neutral-500">{focus.label}</span>
      </div>
    </div>
  );
}
