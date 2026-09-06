import Link from "next/link";
import { UNWALKED_COLOR, UNWALKED_LABEL, VISIBILITY_COLORS, type Traceability } from "@campaign-commons/contracts";
import { pct, routes } from "@/lib/format";
import { Card, Money } from "@/components/ui";
import { BarLegend, StackedBar, visibilitySegments } from "@/components/ui/stacked-bar";

export function TraceabilityCard({ t }: { t: Traceability | null }) {
  if (!t) {
    return (
      <Card title="Traceability">
        <div className="text-3xl font-semibold text-neutral-400">not yet computed</div>
        <p className="mt-2 text-sm text-neutral-600">
          The share of outside dollars that resolve to a named source (an individual, business or union). Appears once transfer chains have been walked.{" "}
          <Link href={routes.methodology()} className="underline decoration-dotted underline-offset-2">
            Method
          </Link>
        </p>
      </Card>
    );
  }
  const segs = visibilitySegments({ disclosed: t.traced_to_individuals, inferable: t.inferable, unwalked: t.unwalked, dark: t.dark });
  return (
    <Card title="Traceability of outside money">
      <div className="traceability-summary flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <div className="traceability-score text-5xl font-semibold leading-none tabular-nums">{pct(t.score)}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-neutral-500">
            {t.preliminary ? "preliminary · " : ""}disclosed share of <Money amount={t.outside_total} /> outside
          </div>
        </div>
        <div className="traceability-breakdown min-w-64 flex-1">
          <StackedBar segments={segs} height="h-4" />
          <div className={`mt-1.5 grid gap-2 text-xs ${segs.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
            {segs.map((s) => (
              <div key={s.label}>
                <div className="flex items-center gap-1 text-neutral-600">
                  <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
                  {s.label}
                </div>
                <div className="font-medium tabular-nums">
                  <Money amount={s.value} />
                  <span className="ml-1 text-neutral-500">{t.outside_total > 0 ? pct(s.value / t.outside_total) : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-neutral-600">{t.method}</p>
      <BarLegend
        className="mt-2"
        segments={[
          { label: "Disclosed = resolves to a named individual, business or union in FEC filings", value: 1, color: VISIBILITY_COLORS.disclosed },
          { label: "Inferable = reconstructable from IRS 990s, lagged", value: 1, color: VISIBILITY_COLORS.inferable },
          ...(t.unwalked === undefined ? [] : [{ label: `${UNWALKED_LABEL} — neither disclosed nor dark`, value: 1, color: UNWALKED_COLOR }]),
          { label: "Dark = stops at an organization whose own funding is not on file (501(c)(4), LLC, trust)", value: 1, color: VISIBILITY_COLORS.dark },
        ]}
      />
    </Card>
  );
}
