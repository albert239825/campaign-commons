"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  COMMITTEE_TYPE_LABELS,
  TARGETING_COLOR,
  UNWALKED_COLOR,
  VISIBILITY_COLORS,
  VISIBILITY_LABELS,
} from "@campaign-commons/contracts";
import { money } from "@/lib/format";
import { BASIS_DASH, BASIS_LABELS } from "./basis";
import { kMaxFor, shortBuckets } from "./camera";
import { EdgePanel, EDGE_KIND_LABELS, edgeAmountLabel, edgeVerb } from "./edge-panel";
import { revealEdge } from "./edge-reveal";
import { announceNode } from "./graph-announce";
import { edgeKey, isCursorKey, moveCursor, navGraph, pathSet } from "./graph-nav";
import {
  NAME_FONT,
  SUB_FONT,
  TEXT_RIGHT,
  TEXT_X,
  THUMB_W,
  TOGGLE_W,
  TWO_ROW_H,
  AMOUNT_GAP,
  amountText,
  ellipsize,
  fitLines,
  isRootNode,
  isTogglable,
  textWidth,
} from "./label";
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
import { NodePanel, kindLabel, type IncidentEdge } from "./node-panel";
import { terminusLabel } from "./terminus";
import { useCamera } from "./use-camera";
import {
  MATERIAL_SHARE,
  fromWire,
  visibleGraph,
  type GraphControls,
  type ChainViewWire,
  type ViewEdge,
  type ViewNode,
  type VisibleNode,
} from "./view";

const MUTED = "#a3a3a3";
const INK = "#171717";
/** Spending-side accents: vendors and the placement edges into ads. Candidates and targeting edges reuse TARGETING_COLOR. */
export const VENDOR_COLOR = "#0f766e";
export const PLACEMENT_COLOR = VENDOR_COLOR;
const SELECTED = "#2563eb";
/** The root's outline and label chip: the page's own ink, so it reads as "this page", not as a party or a visibility. */
export const ROOT_COLOR = INK;

type Selection = { kind: "node"; id: string } | { kind: "edge"; key: string } | null;
type TipBody =
  | { kind: "node"; node: VisibleNode; out: number }
  | { kind: "edge"; r: Ribbon };
type PointEvent = MouseEvent<Element> | FocusEvent<Element>;
type Pointing = {
  onPoint: (body: TipBody, ev: PointEvent) => void;
  onMove: (ev: MouseEvent<Element>) => void;
  onLeave: () => void;
};

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

/** `data-lit` for a node or edge while a route is lit: "1" on the route, "0" dimmed; absent when nothing is lit. */
const litAttr = (lit: boolean | null) => (lit === null ? undefined : lit ? "1" : "0");

type TextLine = { text: string; y: number; size: number; weight?: number; fill: string; spacing?: number };

/** The rows of text a non-root box shows, top to bottom, never running into the amount or the +/− control. */
function stackLines(n: VisibleNode, ln: LaidOutNode, txns: number, innerW: number, togglable: boolean): TextLine[] {
  const { y, h } = ln;
  const isDark = n.side === "in" && (n.visibility === "dark" || n.terminus_reason === "dark");
  const textColor = n.kind === "aggregate" ? "#737373" : INK;
  const amtW = textWidth(amountText(n), NAME_FONT) + AMOUNT_GAP;
  if (h < TWO_ROW_H) {
    const budget = innerW - amtW - (togglable ? TOGGLE_W : 0);
    return [{ text: ellipsize(n.name, budget, NAME_FONT), y: y + h / 2 + 4, size: NAME_FONT, weight: 600, fill: textColor }];
  }
  const slots: number[] = [];
  for (let b = 13; b <= h - 16; b += 13) slots.push(b);
  const budgetAt = (i: number) =>
    innerW - (i === 0 && togglable ? TOGGLE_W : 0) - (slots[i] > h - 24 ? amtW : 0);
  const nameLines = fitLines(n.name, slots.slice(0, 2).map((_, i) => budgetAt(i)), NAME_FONT);
  const out: TextLine[] = nameLines.map((text, i) => ({
    text,
    y: y + slots[i],
    size: NAME_FONT,
    weight: 600,
    fill: textColor,
  }));
  const rest: Omit<TextLine, "y">[] = [{ text: subLabel(n, txns), size: SUB_FONT, fill: "#737373" }];
  if (isDark) {
    rest.push({ text: "DARK WALL", size: 9.5, weight: 700, fill: VISIBILITY_COLORS.dark, spacing: 0.6 });
    const term = terminusLabel(n);
    if (term) rest.push({ text: term, size: 9, fill: "#7f1d1d" });
  }
  for (const line of rest) {
    const i = out.length;
    if (i >= slots.length) break;
    out.push({ ...line, text: ellipsize(line.text, budgetAt(i), line.size), y: y + slots[i] });
  }
  return out;
}

