import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

/** Dense editorial table. Wrap in an overflow container; header row is uppercase small caps. */
export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="data-table-scroll -mx-4 overflow-x-auto px-4" tabIndex={0} role="region" aria-label="Scrollable records table">
      <table className={`w-full border-collapse text-sm ${className}`}>{children}</table>
    </div>
  );
}

export function Th({ children, className = "", align = "left", ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <th
      {...rest}
      className={`border-b border-neutral-300 py-1.5 pr-3 text-[11px] font-medium uppercase tracking-wide text-neutral-500 last:pr-0 ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "", align = "left", ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <td {...rest} className={`border-b border-neutral-100 py-2 pr-3 align-top last:pr-0 ${align === "right" ? "text-right tabular-nums" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-6 text-center text-sm text-neutral-500">
        {children}
      </td>
    </tr>
  );
}
