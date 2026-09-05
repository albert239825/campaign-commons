"use client";

import { useMemo, useState } from "react";
import { money } from "@/lib/format";
import { EdgeRows, fromWireRows, type EdgeRowsWire } from "./edge-rows";

/** The long tail of the receipts table: shipped as compact data, rendered only when asked for. */
export function EdgeTail({ wire, total }: { wire: EdgeRowsWire; total: number }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => fromWireRows(wire), [wire]);
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-sm text-neutral-700 underline decoration-dotted underline-offset-2 hover:text-neutral-900">
        {open ? `Hide the ${rows.length} smaller edges` : `Show all ${total} edges (${rows.length} more, ${money(sum)} in total)`}
      </button>
      {open && <EdgeRows rows={rows} />}
    </div>
  );
}
