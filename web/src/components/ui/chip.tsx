import type { ReactNode } from "react";

export type ChipTone = "neutral" | "muted" | "amber" | "green" | "red";

const TONES: Record<ChipTone, string> = {
  neutral: "border-neutral-300 bg-white text-neutral-800",
  muted: "border-neutral-200 bg-neutral-100 text-neutral-500",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  green: "border-emerald-300 bg-emerald-50 text-emerald-900",
  red: "border-red-300 bg-red-50 text-red-900",
};

/** Small labeled token. Neutral by default; tones carry meaning only where the copy already does. */
export function Chip({ children, tone = "neutral", title, className = "" }: { children: ReactNode; tone?: ChipTone; title?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-none ${TONES[tone]} ${className}`}
      title={title}
    >
      {children}
    </span>
  );
}
