import {
  DISCLOSED_SPLIT_COLORS,
  DISCLOSED_SPLIT_LABELS,
  UNWALKED_COLOR,
  UNWALKED_LABEL,
  VISIBILITY_COLORS,
  VISIBILITY_LABELS,
  type VisibilityShares,
} from "@campaign-commons/contracts";
import { pct } from "@/lib/format";

export type Shares = Omit<VisibilityShares, "unwalked"> & { unwalked?: number };

type Bucket = "disclosed" | "disclosed_individuals" | "disclosed_organizations" | "inferable" | "unwalked" | "dark";
export const BUCKET_COLORS: Record<Bucket, string> = { ...VISIBILITY_COLORS, ...DISCLOSED_SPLIT_COLORS, unwalked: UNWALKED_COLOR };
export const BUCKET_LABELS: Record<Bucket, string> = { ...VISIBILITY_LABELS, ...DISCLOSED_SPLIT_LABELS, unwalked: UNWALKED_LABEL };
const SHORT: Record<Bucket, string> = {
  disclosed: "disclosed",
  disclosed_individuals: "individuals",
  disclosed_organizations: "organizations",
  inferable: "inferable",
  unwalked: "not walked",
  dark: "dark",
};

/**
 * Stacked disclosed / inferable / not-walked / dark bar. Shares are 0..1 and should sum to ~1. When the
 * individuals / organizations split is present, disclosed is drawn as two adjacent segments of the same hue.
 */
export function ShareBar({ shares, className = "" }: { shares: Shares; className?: string }) {
  const split = shares.disclosed_organizations !== undefined;
  const order: Bucket[] = [...(split ? (["disclosed_individuals", "disclosed_organizations"] as const) : (["disclosed"] as const)), "inferable", "unwalked", "dark"];
  const value = (b: Bucket) => (b === "disclosed_individuals" ? shares.disclosed_individuals ?? shares.disclosed - (shares.disclosed_organizations ?? 0) : shares[b]) ?? 0;
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-sm bg-neutral-200" role="img" aria-label={order.map((b) => `${BUCKET_LABELS[b]} ${pct(value(b))}`).join(", ")}>
        {order.filter((b) => value(b) > 0).map((b) => (
          <div key={b} style={{ width: `${value(b) * 100}%`, backgroundColor: BUCKET_COLORS[b] }} title={`${BUCKET_LABELS[b]} · ${pct(value(b), 1)}`} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-neutral-600">
        {order.filter((b) => b !== "unwalked" || shares.unwalked !== undefined).map((b) => (
          <span key={b} className="inline-flex items-center gap-1" title={BUCKET_LABELS[b]}>
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: BUCKET_COLORS[b] }} />
            {SHORT[b]} {pct(value(b))}
          </span>
        ))}
      </div>
    </div>
  );
}
