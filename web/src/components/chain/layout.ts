import type { ViewEdge, VisibleNode } from "./view";

/**
 * Layered left-to-right layout for the drawn subgraph of a funding chain (see view.ts for what is drawn).
 * Column = depth (deepest sources on the left, the spender at depth 0 on the right).
 * Node height and ribbon thickness share one dollar scale, so a ribbon visually fills its node.
 */

export const NODE_W = 210;
const COL_GAP = 130;
const NODE_PAD = 14;
const MIN_NODE_H = 28;
const PLOT_H = 380;
const MARGIN_Y = 8;
/** Short chains are centred inside a three-column canvas so they don't scale up to poster size. */
const MIN_COLUMNS = 3;

export type LaidOutNode = { node: VisibleNode; x: number; y: number; h: number };
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

export type ChainLayout = {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  ribbons: Ribbon[];
};

export function layoutChain(nodes: VisibleNode[], edges: ViewEdge[]): ChainLayout {
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth));
  const columns: VisibleNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of nodes) columns[n.depth].push(n);
  for (const col of columns) col.sort((a, b) => b.amount_in - a.amount_in);

  // One dollar scale for every column: the tallest column (in dollars + padding) must fit PLOT_H.
  const tallest = Math.max(...columns.map((c) => c.length));
  const plotH = Math.max(PLOT_H, tallest * (MIN_NODE_H + NODE_PAD));
  const scale = Math.min(
    ...columns.filter((c) => c.length > 0).map((c) => (plotH - (c.length - 1) * NODE_PAD) / c.reduce((s, n) => s + n.amount_in, 0)),
  );
  const heightOf = (n: VisibleNode) => Math.max(MIN_NODE_H, n.amount_in * scale);
  // Minimum heights can push a crowded column past plotH; grow the plot so nothing is clipped.
  const columnH = (col: VisibleNode[]) => col.reduce((s, n) => s + heightOf(n), 0) + Math.max(0, col.length - 1) * NODE_PAD;
  const finalH = Math.max(plotH, ...columns.map(columnH));

  const drawnColumns = Math.max(MIN_COLUMNS, maxDepth + 1);
  const xOffset = ((drawnColumns - (maxDepth + 1)) * (NODE_W + COL_GAP)) / 2;

  const laid: LaidOutNode[] = [];
  const byId = new Map<string, LaidOutNode>();
  columns.forEach((col, depth) => {
    const x = xOffset + (maxDepth - depth) * (NODE_W + COL_GAP);
    let y = MARGIN_Y + (finalH - columnH(col)) / 2;
    for (const node of col) {
      const h = heightOf(node);
      const ln = { node, x, y, h };
      laid.push(ln);
      byId.set(node.id, ln);
      y += h + NODE_PAD;
    }
  });

  // Ribbons: stack outgoing at the source, incoming at the target, both sorted by target/source y.
  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();
  const ribbons: Ribbon[] = [];
  const sorted = edges
    .map((edge) => ({ edge, from: byId.get(edge.from), to: byId.get(edge.to) }))
    .filter((r): r is { edge: ViewEdge; from: LaidOutNode; to: LaidOutNode } => !!r.from && !!r.to)
    .sort((a, b) => a.from.y - b.from.y || a.to.y - b.to.y);
  const widthOf = (edge: ViewEdge, from: LaidOutNode, to: LaidOutNode) => Math.max(1.5, Math.min(edge.amount * scale, from.h, to.h));
  const outTotal = new Map<string, number>();
  const inTotal = new Map<string, number>();
  for (const { edge, from, to } of sorted) {
    const w = widthOf(edge, from, to);
    outTotal.set(from.node.id, (outTotal.get(from.node.id) ?? 0) + w);
    inTotal.set(to.node.id, (inTotal.get(to.node.id) ?? 0) + w);
  }
  for (const { edge, from, to } of sorted) {
    const w = widthOf(edge, from, to);
    const o = outCursor.get(from.node.id) ?? from.y + Math.max(0, (from.h - (outTotal.get(from.node.id) ?? 0)) / 2);
    const i = inCursor.get(to.node.id) ?? to.y + Math.max(0, (to.h - (inTotal.get(to.node.id) ?? 0)) / 2);
    ribbons.push({ edge, from, to, w, y0: o + w / 2, y1: i + w / 2 });
    outCursor.set(from.node.id, o + w);
    inCursor.set(to.node.id, i + w);
  }

  return {
    width: drawnColumns * NODE_W + (drawnColumns - 1) * COL_GAP,
    height: finalH + 2 * MARGIN_Y,
    nodes: laid,
    ribbons,
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
