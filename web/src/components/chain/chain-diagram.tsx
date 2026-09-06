"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  COMMITTEE_TYPE_LABELS,
  TARGETING_COLOR,
  UNWALKED_COLOR,
  VISIBILITY_COLORS,
} from "@campaign-commons/contracts";
import { money } from "@/lib/format";
import { BASIS_DASH, BASIS_LABELS } from "./basis";
import {
  NODE_W,
  SPINE_W,
  columnLabel,
  layoutChain,
  ribbonPath,
  ribbonSpine,
  type LaidOutNode,
  type Ribbon,
} from "./layout";
import { NodePanel, type IncidentEdge } from "./node-panel";
import { terminusLabel } from "./terminus";
import {
  MATERIAL_SHARE,
  fromWire,
  visibleGraph,
  type GraphControls,
  type ChainViewWire,
  type ViewNode,
  type VisibleNode,
} from "./view";

const MUTED = "#a3a3a3";
const INK = "#171717";
/** Spending-side accents: vendors and the placement edges into ads. Candidates and targeting edges reuse TARGETING_COLOR. */
export const VENDOR_COLOR = "#0f766e";
export const PLACEMENT_COLOR = VENDOR_COLOR;
const SELECTED = "#2563eb";

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function subLabel(n: VisibleNode, txns: number): string {
  if (n.kind === "aggregate") {
    if (n.side === "out") return "smaller ads, folded";
    return n.folded > 0
      ? `other (${n.folded} smaller sources folded, ${txns} transactions)`
      : `other (${txns} transactions aggregated)`;
  }
  if (n.kind === "vendor") return n.medium ? `vendor · ${n.medium}` : "vendor";
  if (n.kind === "ad") return "ad · spend is a range midpoint";
  if (n.kind === "candidate") return "candidate · targeted, receives no money";
  if (n.committee_type) return COMMITTEE_TYPE_LABELS[n.committee_type];
  if (n.kind === "individual") return "individual";
  if (n.kind === "organization") return "non-committee organization";
  return n.kind;
}

