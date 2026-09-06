import { DISCLOSED_SPLIT_COLORS, DISCLOSED_SPLIT_LABELS, UNWALKED_COLOR, VISIBILITY_COLORS, type VisibilityShares } from "@campaign-commons/contracts";

export type BarSegment = { label: string; value: number; color: string };

/** Horizontal stacked bar. Segments are proportional to `value`; zero-total renders an empty track. */
export function StackedBar({
  segments,
  height = "h-2",
  className = "",
}: {
  segments: BarSegment[];
  height?: string;
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  return (
    <div className={`flex w-full overflow-hidden rounded-sm bg-neutral-100 ${height} ${className}`} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} title={s.label} />
          ))}
    </div>
  );
}

export function BarLegend({ segments, className = "" }: { segments: BarSegment[]; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-600 ${className}`}>
      {segments.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Neutral palette for campaign-vs-outside comparisons (not a visibility statement). */
export const MONEY_COLORS = { campaign: "#1f2937", outside: "#a3a3a3" } as const;

export type VisibilityInput = Omit<VisibilityShares, "unwalked"> & { unwalked?: number };

/**
 * Disclosed / inferable / (not walked) / dark, in that order; `unwalked` is omitted when the data predates the bucket.
 * When the individuals / organizations split is present, disclosed is drawn as two adjacent segments of the same hue.
 */
export const visibilitySegments = (v: VisibilityInput): BarSegment[] => [
  ...(v.disclosed_organizations === undefined
    ? [{ label: "Disclosed", value: v.disclosed, color: VISIBILITY_COLORS.disclosed }]
    : [
        { label: DISCLOSED_SPLIT_LABELS.disclosed_individuals, value: v.disclosed_individuals ?? v.disclosed - v.disclosed_organizations, color: DISCLOSED_SPLIT_COLORS.disclosed_individuals },
        { label: "Disclosed · organizations", value: v.disclosed_organizations, color: DISCLOSED_SPLIT_COLORS.disclosed_organizations },
      ]),
  { label: "Inferable", value: v.inferable, color: VISIBILITY_COLORS.inferable },
  ...(v.unwalked === undefined ? [] : [{ label: "Not walked", value: v.unwalked, color: UNWALKED_COLOR }]),
  { label: "Dark", value: v.dark, color: VISIBILITY_COLORS.dark },
];
