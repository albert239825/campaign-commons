/**
 * Shared primitives. Both frontend children may ADD components here (new files in ui/), but must not
 * change the signatures of the ones below without a note in docs/DECISIONS.md.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import {
  FLAG_LABELS,
  VISIBILITY_COLORS,
  VISIBILITY_LABELS,
  type DataStatus,
  type Flag,
  type FlagId,
  type Visibility,
} from "@citizen-gotham/contracts";
import { money } from "@/lib/format";

export { Chip, type ChipTone } from "./chip";
export { Legend, Swatch, type LegendItem } from "./legend";
export { ShareBar } from "./share-bar";

/** Link out to the government record. Every visible number should sit next to one of these. */
export function SourceLink({ href, label = "source", className = "" }: { href: string; label?: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`text-xs text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900 ${className}`}
    >
      {label} ↗
    </a>
  );
}

export function Money({ amount, compact = true, className = "" }: { amount: number; compact?: boolean; className?: string }) {
  return (
    <span className={`tabular-nums ${className}`} title={money(amount, { compact: false })}>
      {money(amount, { compact })}
    </span>
  );
}

export function VisibilityDot({ visibility, className = "" }: { visibility: Visibility; className?: string }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${className}`}
      style={{ backgroundColor: VISIBILITY_COLORS[visibility] }}
      title={VISIBILITY_LABELS[visibility]}
      aria-label={VISIBILITY_LABELS[visibility]}
    />
  );
}

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ borderColor: VISIBILITY_COLORS[visibility], color: VISIBILITY_COLORS[visibility] }}
    >
      <VisibilityDot visibility={visibility} />
      {VISIBILITY_LABELS[visibility]}
    </span>
  );
}

export function FlagBadge({ flag }: { flag: Flag | FlagId }) {
  const id = typeof flag === "string" ? flag : flag.id;
  const detail = typeof flag === "string" ? undefined : flag.detail;
  return (
    <span
      className="inline-flex items-center rounded-sm border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
      title={detail}
    >
      ⚑ {FLAG_LABELS[id]}
    </span>
  );
}

/** Shown at the top of every page whose data isn't real yet. Never remove; the pipeline flips the flag. */
export function DataStatusBanner({ status }: { status: DataStatus }) {
  if (status === "real") return null;
  return (
    <div className="mb-4 rounded-md border border-dashed border-neutral-400 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
      {status === "mock"
        ? "Mock data — committee IDs are real, dollar figures are placeholders until the FEC pipeline lands."
        : "Partial data — some figures are still being computed."}
    </div>
  );
}

export function Card({ title, children, action }: { title?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      {(title || action) && (
        <header className="mb-3 flex items-baseline justify-between gap-4">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="mb-4 text-sm text-neutral-500">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1.5">/</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-neutral-900 hover:underline">
              {it.label}
            </Link>
          ) : (
            <span className="text-neutral-900">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Adjacency disclaimer. Use wherever money and policy appear near each other. */
export function AdjacencyNote() {
  return (
    <p className="text-xs text-neutral-500">
      Money and positions are shown side by side because they are public records about the same person. Proximity is not
      causation; we make no claim that any contribution produced any action.
    </p>
  );
}
