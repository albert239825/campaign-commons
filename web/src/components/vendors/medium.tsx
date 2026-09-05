import type { Basis, Medium } from "@campaign-commons/contracts";
import { pct } from "@/lib/format";
import { Chip, SourceLink } from "@/components/ui";
import { BarLegend, StackedBar, type BarSegment } from "@/components/ui/stacked-bar";

export type MediumSlice = { medium: Medium; amount: number; count: number };

export const MEDIUM_LABELS: Record<Medium, string> = {
  tv: "TV",
  radio: "radio",
  digital: "digital",
  mail: "mail",
  phones: "phones",
  production: "production",
  consulting: "consulting",
  other: "other",
};

/** Greys, darkest for placement media; a medium is a classification, not a judgement, so no colour carries meaning. */
export const MEDIUM_COLORS: Record<Medium, string> = {
  tv: "#1f2937",
  digital: "#4b5563",
  radio: "#6b7280",
  mail: "#9ca3af",
  phones: "#b5bcc6",
  production: "#c9ced6",
  consulting: "#dde1e6",
  other: "#eef0f3",
};

const MEDIUM_ORDER: Medium[] = ["tv", "digital", "radio", "mail", "phones", "production", "consulting", "other"];

export const mediumSegments = (mix: MediumSlice[]): BarSegment[] =>
  MEDIUM_ORDER.filter((m) => mix.some((s) => s.medium === m && s.amount > 0)).map((m) => ({
    label: MEDIUM_LABELS[m],
    value: mix.filter((s) => s.medium === m).reduce((a, s) => a + s.amount, 0),
    color: MEDIUM_COLORS[m],
  }));

/** One-line "TV 80% · digital 20%" as chips; shares are of the row's own total. */
export function MediumMix({ mix, max = 3 }: { mix: MediumSlice[]; max?: number }) {
  const total = mix.reduce((s, m) => s + m.amount, 0);
  if (total <= 0) return <span className="text-xs text-neutral-400">—</span>;
  const sorted = [...mix].sort((a, b) => b.amount - a.amount);
  const shown = sorted.slice(0, max);
  const rest = sorted.slice(max).reduce((s, m) => s + m.amount, 0);
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((m) => (
        <Chip key={m.medium} tone={m.medium === "other" ? "muted" : "neutral"} title={`${m.count} ${m.count === 1 ? "buy" : "buys"}`}>
          {MEDIUM_LABELS[m.medium]} {pct(m.amount / total)}
        </Chip>
      ))}
      {rest > 0 && <Chip tone="muted">+{pct(rest / total)}</Chip>}
    </span>
  );
}

/** Stacked bar of dollars by medium with a legend. */
export function MediumBar({ mix, height = "h-4", className = "" }: { mix: MediumSlice[]; height?: string; className?: string }) {
  const segs = mediumSegments(mix);
  return (
    <div className={className}>
      <StackedBar segments={segs} height={height} />
      <BarLegend segments={segs} className="mt-1.5" />
    </div>
  );
}

/**
 * The stage-wide rule behind every `medium` shown on the page (VendorIndex.medium_basis). Render once per page,
 * next to the first medium the reader sees; the caveat sentence is fixed copy from the Block 2 plan.
 */
export function MediumBasisNote({ basis, className = "" }: { basis: Basis; className?: string }) {
  return (
    <div className={`space-y-1 text-[11px] text-neutral-500 ${className}`}>
      <p>Medium is classified from the purpose the spender filed; the FEC does not record which buy placed which ad.</p>
      <p>
        <span className="font-medium uppercase tracking-wide text-neutral-400">{basis.basis} · rule</span> {basis.rule}
        {basis.source_urls.map((u) => (
          <SourceLink key={u} href={u} label="Schedule E fields" className="ml-1.5" />
        ))}
      </p>
    </div>
  );
}
