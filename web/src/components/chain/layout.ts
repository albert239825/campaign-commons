import type { ViewEdge, VisibleNode } from "./view";

/**
 * Layered left-to-right layout for the drawn subgraph of a chain (see view.ts for what is drawn).
 * Funding side: column = depth, deepest sources on the left, the spender at depth 0 in the middle.
 * Spending side: columns continue to the right (vendors, then ads, then the candidate targeted).
 * Node height and ribbon thickness share one dollar scale, so a ribbon visually fills its node. Only nodes whose
 * amount is filed money (funding side, vendors) are on that scale; ads, folded ads and targeted candidates carry
 * platform spend-range midpoints or targeting totals, so they get fixed heights instead of pretending to be dollars.
 */

export const NODE_W = 210;
const COL_GAP = 130;
const NODE_PAD = 14;
const MIN_NODE_H = 28;
/** Ad nodes carry a thumbnail; every ad is drawn at this height regardless of its spend range. */
const AD_H = 58;
const PLOT_H = 380;
const MARGIN_Y = 8;
/** Short chains are centred inside a three-column canvas so they don't scale up to poster size. */
const MIN_COLUMNS = 3;
/** Stroke width of placement / targeting spines. */
export const SPINE_W = 2;

export type LaidOutNode = {
  node: VisibleNode;
  x: number;
  y: number;
  h: number;
  column: number;
};
export type Ribbon = {
  edge: ViewEdge;
  from: LaidOutNode;
  to: LaidOutNode;
  /** Ribbon thickness in px. */
  w: number;
  /** Vertical centre of the ribbon at the source's right edge / the target's left edge. */
  y0: number;
  y1: number;
};

export type Column = {
  index: number;
  x: number;
  side: "in" | "out";
  depth: number;
  nodes: VisibleNode[];
};

export type ChainLayout = {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  ribbons: Ribbon[];
  columns: Column[];
};

