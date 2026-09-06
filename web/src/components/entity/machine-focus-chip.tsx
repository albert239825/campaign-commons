import { ISSUE_BY_ID, type MachineIssueFocus } from "@campaign-commons/contracts";
import { Chip, SourceLink } from "@/components/ui";
import { FOCUS_KIND_LABELS } from "@/components/issues/focus-kind";
import { date } from "@/lib/format";

function normalizeQuote(value: string): string {
  return value
    .trim()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
}

function hostname(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

function provenanceDate(focus: MachineIssueFocus): string {
  const value = focus.provenance.tagged_at || focus.provenance.retrieved_at;
  return value ? date(value.slice(0, 10)) : focus.label;
}

/** Machine layer beside FocusChip: self-description found on the org's own website by the enrichment stage. Never "spent on". */
export function MachineFocusChip({ focus }: { focus: MachineIssueFocus }) {
  const primary = focus.issue_ids[0];
  const label = primary ? `${FOCUS_KIND_LABELS[focus.kind]} · ${ISSUE_BY_ID[primary].label}` : FOCUS_KIND_LABELS[focus.kind];
  const status = focus.provenance.review_status;
  const showQuote = normalizeQuote(focus.quote) !== normalizeQuote(focus.description);
  return (
    <section className="machine-focus">
      <div className="machine-head">Machine-tagged self-description · not part of the record</div>
      <div className="mt-3 flex flex-wrap gap-1">
        <Chip title={focus.basis.rule}>{label}</Chip>
        {focus.issue_ids.slice(1).map((id) => (
          <Chip key={id} tone="muted" title={focus.basis.rule}>
            {ISSUE_BY_ID[id].label}
          </Chip>
        ))}
      </div>
      <p className="machine-summary mt-3">{focus.description}</p>
      {showQuote && <blockquote className="machine-quote">“{focus.quote}”</blockquote>}
      <p className="machine-provenance">
        {focus.basis.source_urls.map((url, index) => (
          <span key={url}>
            {index > 0 && " "}
            <SourceLink href={url} label={hostname(url)} />
          </span>
        ))}
        {" · "}
        {focus.provenance.model} · {provenanceDate(focus)} · {status === "accepted" ? "human-accepted" : "pending review"}
      </p>
    </section>
  );
}
