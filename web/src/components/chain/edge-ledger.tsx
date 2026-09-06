"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { money } from "@/lib/format";
import { REVEAL_EDGE_EVENT, edgeIndexFromHash, edgeRowId } from "./edge-reveal";
import { EdgeRows, fromWireRows, type EdgeRowsWire } from "./edge-rows";

const TARGET_CLASS = "chain-edge-target";

/**
 * The receipts table, folded by default behind a toggle that names the edge count. `children` is the server-rendered
 * head (the largest edges); the long tail ships as compact data and renders on demand. An edge clicked in the picture
 * (or a `#edge-<index>` link) opens whatever holds its row, scrolls to it and marks it.
 */
export function EdgeLedger({
  children,
  tail,
  total,
  headCount,
}: {
  children: ReactNode;
  tail: EdgeRowsWire;
  total: number;
  headCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [tailOpen, setTailOpen] = useState(false);
  const [target, setTarget] = useState<{ index: number; seq: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tailRows = useMemo(() => fromWireRows(tail), [tail]);
  const tailIndex = useMemo(() => new Set(tailRows.map((r) => r.index)), [tailRows]);
  const tailSum = tailRows.reduce((s, r) => s + (r.kind === "money" ? r.amount : 0), 0);

  useEffect(() => {
    const reveal = (index: number) => {
      setOpen(true);
      if (tailIndex.has(index)) setTailOpen(true);
      setTarget((t) => ({ index, seq: (t?.seq ?? 0) + 1 }));
    };
    const onEvent = (ev: Event) => reveal((ev as CustomEvent<number>).detail);
    const onHash = () => {
      const i = edgeIndexFromHash(window.location.hash);
      if (i !== null) reveal(i);
    };
    window.addEventListener(REVEAL_EDGE_EVENT, onEvent);
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => {
      window.removeEventListener(REVEAL_EDGE_EVENT, onEvent);
      window.removeEventListener("hashchange", onHash);
    };
  }, [tailIndex]);

  // Runs after the rows the target lives in are in the DOM.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    for (const el of body.querySelectorAll(`.${TARGET_CLASS}`)) el.classList.remove(TARGET_CLASS);
    if (target === null || !open) return;
    const row = document.getElementById(edgeRowId(target.index));
    if (!row) return;
    row.classList.add(TARGET_CLASS);
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [target, open, tailOpen]);

  return (
    <div className="chain-ledger">
      <button
        type="button"
        className="chain-ledger-toggle"
        aria-expanded={open}
        aria-controls="chain-ledger-body"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="chain-ledger-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        {open
          ? `Hide the ${total} ${total === 1 ? "edge" : "edges"}`
          : `Show all ${total} ${total === 1 ? "edge" : "edges"}, each with its record`}
        {!open && (
          <span className="chain-ledger-hint">
            or click an edge in the picture to jump to its row
          </span>
        )}
      </button>
      <div id="chain-ledger-body" ref={bodyRef} hidden={!open} className="space-y-3">
        {children}
        {tailRows.length > 0 && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setTailOpen((o) => !o)}
              className="text-sm text-neutral-700 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
            >
              {tailOpen
                ? `Hide the ${tailRows.length} smaller edges`
                : `Show the ${tailRows.length} smaller edges too (${money(tailSum)} in money edges; ${headCount} largest shown above)`}
            </button>
            {tailOpen && <EdgeRows rows={tailRows} />}
          </div>
        )}
      </div>
    </div>
  );
}
