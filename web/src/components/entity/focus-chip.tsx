import { ISSUE_BY_ID, type IssueFocus } from "@campaign-commons/contracts";
import { Chip, SourceLink } from "@/components/ui";
import { FOCUS_KIND_LABELS } from "@/components/issues/focus-kind";

/** Layer A on the entity page: what the organisation says it is for, in its own words. Never "spent on". */
export function FocusChip({ focus }: { focus: IssueFocus }) {
  const primary = focus.issue_ids[0];
  const label = primary ? `${FOCUS_KIND_LABELS[focus.kind]} · ${ISSUE_BY_ID[primary].label}` : FOCUS_KIND_LABELS[focus.kind];
  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">Self-described focus</span>
        <Chip title={focus.basis.rule}>{label}</Chip>
        {focus.issue_ids.slice(1).map((id) => (
          <Chip key={id} tone="muted" title={focus.basis.rule}>
            {ISSUE_BY_ID[id].label}
          </Chip>
        ))}
      </div>
      <p className="mt-1.5 text-sm text-neutral-800" title={focus.basis.rule}>
        {focus.description}
      </p>
      {focus.basis.basis === "verified" && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {focus.basis.source_urls.map((u) => (
            <SourceLink key={u} href={u} label={new URL(u).hostname.replace(/^www\./, "")} />
          ))}
          <span className="text-[11px] text-neutral-500">
            verified · checked by {focus.basis.checked_by} {focus.basis.checked_at}
          </span>
        </div>
      )}
      <p className="mt-1 text-[11px] text-neutral-500">{focus.basis.rule}.</p>
    </div>
  );
}