function NodeBox({
  ln,
  txns,
  selected,
  onSelect,
  onToggle,
}: {
  ln: LaidOutNode;
  txns: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (n: VisibleNode) => void;
}) {
  const { node: n, x, y, h } = ln;
  const isDark =
    n.side === "in" &&
    (n.visibility === "dark" || n.terminus_reason === "dark");
  const isAgg = n.kind === "aggregate";
  const isRoot = n.side === "in" && n.depth === 0;
  const isOut = n.side === "out";
  const togglable = isOut
    ? n.children > 0
    : !isRoot &&
      (n.state === "closed" || n.state === "partial" || n.userOpened);
  const showsMore = isOut ? n.state === "closed" : n.state !== "full";
  const charBudget = Math.floor(NODE_W / 6.4);
  const labelH = isDark
    ? h >= 72
      ? 58
      : h >= 58
        ? 46
        : h >= 42
          ? 31
          : 18
    : h >= 42
      ? 31
      : 18;
  const sub = subLabel(n, txns);
  const isUnwalked = n.terminus_reason === "depth_cap";
  const stroke = selected
    ? SELECTED
    : isDark
      ? VISIBILITY_COLORS.dark
      : isAgg
        ? MUTED
        : isRoot
          ? INK
          : n.kind === "vendor" || n.kind === "ad"
            ? VENDOR_COLOR
            : n.kind === "candidate"
              ? TARGETING_COLOR
              : isUnwalked
                ? UNWALKED_COLOR
                : VISIBILITY_COLORS[n.visibility];
  const accent = isDark
    ? VISIBILITY_COLORS.dark
    : isAgg
      ? MUTED
      : isRoot
        ? INK
        : n.kind === "vendor" || n.kind === "ad"
          ? VENDOR_COLOR
          : n.kind === "candidate"
            ? TARGETING_COLOR
            : isUnwalked
              ? UNWALKED_COLOR
              : VISIBILITY_COLORS[n.visibility];
  const fill = isDark
    ? "url(#dark-hatch)"
    : isAgg
      ? "#f5f5f5"
      : isRoot
        ? "#fafafa"
        : n.kind === "candidate"
          ? "#f7f7f5"
          : "#ffffff";
  const textColor = isAgg ? "#737373" : INK;
  const thumbW = n.kind === "ad" && n.thumbnail && h >= 58 ? 64 : 0;
  const term = terminusLabel(n);
  const title = `${n.name} · ${money(n.amount_in, { compact: false })}${term ? ` · ${term}` : ""} · click for details`;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className="cursor-pointer hover:opacity-80"
      onClick={() => onSelect(n.id)}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onSelect(n.id);
        }
      }}
    >
      <title>{title}</title>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={h}
        rx={3}
        fill={fill}
        stroke={stroke}
        strokeWidth={selected ? 2.5 : isRoot ? 2 : 1.25}
        strokeDasharray={isAgg ? "3 3" : undefined}
      />
      {isDark && (
        <rect
          x={x + 4}
          y={y}
          width={NODE_W - 4}
          height={Math.min(labelH, h)}
          fill="#ffffff"
          fillOpacity={0.88}
        />
      )}
      <rect x={x} y={y} width={4} height={h} fill={accent} />
      {thumbW > 0 && n.thumbnail && (
        <image
          href={n.thumbnail}
          x={x + 8}
          y={y + 6}
          width={thumbW}
          height={h - 12}
          preserveAspectRatio="xMidYMid slice"
        />
      )}
      <text
        x={x + 10 + thumbW + (thumbW ? 4 : 0)}
        y={y + 13}
        fontSize={11}
        fontWeight={600}
        fill={textColor}
      >
        {truncate(
          n.name,
          charBudget - (togglable ? 3 : 0) - Math.ceil(thumbW / 6.4),
        )}
      </text>
      {h >= 42 && (
        <text
          x={x + 10 + thumbW + (thumbW ? 4 : 0)}
          y={y + 26}
          fontSize={10}
          fill="#737373"
        >
          {truncate(sub, charBudget + 2 - Math.ceil(thumbW / 6.4))}
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
        {n.kind === "ad" || (isOut && isAgg)
          ? `~${money(n.amount_in)}`
          : money(n.amount_in)}
      </text>
      {isDark && h >= 58 && (
        <text
          x={x + 10}
          y={y + 41}
          fontSize={9.5}
          fontWeight={700}
          fill={VISIBILITY_COLORS.dark}
          letterSpacing={0.6}
        >
          DARK WALL
        </text>
      )}
      {isDark && h >= 72 && (
        <text x={x + 10} y={y + 53} fontSize={9} fill="#7f1d1d">
          {truncate(term ?? "", charBudget + 4)}
        </text>
      )}
      {togglable && (
        <g
          role="button"
          tabIndex={0}
          className="cursor-pointer"
          onClick={(ev) => {
            ev.stopPropagation();
            onToggle(n);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              ev.stopPropagation();
              onToggle(n);
            }
          }}
        >
          <title>
            {isOut
              ? showsMore
                ? `expand ${n.children} downstream`
                : "collapse downstream"
              : showsMore
                ? "show all its sources"
                : "fold its sources"}
          </title>
          <rect
            x={x + NODE_W - 20}
            y={y + 3}
            width={16}
            height={14}
            rx={2}
            fill="#ffffff"
            fillOpacity={0.9}
          />
          <text
            x={x + NODE_W - 12}
            y={y + 14}
            fontSize={12}
            fontWeight={700}
            textAnchor="middle"
            fill={showsMore ? INK : "#737373"}
            aria-label={showsMore ? "expand" : "collapse"}
          >
            {showsMore ? "+" : "−"}
          </text>
        </g>
      )}
    </g>
  );
}

