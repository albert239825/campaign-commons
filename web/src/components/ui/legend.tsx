import type { ReactNode } from "react";

export type LegendItem = { swatch: ReactNode; label: string };

export function Legend({ items, className = "" }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600 ${className}`}>
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          {it.swatch}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function Swatch({ color, className = "" }: { color: string; className?: string }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-sm ${className}`} style={{ backgroundColor: color }} />;
}