export function layoutChain(
  nodes: VisibleNode[],
  edges: ViewEdge[],
): ChainLayout {
  const maxIn = Math.max(
    0,
    ...nodes.filter((n) => n.side === "in").map((n) => n.depth),
  );
  const maxOut = Math.max(
    0,
    ...nodes.filter((n) => n.side === "out").map((n) => n.depth),
  );
  const columnOf = (n: VisibleNode) =>
    n.side === "in" ? maxIn - n.depth : maxIn + n.depth;
  const columnCount = maxIn + maxOut + 1;
  const columns: Column[] = Array.from({ length: columnCount }, (_, i) => ({
    index: i,
    x: 0,
    side: i <= maxIn ? "in" : "out",
    depth: i <= maxIn ? maxIn - i : i - maxIn,
    nodes: [],
  }));
  for (const n of nodes) columns[columnOf(n)].nodes.push(n);
  for (const col of columns)
    col.nodes.sort((a, b) => b.amount_in - a.amount_in);

  const fixedH = (n: VisibleNode): number | null => {
    if (n.kind === "ad") return AD_H;
    if (n.side === "out" && n.kind !== "vendor") return MIN_NODE_H;
    return null;
  };
  const dollars = (n: VisibleNode) => (fixedH(n) === null ? n.amount_in : 0);
  // One dollar scale for every column: the tallest column (in dollars + fixed nodes + padding) must fit PLOT_H.
  const tallest = Math.max(...columns.map((c) => c.nodes.length));
  const plotH = Math.max(PLOT_H, tallest * (MIN_NODE_H + NODE_PAD));
  const scale = Math.min(
    ...columns
      .filter((c) => c.nodes.some((n) => fixedH(n) === null))
      .map(
        (c) =>
          (plotH -
            (c.nodes.length - 1) * NODE_PAD -
            c.nodes.reduce((s, n) => s + (fixedH(n) ?? 0), 0)) /
          Math.max(
            1,
            c.nodes.reduce((s, n) => s + dollars(n), 0),
          ),
      ),
  );
  const heightOf = (n: VisibleNode) =>
    fixedH(n) ?? Math.max(MIN_NODE_H, n.amount_in * scale);
  // Minimum heights can push a crowded column past plotH; grow the plot so nothing is clipped.
  const columnH = (col: VisibleNode[]) =>
    col.reduce((s, n) => s + heightOf(n), 0) +
    Math.max(0, col.length - 1) * NODE_PAD;
  const finalH = Math.max(plotH, ...columns.map((c) => columnH(c.nodes)));

  const drawnColumns = Math.max(MIN_COLUMNS, columnCount);
  const xOffset = ((drawnColumns - columnCount) * (NODE_W + COL_GAP)) / 2;

  const laid: LaidOutNode[] = [];
  const byId = new Map<string, LaidOutNode>();
  for (const col of columns) {
    const x = xOffset + col.index * (NODE_W + COL_GAP);
    col.x = x;
    let y = MARGIN_Y + (finalH - columnH(col.nodes)) / 2;
    for (const node of col.nodes) {
      const h = heightOf(node);
      const ln = { node, x, y, h, column: col.index };
      laid.push(ln);
      byId.set(node.id, ln);
      y += h + NODE_PAD;
    }
  }

  // Ribbons. Money edges stack at both ends (outgoing at the source, incoming at the target, sorted by the other end's y)
  // so a node's band is filled by its dollars. Placement / targeting edges carry no dollars to the target, so they are
  // thin spines from centre to centre and never take up room in the stacks.
  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();
  const ribbons: Ribbon[] = [];
  const resolved = edges
    .map((edge) => ({ edge, from: byId.get(edge.from), to: byId.get(edge.to) }))
    .filter(
      (r): r is { edge: ViewEdge; from: LaidOutNode; to: LaidOutNode } =>
        !!r.from && !!r.to,
    )
    .sort((a, b) => a.from.y - b.from.y || a.to.y - b.to.y);
  const money = resolved.filter((r) => r.edge.kind === "money");
  const widthOf = (edge: ViewEdge, from: LaidOutNode, to: LaidOutNode) =>
    Math.max(1.5, Math.min(edge.amount * scale, from.h, to.h));
  const outTotal = new Map<string, number>();
  const inTotal = new Map<string, number>();
  for (const { edge, from, to } of money) {
    const w = widthOf(edge, from, to);
    outTotal.set(from.node.id, (outTotal.get(from.node.id) ?? 0) + w);
    inTotal.set(to.node.id, (inTotal.get(to.node.id) ?? 0) + w);
  }
  for (const { edge, from, to } of money) {
    const w = widthOf(edge, from, to);
    const o =
      outCursor.get(from.node.id) ??
      from.y + Math.max(0, (from.h - (outTotal.get(from.node.id) ?? 0)) / 2);
    const i =
      inCursor.get(to.node.id) ??
      to.y + Math.max(0, (to.h - (inTotal.get(to.node.id) ?? 0)) / 2);
    ribbons.push({ edge, from, to, w, y0: o + w / 2, y1: i + w / 2 });
    outCursor.set(from.node.id, o + w);
    inCursor.set(to.node.id, i + w);
  }
  for (const { edge, from, to } of resolved) {
    if (edge.kind === "money") continue;
    ribbons.push({
      edge,
      from,
      to,
      w: SPINE_W,
      y0: from.y + from.h / 2,
      y1: to.y + to.h / 2,
    });
  }

  return {
    width: drawnColumns * NODE_W + (drawnColumns - 1) * COL_GAP,
    height: finalH + 2 * MARGIN_Y,
    nodes: laid,
    ribbons,
    columns,
  };
}

export function ribbonPath(r: Ribbon): string {
  const x0 = r.from.x + NODE_W;
  const x1 = r.to.x;
  const cx = (x0 + x1) / 2;
  const top0 = r.y0 - r.w / 2;
  const bot0 = r.y0 + r.w / 2;
  const top1 = r.y1 - r.w / 2;
  const bot1 = r.y1 + r.w / 2;
  return `M${x0},${top0} C${cx},${top0} ${cx},${top1} ${x1},${top1} L${x1},${bot1} C${cx},${bot1} ${cx},${bot0} ${x0},${bot0} Z`;
}

/** Centre line of a ribbon, for edges drawn as a stroke (placement / targeting) rather than a filled band. */
export function ribbonSpine(r: Ribbon): string {
  const x0 = r.from.x + NODE_W;
  const x1 = r.to.x;
  const cx = (x0 + x1) / 2;
  return `M${x0},${r.y0} C${cx},${r.y0} ${cx},${r.y1} ${x1},${r.y1}`;
}

/** Column caption: what kind of thing sits in this column. */
export function columnLabel(col: Column, rootLabel = "spender"): string {
  if (col.side === "in")
    return col.depth === 0 ? rootLabel.toUpperCase() : `HOP ${col.depth}`;
  const kinds = new Set(col.nodes.map((n) => n.kind));
  if (kinds.has("candidate"))
    return kinds.size === 1 ? "TARGETED" : "ADS · TARGETED";
  if (kinds.has("vendor"))
    return kinds.has("ad") || kinds.has("aggregate")
      ? "VENDORS · ADS"
      : "PAID VENDORS";
  return "ADS";
}