function RibbonShape({ r }: { r: Ribbon }) {
  const { edge, from, to } = r;
  if (edge.kind === "money") {
    return (
      <path
        d={ribbonPath(r)}
        fill={VISIBILITY_COLORS[edge.visibility]}
        fillOpacity={edge.visibility === "dark" ? 0.5 : 0.38}
        stroke="none"
      >
        <title>{`${from.node.name} → ${to.node.name}: ${money(edge.amount, { compact: false })} (${edge.visibility}, ${edge.count} transactions)`}</title>
      </path>
    );
  }
  const basis = edge.basis?.[0] ?? "filed";
  const color = edge.kind === "targeting" ? TARGETING_COLOR : PLACEMENT_COLOR;
  const label =
    edge.kind === "targeting"
      ? `${from.node.name} ${edge.support_oppose === "S" ? "supports" : edge.support_oppose === "O" ? "opposes" : "targets"} ${to.node.name}: ${money(edge.amount, { compact: false })} in independent expenditures — no money reaches the candidate`
      : `${from.node.name} → ${to.node.name}: placement, ${BASIS_LABELS[basis]}${edge.basis ? ` — ${edge.basis[1]}` : ""}`;
  return (
    <g>
      <path
        d={ribbonSpine(r)}
        fill="none"
        stroke="#ffffff"
        strokeWidth={SPINE_W + 3}
        strokeOpacity={0.7}
      />
      <path
        d={ribbonSpine(r)}
        fill="none"
        stroke={color}
        strokeWidth={SPINE_W}
        strokeDasharray={BASIS_DASH[basis]}
        strokeLinecap="round"
        markerEnd={`url(#arrow-${edge.kind})`}
      >
        <title>{label}</title>
      </path>
    </g>
  );
}

/**
 * Client-rendered chain picture. Funding side: sources on the left, the spender in the middle; ribbon width ∝ dollars,
 * ribbon color = visibility. Spending side (Block 2): vendors, ads and the targeted candidate to the right; money edges
 * are ribbons, placement / targeting edges are thin spines styled by their evidence basis (solid / dashed / dotted).
 * Clicking a node opens its panel (basics, evidence, links, expand / collapse / hide) — Palantir-Vertex style.
 */