function NodeBox({
  ln,
  domId,
  txns,
  out,
  selected,
  lit,
  onSelect,
  onToggle,
  pointing,
}: {
  ln: LaidOutNode;
  domId: string;
  txns: number;
  out: number;
  selected: boolean;
  lit: boolean | null;
  onSelect: (id: string) => void;
  onToggle: (n: VisibleNode) => void;
  pointing: Pointing;
}) {
  const { node: n, x, y, h } = ln;
  const isDark =
    n.side === "in" &&
    (n.visibility === "dark" || n.terminus_reason === "dark");
  const isAgg = n.kind === "aggregate";
  const isRoot = isRootNode(n);
  const isOut = n.side === "out";
  const togglable = isTogglable(n);
  const showsMore = isOut ? n.state === "closed" : n.state !== "full";
  const isUnwalked = n.terminus_reason === "depth_cap";
  const stroke = selected
    ? SELECTED
    : isDark
      ? VISIBILITY_COLORS.dark
      : isAgg
        ? MUTED
        : isRoot
          ? ROOT_COLOR
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
        ? ROOT_COLOR
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
  const thumbW = n.kind === "ad" && n.thumbnail && h >= 58 ? THUMB_W : 0;
  const textX = x + TEXT_X + thumbW + (thumbW ? 4 : 0);
  const innerW = NODE_W - TEXT_X - TEXT_RIGHT - thumbW - (thumbW ? 4 : 0);
  const oneRow = h < TWO_ROW_H;
  const lines = isRoot ? [] : stackLines(n, ln, txns, innerW, togglable);
  const lastY = lines.length > 0 ? lines[lines.length - 1].y : y + 13;
  const labelH = oneRow ? h : Math.min(h, lastY - y + 5);
  const amount = amountText(n);
  const amountX = x + NODE_W - TEXT_RIGHT - (oneRow && togglable ? TOGGLE_W : 0);
  const amountY = oneRow ? y + h / 2 + 4 : y + h - 7;
  const toggleY = oneRow ? y + h / 2 - 7 : y + 3;
  // Root: the name sits in a filled chip under a thick outline, with a "you are here" caption.
  const chipLines = isRoot ? fitLines(n.name, [NODE_W - 20, NODE_W - 20], 12) : [];
  const chipH = 8 + chipLines.length * 15;
  const term = terminusLabel(n);
  const label = `${n.name} · ${kindLabel(n)}${isRoot ? " · the spender this page is about" : ""} · ${money(n.amount_in, { compact: false })}${term ? ` · ${term}` : ""} · click for details`;
  const body: TipBody = { kind: "node", node: n, out };
  // Semantic zoom: the `data-k` buckets at which this box is under 20 px tall and hides its amount and sub-labels (globals.css).
  const short = shortBuckets(h).map((b) => `chain-short-k${b}`);
  return (
    <g
      id={domId}
      role="button"
      aria-pressed={selected}
      aria-label={label}
      className={["chain-node cursor-pointer", ...short].join(" ")}
      data-lit={litAttr(lit)}
      onClick={() => onSelect(n.id)}
      onMouseEnter={(ev) => pointing.onPoint(body, ev)}
      onMouseMove={pointing.onMove}
      onMouseLeave={pointing.onLeave}
    >
      {isRoot && (
        <rect
          x={x - 5}
          y={y - 5}
          width={NODE_W + 10}
          height={h + 10}
          rx={6}
          fill="none"
          stroke={selected ? SELECTED : ROOT_COLOR}
          strokeOpacity={0.16}
          strokeWidth={5}
        />
      )}
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={h}
        rx={3}
        fill={fill}
        stroke={stroke}
        strokeWidth={isRoot ? 3 : selected ? 2.5 : 1.25}
        strokeDasharray={isAgg ? "3 3" : undefined}
        vectorEffect={selected ? "non-scaling-stroke" : undefined}
      />
      {isDark && (
        <rect
          x={x + 4}
          y={y}
          width={NODE_W - 4}
          height={labelH}
          fill="#ffffff"
          fillOpacity={0.88}
        />
      )}
      {!isRoot && <rect x={x} y={y} width={4} height={h} fill={accent} />}
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
      {isRoot ? (
        <>
          <rect x={x + 2} y={y + 2} width={NODE_W - 4} height={chipH} rx={2} fill={selected ? SELECTED : ROOT_COLOR} />
          {chipLines.map((t, i) => (
            <text key={i} x={x + TEXT_X} y={y + 2 + 15 + i * 15} fontSize={12} fontWeight={700} fill="#ffffff">
              {t}
            </text>
          ))}
          <text
            x={x + TEXT_X}
            y={y + chipH + 19}
            fontSize={9}
            fontWeight={700}
            letterSpacing={1}
            fill={ROOT_COLOR}
          >
            YOU ARE HERE · THE SPENDER
          </text>
          <text x={x + TEXT_X} y={y + chipH + 34} fontSize={SUB_FONT} fill="#737373">
            {ellipsize(subLabel(n, txns), innerW, SUB_FONT)}
          </text>
        </>
      ) : (
        lines.map((l, i) => (
          <text
            key={i}
            x={textX}
            y={l.y}
            fontSize={isOut && isAgg ? SUB_FONT : l.size}
            fontWeight={l.weight}
            fill={l.fill}
            letterSpacing={l.spacing}
            className={l.size === NAME_FONT ? undefined : "chain-sub"}
          >
            {l.text}
          </text>
        ))
      )}
      <text
        x={amountX}
        y={amountY}
        fontSize={isRoot ? 13 : NAME_FONT}
        fontWeight={isRoot ? 700 : undefined}
        textAnchor="end"
        fill={textColor}
        stroke={isDark ? "#ffffff" : "none"}
        strokeWidth={isDark ? 3 : 0}
        paintOrder="stroke"
        className="chain-amount tabular-nums"
      >
        {amount}
      </text>
      {togglable && (
        <g
          role="button"
          className="cursor-pointer"
          onClick={(ev) => {
            ev.stopPropagation();
            onToggle(n);
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
            y={toggleY}
            width={16}
            height={14}
            rx={2}
            fill="#ffffff"
            fillOpacity={0.9}
          />
          <text
            x={x + NODE_W - 12}
            y={toggleY + 11}
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

function RibbonShape({
  r,
  selected,
  lit,
  onSelect,
  pointing,
}: {
  r: Ribbon;
  selected: boolean;
  lit: boolean | null;
  onSelect: (edge: ViewEdge) => void;
  pointing: Pointing;
}) {
  const { edge, from, to } = r;
  const body: TipBody = { kind: "edge", r };
  const label =
    edge.kind === "money"
      ? `${from.node.name} → ${to.node.name}: ${money(edge.amount, { compact: false })} (${edge.visibility}, ${edge.count} transactions) · click for details`
      : edge.kind === "targeting"
        ? `${from.node.name} ${edgeVerb(edge, from.node, to.node)} ${to.node.name}: ${money(edge.amount, { compact: false })} in independent expenditures — no money reaches the candidate · click for details`
        : `${from.node.name} → ${to.node.name}: placement, ${BASIS_LABELS[edge.basis?.[0] ?? "filed"]}${edge.basis ? ` — ${edge.basis[1]}` : ""} · click for details`;
  const handlers = {
    role: "button",
    "aria-pressed": selected,
    "aria-label": label,
    className: "chain-ribbon cursor-pointer",
    onClick: () => onSelect(edge),
    onMouseEnter: (ev: MouseEvent<Element>) => pointing.onPoint(body, ev),
    onMouseMove: pointing.onMove,
    onMouseLeave: pointing.onLeave,
  };
  if (edge.kind === "money") {
    return (
      <path
        data-lit={litAttr(lit)}
        d={ribbonPath(r)}
        fill={VISIBILITY_COLORS[edge.visibility]}
        fillOpacity={edge.visibility === "dark" ? 0.5 : 0.38}
        stroke={selected ? SELECTED : "transparent"}
        strokeWidth={selected ? 2 : 5}
        vectorEffect={selected ? "non-scaling-stroke" : undefined}
        {...handlers}
      />
    );
  }
  const basis = edge.basis?.[0] ?? "filed";
  const color = edge.kind === "targeting" ? TARGETING_COLOR : PLACEMENT_COLOR;
  return (
    <g className="chain-spine" data-lit={litAttr(lit)}>
      <path
        d={ribbonSpine(r)}
        fill="none"
        stroke={selected ? SELECTED : "#ffffff"}
        strokeWidth={selected ? SPINE_W + 5 : SPINE_W + 3}
        strokeOpacity={selected ? 0.55 : 0.7}
      />
      <path
        d={ribbonSpine(r)}
        fill="none"
        stroke={color}
        strokeWidth={SPINE_W}
        strokeDasharray={BASIS_DASH[basis]}
        strokeLinecap="round"
        markerEnd={`url(#arrow-${edge.kind})`}
      />
      <path d={ribbonSpine(r)} fill="none" stroke="transparent" strokeWidth={12} {...handlers} />
    </g>
  );
}

function TipContent({ body }: { body: TipBody }) {
  if (body.kind === "node") {
    const { node: n, out } = body;
    const isRoot = isRootNode(n);
    const term = terminusLabel(n);
    const inLabel =
      n.kind === "ad"
        ? "est. spend (range midpoint)"
        : n.kind === "candidate"
          ? "in independent expenditures aimed at them — none reaches the candidate"
          : n.kind === "vendor"
            ? "paid by the spender"
            : isRoot
              ? "receipts traced"
              : "in";
    return (
      <>
        <div className="chain-tip-kind">
          {kindLabel(n)}
          {isRoot && " · you are here"}
        </div>
        <div className="chain-tip-name">{n.name}</div>
        {n.kind === "ad" && n.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element -- static file under public/, size unknown
          <img src={n.thumbnail} alt="" className="chain-tip-thumb" loading="lazy" />
        )}
        <div className="chain-tip-amounts tabular-nums">
          <span>
            {n.kind === "ad" || (n.side === "out" && n.kind === "aggregate") ? "~" : ""}
            {money(n.amount_in, { compact: false })}
          </span>{" "}
          <span className="chain-tip-muted">{inLabel}</span>
          {out > 0 && n.kind !== "candidate" && (
            <>
              <br />
              <span>{money(out, { compact: false })}</span>{" "}
              <span className="chain-tip-muted">{isRoot ? "out to vendors (Schedule E)" : "out, toward the spender"}</span>
            </>
          )}
        </div>
        {n.side === "in" && !isRoot && (
          <div className="chain-tip-muted">
            {VISIBILITY_LABELS[n.visibility]}
            {term ? ` · ${term}` : ""}
          </div>
        )}
      </>
    );
  }
  const { edge, from, to } = body.r;
  return (
    <>
      <div className="chain-tip-kind">{EDGE_KIND_LABELS[edge.kind]}</div>
      <div className="chain-tip-name">
        {from.node.name} <span className="chain-tip-muted">{edgeVerb(edge, from.node, to.node)}</span> {to.node.name}
      </div>
      <div className="chain-tip-amounts tabular-nums">{edgeAmountLabel(edge, to.node)}</div>
      <div className="chain-tip-muted">
        {edge.kind === "money"
          ? `${VISIBILITY_LABELS[edge.visibility]} · ${edge.count} ${edge.count === 1 ? "transaction" : "transactions"}`
          : `${BASIS_LABELS[edge.basis?.[0] ?? "filed"]}${edge.basis ? ` — ${edge.basis[1]}` : ""}`}
      </div>
    </>
  );
}

const TIP_W = 280;

/**
 * Client-rendered chain picture. Funding side: sources on the left, the spender in the middle; ribbon width ∝ dollars,
 * ribbon color = visibility. Spending side (Block 2): vendors, ads and the targeted candidate to the right; money edges
 * are ribbons, placement / targeting edges are thin spines styled by their evidence basis (solid / dashed / dotted).
 * Hovering or focusing a node or edge shows a tooltip; clicking a node opens its panel (basics, evidence, links,
 * expand / collapse / hide), clicking an edge opens the edge panel and, when the page has one, its table row.
 */
export function ChainDiagram({ wire, hasTable = false }: { wire: ChainViewWire; hasTable?: boolean }) {
  const view = useMemo(() => fromWire(wire), [wire]);
  const [controls, setControls] = useState<GraphControls>({
    opened: new Set(),
    collapsed: new Set(),
    hidden: new Set(),
  });
  const [selection, setSelection] = useState<Selection>(null);
  const [tip, setTip] = useState<TipBody | null>(null);
  /** Keyboard cursor (a node id) and the node under the pointer; either lights its route. */
  const [cursor, setCursor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const domPrefix = useId();
  const nodeDomId = (id: string) => `${domPrefix}n-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const figRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
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
    setSelection(null);
  };
  const restore = () => setControls((prev) => ({ ...prev, hidden: new Set() }));
  const selectNode = (id: string) => {
    setSelection((cur) => (cur?.kind === "node" && cur.id === id ? null : { kind: "node", id }));
    setCursor(id);
  };
  const selectEdge = (edge: ViewEdge) => {
    const key = edgeKey(edge);
    setSelection((cur) => (cur?.kind === "edge" && cur.key === key ? null : { kind: "edge", key }));
    if (hasTable) revealEdge(edge.index);
  };

  // Tooltip: placed by the pointer (or beside a focused element), moved without re-rendering the picture.
  const moveTip = (x: number, y: number) => {
    const fig = figRef.current;
    const el = tipRef.current;
    if (!fig || !el) return;
    const w = fig.getBoundingClientRect().width;
    el.style.left = `${Math.max(0, Math.min(x, w - TIP_W))}px`;
    el.style.top = `${y}px`;
  };
  const pointAt = (ev: PointEvent): [number, number] => {
    const fr = figRef.current?.getBoundingClientRect();
    if (!fr) return [0, 0];
    if ("clientX" in ev) return [ev.clientX - fr.left + 14, ev.clientY - fr.top + 14];
    const r = ev.currentTarget.getBoundingClientRect();
    return [r.right - fr.left + 8, Math.max(0, r.top - fr.top)];
  };
  const pending = useRef<[number, number] | null>(null);
  const showTip = (body: TipBody, at: [number, number]) => {
    if (tipRef.current) moveTip(...at);
    else pending.current = at;
    setTip(body);
  };
  const pointing: Pointing = {
    onPoint: (body, ev) => {
      showTip(body, pointAt(ev));
      setHover(body.kind === "node" ? body.node.id : null);
    },
    onMove: (ev) => moveTip(...pointAt(ev)),
    onLeave: () => {
      setTip(null);
      setHover(null);
    },
  };
  // Position the freshly mounted tooltip element before paint.
  const tipCallback = (el: HTMLDivElement | null) => {
    tipRef.current = el;
    if (el && pending.current) {
      moveTip(...pending.current);
      pending.current = null;
    }
  };

  const graph = useMemo(() => visibleGraph(view, controls), [view, controls]);
  const L = useMemo(() => layoutChain(graph.nodes, graph.edges), [graph]);
  const frame = useMemo(() => ({ width: L.width, height: L.height + 22 }), [L]);
  const camera = useCamera(svgRef, frame, kMaxFor(NAME_FONT));
  /** Camera keys on the focused wrapper: `+`/`=`, `-`, `0` fit, `Shift`+arrows pan. True when handled. */
  const onCameraKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    const c = camera.controls;
    const step = c.keyPanPx;
    if (ev.shiftKey && ev.key.startsWith("Arrow")) {
      c.panPx(
        ev.key === "ArrowLeft" ? -step : ev.key === "ArrowRight" ? step : 0,
        ev.key === "ArrowUp" ? -step : ev.key === "ArrowDown" ? step : 0,
      );
    } else if (ev.key === "+" || ev.key === "=") c.zoomIn();
    else if (ev.key === "-" || ev.key === "_") c.zoomOut();
    else if (ev.key === "0") c.fit();
    else return false;
    ev.preventDefault();
    return true;
  };
  const nav = useMemo(
    () => navGraph(graph, view.rootId, L.columns.map((c) => c.nodes)),
    [graph, view.rootId, L],
  );
  // A clicked node pins its route; otherwise the pointer, then the keyboard cursor, decides what is lit.
  const pinned = selection?.kind === "node" && nav.nodes.has(selection.id) ? selection.id : null;
  const litFrom = pinned ?? (hover && nav.nodes.has(hover) ? hover : null) ?? (cursor && nav.nodes.has(cursor) ? cursor : null);
  const lit = useMemo(() => (litFrom ? pathSet(nav, litFrom) : null), [nav, litFrom]);
  const cursorNode = cursor ? (L.nodes.find((ln) => ln.node.id === cursor) ?? null) : null;
  const announcement = useMemo(() => (cursor ? announceNode(nav, cursor) : ""), [nav, cursor]);

  // The cursor shows the same tooltip the pointer would, beside the node (placed once the node has rendered).
  const moveCursorTo = (id: string) => {
    setCursor(id);
    const n = nav.nodes.get(id);
    if (!n) return;
    const out = (nav.downstream.get(id) ?? []).filter((e) => e.kind === "money").reduce((s, e) => s + e.amount, 0);
    requestAnimationFrame(() => {
      const el = document.getElementById(nodeDomId(id));
      const fr = figRef.current?.getBoundingClientRect();
      if (!el || !fr) return;
      const r = el.getBoundingClientRect();
      showTip({ kind: "node", node: n, out }, [r.right - fr.left + 8, Math.max(0, r.top - fr.top)]);
    });
  };
  const clearCursor = () => {
    setCursor(null);
    setTip(null);
  };
  const onMapKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.target !== ev.currentTarget) return;
    if (onCameraKey(ev)) return;
    const key = ev.key;
    if (isCursorKey(key)) {
      ev.preventDefault();
      moveCursorTo(moveCursor(nav, cursor, key));
    } else if ((ev.key === "Enter" || ev.key === " ") && cursor) {
      ev.preventDefault();
      selectNode(cursor);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      clearCursor();
      setSelection(null);
    }
  };
  // Keyboard focus lands the cursor on the pinned node or the root; a pointer press places it by clicking instead.
  const pointerDownRef = useRef(false);
  const pressAt = useRef<[number, number] | null>(null);
  const onMapPointerDown = (ev: PointerEvent<HTMLDivElement>) => {
    pointerDownRef.current = true;
    pressAt.current = [ev.clientX, ev.clientY];
  };
  const onMapFocus = (ev: FocusEvent<HTMLDivElement>) => {
    const byPointer = pointerDownRef.current;
    pointerDownRef.current = false;
    if (ev.target === ev.currentTarget && !cursor && !byPointer) moveCursorTo(pinned ?? nav.rootId);
  };
  const onMapBlur = (ev: FocusEvent<HTMLDivElement>) => {
    if (!ev.currentTarget.contains(ev.relatedTarget)) clearCursor();
  };
  /** A click on bare canvas (not a node or edge) unpins the route and drops the cursor; a drag-to-pan does not. */
  const onCanvasClick = (ev: MouseEvent<SVGSVGElement>) => {
    const p = pressAt.current;
    if (p && Math.hypot(ev.clientX - p[0], ev.clientY - p[1]) > 4) return;
    const t = ev.target;
    const bare = t === ev.currentTarget || (t instanceof SVGTextElement && t.parentNode === ev.currentTarget);
    if (!bare) return;
    clearCursor();
    setSelection((cur) => (cur?.kind === "node" ? null : cur));
  };
  const txnsFrom = new Map<string, number>();
  const moneyOut = new Map<string, number>();
  for (const e of graph.edges)
    if (e.kind === "money") {
      txnsFrom.set(e.from, (txnsFrom.get(e.from) ?? 0) + e.count);
      moneyOut.set(e.from, (moneyOut.get(e.from) ?? 0) + e.amount);
    }
  const closed = graph.nodes.filter(
    (n) => n.side === "in" && n.state === "closed",
  ).length;

  const selectedNode =
    selection?.kind === "node"
      ? (graph.nodes.find((n) => n.id === selection.id) ?? null)
      : null;
  const selectedRibbon =
    selection?.kind === "edge"
      ? (L.ribbons.find((r) => edgeKey(r.edge) === selection.key) ?? null)
      : null;
  const byId = useMemo(
    () => new Map<string, ViewNode>(view.nodes.map((n) => [n.id, n])),
    [view],
  );
  const incident: IncidentEdge[] = selectedNode
    ? view.edges.flatMap((e): IncidentEdge[] => {
        if (e.to === selectedNode.id) {
          const other = byId.get(e.from);
          return other ? [{ edge: e, other, direction: "in" }] : [];
        }
        if (e.from === selectedNode.id) {
          const other = byId.get(e.to);
          return other ? [{ edge: e, other, direction: "out" }] : [];
        }
        return [];
      })
    : [];

  return (
    <figure className="chain-figure" ref={figRef}>
      <div className="chain-toolbar" role="toolbar" aria-label="Map zoom">
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={camera.controls.zoomIn}>
          +
        </button>
        <button type="button" aria-label="Zoom out" title="Zoom out (−)" onClick={camera.controls.zoomOut}>
          −
        </button>
        <button type="button" aria-label="Fit the whole map" title="Fit the whole map (0)" onClick={camera.controls.fit}>
          <span aria-hidden="true">⤢</span> fit
        </button>
        <button type="button" aria-label="Actual size, labels at their designed size" title="Actual size" onClick={camera.controls.actual}>
          1:1
        </button>
        <span ref={camera.readoutRef} className="chain-zoom-readout tabular-nums" aria-live="polite" />
        <span className="chain-toolbar-hint">Ctrl/⌘ + scroll to zoom · drag to pan</span>
      </div>
      <div
        className="chain-map-scroll"
        tabIndex={0}
        role="application"
        aria-roledescription="funding map"
        aria-label={`${graph.hasOut ? "Money into and out of" : "Funding chain into"} ${view.rootName}: ${L.nodes.length} nodes, ${L.ribbons.length} edges drawn. Arrow keys move between nodes, Home returns to the spender, Enter opens a node's details, Escape clears. Plus, minus and 0 zoom; Shift with the arrow keys pans. Full detail in the table below.`}
        aria-activedescendant={cursorNode ? nodeDomId(cursorNode.node.id) : undefined}
        data-lit-mode={lit ? (pinned ? "pinned" : "hover") : undefined}
        onKeyDown={onMapKeyDown}
        onFocus={onMapFocus}
        onBlur={onMapBlur}
        onPointerDown={onMapPointerDown}
      >
      <svg
        ref={svgRef}
        viewBox={camera.viewBox}
        width="100%"
        style={{ maxHeight: 880, fontFamily: "var(--font-sans)" }}
        role="group"
        aria-label={`${view.rootName} funding map, ${L.nodes.length} nodes`}
        onClick={onCanvasClick}
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
              {columnLabel(c)}
            </text>
          ))}
        {L.ribbons.map((r) => (
          <RibbonShape
            key={edgeKey(r.edge)}
            r={r}
            selected={selectedRibbon === r}
            lit={lit ? lit.edges.has(edgeKey(r.edge)) : null}
            onSelect={selectEdge}
            pointing={pointing}
          />
        ))}
        {L.nodes.map((ln) => (
          <NodeBox
            key={ln.node.id}
            ln={ln}
            domId={nodeDomId(ln.node.id)}
            txns={txnsFrom.get(ln.node.id) ?? 0}
            out={moneyOut.get(ln.node.id) ?? 0}
            selected={selectedNode?.id === ln.node.id}
            lit={lit ? lit.nodes.has(ln.node.id) : null}
            onSelect={selectNode}
            onToggle={toggle}
            pointing={pointing}
          />
        ))}
        {cursorNode && (
          <rect
            className="chain-cursor"
            x={cursorNode.x - 4}
            y={cursorNode.y - 4}
            width={NODE_W + 8}
            height={cursorNode.h + 8}
            rx={5}
            fill="none"
            pointerEvents="none"
          />
        )}
      </svg>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {tip && (
        <div ref={tipCallback} className="chain-tip" role="tooltip">
          <TipContent body={tip} />
        </div>
      )}
      {selectedNode && (
        <div className="mt-2">
          <NodePanel
            node={selectedNode}
            incident={incident}
            isRoot={selectedNode.id === view.rootId}
            actions={{
              onClose: () => setSelection(null),
              onToggleSources:
                selectedNode.side === "in" &&
                selectedNode.state !== "leaf" &&
                selectedNode.id !== view.rootId
                  ? () => flip("opened", selectedNode.id)
                  : null,
              onToggleChildren:
                selectedNode.children > 0
                  ? () => flip("collapsed", selectedNode.id)
                  : null,
              onHide: () => hide(selectedNode.id),
            }}
          />
        </div>
      )}
      {selectedRibbon && (
        <div className="mt-2">
          <EdgePanel
            edge={selectedRibbon.edge}
            from={selectedRibbon.from.node}
            to={selectedRibbon.to.node}
            hasRow={hasTable && selectedRibbon.edge.index >= 0}
            onSelectNode={selectNode}
            onShowRow={() => revealEdge(selectedRibbon.edge.index)}
            onClose={() => setSelection(null)}
          />
        </div>
      )}
      <figcaption className="mt-1 text-xs text-neutral-500">
        Drawn: the spender, its direct sources and every node carrying at least{" "}
        {Math.round(MATERIAL_SHARE * 100)}% of its receipts
        {graph.hidden.nodes > 0 &&
          ` — ${graph.hidden.nodes} smaller ${graph.hidden.nodes === 1 ? "source" : "sources"} (${money(graph.hidden.amount)}) folded into dashed “other” nodes`}
        {closed > 0 &&
          `; ${closed} ${closed === 1 ? "committee has" : "committees have"} sources not drawn — click + to show them`}
        {graph.hasOut &&
          "; to the right, what the spender paid for and whom it targeted"}
        . Hover for the basics; click any node for its details and evidence
        {hasTable ? ", any edge for its evidence and its row in the table below" : ", any edge for its evidence"}.
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
