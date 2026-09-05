"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { COMMITTEE_TYPE_LABELS, UNWALKED_COLOR, VISIBILITY_COLORS } from "@citizen-gotham/contracts";
import { money } from "@/lib/format";
import { NODE_W, layoutChain, ribbonPath, type LaidOutNode } from "./layout";
import { terminusLabel } from "./terminus";
import { MATERIAL_SHARE, fromWire, visibleGraph, type ChainViewWire } from "./view";

const MUTED = "#a3a3a3";
const INK = "#171717";

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function NodeBox({ ln, txns, onToggle }: { ln: LaidOutNode; txns: number; onToggle: (id: string) => void }) {
  const { node: n, x, y, h } = ln;
  const isDark = n.visibility === "dark" || n.terminus_reason === "dark";
  const isAgg = n.kind === "aggregate";
  const isRoot = n.depth === 0;
  const expandable = !isRoot && (n.state === "closed" || n.state === "partial" || n.userOpened);
  const showsMore = n.state !== "full";
  const charBudget = Math.floor(NODE_W / 6.4);
  const labelH = isDark ? (h >= 72 ? 58 : h >= 58 ? 46 : h >= 42 ? 31 : 18) : h >= 42 ? 31 : 18;
  const sub = isAgg
    ? n.folded > 0
      ? `other (${n.folded} smaller sources folded, ${txns} transactions)`
      : `other (${txns} transactions aggregated)`
    : n.committee_type
      ? COMMITTEE_TYPE_LABELS[n.committee_type]
      : n.kind === "individual"
        ? "individual"
        : n.kind === "organization"
          ? "non-committee organization"
          : n.kind;
  const isUnwalked = n.terminus_reason === "depth_cap";
  const stroke = isDark ? VISIBILITY_COLORS.dark : isAgg ? MUTED : isRoot ? INK : isUnwalked ? UNWALKED_COLOR : VISIBILITY_COLORS[n.visibility];
  const fill = isDark ? "url(#dark-hatch)" : isAgg ? "#f5f5f5" : isRoot ? "#fafafa" : "#ffffff";
  const textColor = isAgg ? "#737373" : INK;
  const body = (
    <g>
      <rect x={x} y={y} width={NODE_W} height={h} rx={3} fill={fill} stroke={stroke} strokeWidth={isRoot ? 2 : 1.25} strokeDasharray={isAgg ? "3 3" : undefined} />
      {isDark && <rect x={x + 4} y={y} width={NODE_W - 4} height={Math.min(labelH, h)} fill="#ffffff" fillOpacity={0.88} />}
      <rect x={x} y={y} width={4} height={h} fill={isAgg ? MUTED : stroke} />
      <text x={x + 10} y={y + 13} fontSize={11} fontWeight={600} fill={textColor}>
        {truncate(n.name, charBudget - (expandable ? 3 : 0))}
      </text>
      {h >= 42 && (
        <text x={x + 10} y={y + 26} fontSize={10} fill="#737373">
          {truncate(sub, charBudget + 2)}
        </text>
      )}
      <text
        x={x + NODE_W - 8}
        y={y + h - 7}
        fontSize={11}
        textAnchor="end"
        fill={textColor}
        stroke={isDark ? "#ffffff" : "none"}
        strokeWidth={isDark ? 3 : 0}
        paintOrder="stroke"
        className="tabular-nums"
      >
        {money(n.amount_in)}
      </text>
      {isDark && h >= 58 && (
        <text x={x + 10} y={y + 41} fontSize={9.5} fontWeight={700} fill={VISIBILITY_COLORS.dark} letterSpacing={0.6}>
          DARK WALL
        </text>
      )}
      {isDark && h >= 72 && (
        <text x={x + 10} y={y + 53} fontSize={9} fill="#7f1d1d">
          {truncate(terminusLabel(n) ?? "", charBudget + 4)}
        </text>
      )}
    </g>
  );
  const term = terminusLabel(n);
  const title = `${n.name} · ${money(n.amount_in, { compact: false })}${term ? ` · ${term}` : ""}${expandable ? (showsMore ? " · click to show all its sources" : " · click to fold its sources") : ""}`;
  const link =
    n.href && (n.href.startsWith("/") ? (
      <Link href={n.href} className="hover:opacity-80">
        <title>{title}</title>
        {body}
      </Link>
    ) : (
      <a href={n.href} target="_blank" rel="noreferrer" className="hover:opacity-80">
        <title>{title}</title>
        {body}
      </a>
    ));
  if (!expandable) {
    return (
      link ?? (
        <g>
          <title>{title}</title>
          {body}
        </g>
      )
    );
  }
  // Expandable committee: the box toggles its sources in place; the link out sits in the corner.
  return (
    <g>
      <g role="button" tabIndex={0} className="cursor-pointer hover:opacity-80" onClick={() => onToggle(n.id)} onKeyDown={(ev) => ev.key === "Enter" && onToggle(n.id)}>
        <title>{title}</title>
        {body}
        <text x={x + NODE_W - 8} y={y + 13} fontSize={12} fontWeight={700} textAnchor="end" fill={showsMore ? INK : "#737373"} aria-label={showsMore ? "show all sources" : "fold sources"}>
          {showsMore ? "+" : "−"}
        </text>
      </g>
      {n.href && (
        <g transform={`translate(${x + 10}, ${y + h - 7})`}>
          {n.href.startsWith("/") ? (
            <Link href={n.href} className="hover:opacity-80">
              <text fontSize={9} fill="#737373" textDecoration="underline" stroke="#ffffff" strokeWidth={3} paintOrder="stroke">
                entity page ↗
              </text>
            </Link>
          ) : (
            <a href={n.href} target="_blank" rel="noreferrer">
              <text fontSize={9} fill="#737373" textDecoration="underline" stroke="#ffffff" strokeWidth={3} paintOrder="stroke">
                FEC ↗
              </text>
            </a>
          )}
        </g>
      )}
    </g>
  );
}