export function ChainDiagram({
  wire,
  openAll = false,
  caption,
  rootLabel = "spender",
}: {
  wire: ChainViewWire;
  openAll?: boolean;
  caption?: ReactNode;
  rootLabel?: string;
}) {
  const view = useMemo(() => fromWire(wire), [wire]);
  const [controls, setControls] = useState<GraphControls>(() => ({
    opened: openAll ? new Set(view.nodes.filter((n) => n.side === "in").map((n) => n.id)) : new Set(),
    collapsed: new Set(),
    hidden: new Set(),
  }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const flip = (key: keyof GraphControls, id: string) =>
    setControls((prev) => {
      const next = new Set(prev[key]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [key]: next };
    });
  const toggle = (n: VisibleNode) =>
    flip(n.side === "out" ? "collapsed" : "opened", n.id);
  const hide = (id: string) => {
    flip("hidden", id);
    setSelectedId(null);
  };
  const restore = () => setControls((prev) => ({ ...prev, hidden: new Set() }));

  const graph = useMemo(() => visibleGraph(view, controls), [view, controls]);
  const L = useMemo(() => layoutChain(graph.nodes, graph.edges), [graph]);
  const txnsFrom = new Map<string, number>();
  for (const e of graph.edges)
    if (e.kind === "money")
      txnsFrom.set(e.from, (txnsFrom.get(e.from) ?? 0) + e.count);
  const closed = graph.nodes.filter(
    (n) => n.side === "in" && n.state === "closed",
  ).length;

  const selected = selectedId
    ? (graph.nodes.find((n) => n.id === selectedId) ?? null)
    : null;
  const byId = useMemo(
    () => new Map<string, ViewNode>(view.nodes.map((n) => [n.id, n])),
    [view],
  );
  const incident: IncidentEdge[] = selected
    ? view.edges.flatMap((e): IncidentEdge[] => {
        if (e.to === selected.id) {
          const other = byId.get(e.from);
          return other ? [{ edge: e, other, direction: "in" }] : [];
        }
        if (e.from === selected.id) {
          const other = byId.get(e.to);
          return other ? [{ edge: e, other, direction: "out" }] : [];
        }
        return [];
      })
    : [];

  return (
    <figure className="chain-figure">
      <div className="chain-map-scroll" tabIndex={0} role="region" aria-label="Scrollable funding map">
      <svg
        viewBox={`0 0 ${L.width} ${L.height + 22}`}
        width="100%"
        style={{ maxHeight: 880, fontFamily: "var(--font-sans)" }}
        role="img"
        aria-label={`${graph.hasOut ? "Money into and out of" : "Funding chain into"} ${view.rootName}: ${L.nodes.length} nodes, ${L.ribbons.length} edges drawn. Full detail in the table below.`}
      >
        <defs>
          <pattern
            id="dark-hatch"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="7" fill="#fdecec" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              stroke={VISIBILITY_COLORS.dark}
              strokeWidth="2.5"
            />
          </pattern>
          <marker
            id="arrow-targeting"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={TARGETING_COLOR} />
          </marker>
          <marker
            id="arrow-placement"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={PLACEMENT_COLOR} />
          </marker>
        </defs>
        {L.columns
          .filter((c) => c.nodes.length > 0)
          .map((c) => (
            <text
              key={c.index}
              x={c.x + NODE_W / 2}
              y={L.height + 14}
              fontSize={10}
              textAnchor="middle"
              fill="#a3a3a3"
              letterSpacing={0.5}
            >
              {columnLabel(c, rootLabel)}
            </text>
          ))}
        {L.ribbons.map((r, i) => (
          <RibbonShape key={i} r={r} />
        ))}
        {L.nodes.map((ln) => (
          <NodeBox
            key={ln.node.id}
            ln={ln}
            txns={txnsFrom.get(ln.node.id) ?? 0}
            selected={ln.node.id === selectedId}
            onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
            onToggle={toggle}
          />
        ))}
      </svg>
      </div>
      {selected && (
        <div className="mt-2">
          <NodePanel
            node={selected}
            incident={incident}
            isRoot={selected.id === view.rootId}
            actions={{
              onClose: () => setSelectedId(null),
              onToggleSources:
                selected.side === "in" &&
                selected.state !== "leaf" &&
                selected.id !== view.rootId
                  ? () => flip("opened", selected.id)
                  : null,
              onToggleChildren:
                selected.children > 0
                  ? () => flip("collapsed", selected.id)
                  : null,
              onHide: () => hide(selected.id),
            }}
          />
        </div>
      )}
      <figcaption className="mt-1 text-xs text-neutral-500">
        {caption ?? (
          <>
            Drawn: the spender, its direct sources and every node carrying at least{" "}
            {Math.round(MATERIAL_SHARE * 100)}% of its receipts
            {graph.hidden.nodes > 0 &&
              ` — ${graph.hidden.nodes} smaller ${graph.hidden.nodes === 1 ? "source" : "sources"} (${money(graph.hidden.amount)}) folded into dashed “other” nodes`}
            {closed > 0 &&
              `; ${closed} ${closed === 1 ? "committee has" : "committees have"} sources not drawn — click + to show them`}
            {graph.hasOut &&
              "; to the right, what the spender paid for and whom it targeted"}
            . Click any node for its details and evidence. Every edge is in the
            table below.
          </>
        )}
        {graph.userHidden > 0 && (
          <>
            {" "}
            You hid {graph.userHidden}{" "}
            {graph.userHidden === 1 ? "node" : "nodes"} —{" "}
            <button
              type="button"
              onClick={restore}
              className="underline decoration-dotted underline-offset-2 hover:text-neutral-900"
            >
              restore
            </button>
            .
          </>
        )}
      </figcaption>
    </figure>
  );
}