/**
 * Client-rendered Sankey. Sources on the left, the spender on the right; ribbon width ∝ dollars,
 * ribbon color = visibility. Dark terminals are hatched red; aggregates are dashed grey.
 * Draws the material subgraph only (view.ts); clicking a committee shows or hides its sources.
 */
export function ChainDiagram({ wire, maxDepth }: { wire: ChainViewWire; maxDepth: number }) {
  const view = useMemo(() => fromWire(wire), [wire]);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const graph = useMemo(() => visibleGraph(view, opened), [view, opened]);
  const L = useMemo(() => layoutChain(graph.nodes, graph.edges), [graph]);
  const txnsFrom = new Map<string, number>();
  for (const e of graph.edges) txnsFrom.set(e.from, (txnsFrom.get(e.from) ?? 0) + e.count);
  const closed = graph.nodes.filter((n) => n.state === "closed").length;
  return (
    <figure className="chain-figure">
      <div className="chain-map-scroll" tabIndex={0} role="region" aria-label="Scrollable funding map">
      <svg
        viewBox={`0 0 ${L.width} ${L.height + 22}`}
        width="100%"
        style={{ maxHeight: 880, fontFamily: "var(--font-sans)" }}
        role="img"
        aria-label={`Funding chain into ${view.rootName}: ${L.nodes.length} nodes, ${L.ribbons.length} money edges drawn. Full detail in the table below.`}
      >
        <defs>
          <pattern id="dark-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="#fdecec" />
            <line x1="0" y1="0" x2="0" y2="7" stroke={VISIBILITY_COLORS.dark} strokeWidth="2.5" />
          </pattern>
        </defs>
        {Array.from({ length: maxDepth + 1 }, (_, d) => {
          const col = L.nodes.find((n) => n.node.depth === d);
          if (!col) return null;
          return (
            <text key={d} x={col.x + NODE_W / 2} y={L.height + 14} fontSize={10} textAnchor="middle" fill="#a3a3a3" letterSpacing={0.5}>
              {d === 0 ? "SPENDER" : `HOP ${d}`}
            </text>
          );
        })}
        {L.ribbons.map((r, i) => (
          <path key={i} d={ribbonPath(r)} fill={VISIBILITY_COLORS[r.edge.visibility]} fillOpacity={r.edge.visibility === "dark" ? 0.5 : 0.38} stroke="none">
            <title>{`${r.from.node.name} → ${r.to.node.name}: ${money(r.edge.amount, { compact: false })} (${r.edge.visibility}, ${r.edge.count} transactions)`}</title>
          </path>
        ))}
        {L.nodes.map((ln) => (
          <NodeBox key={ln.node.id} ln={ln} txns={txnsFrom.get(ln.node.id) ?? 0} onToggle={toggle} />
        ))}
      </svg>
      </div>
      <figcaption className="mt-1 text-xs text-neutral-500">
        Drawn: the spender, its direct sources and every node carrying at least {Math.round(MATERIAL_SHARE * 100)}% of its receipts
        {graph.hidden.nodes > 0 && ` — ${graph.hidden.nodes} smaller ${graph.hidden.nodes === 1 ? "source" : "sources"} (${money(graph.hidden.amount)}) folded into dashed “other” nodes`}
        {closed > 0 && `; ${closed} ${closed === 1 ? "committee has" : "committees have"} sources not drawn — click + to show them`}. Every edge is in the table below.
      </figcaption>
    </figure>
  );
}
