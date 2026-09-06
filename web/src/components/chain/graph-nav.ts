import type { ViewEdge, VisibleGraph } from "./view";

/**
 * Pure navigation over the drawn subgraph: reachability along drawn edges, the set lit when a node is hovered or
 * cursored, and the keyboard cursor's moves. Edges point left→right as drawn (source → spender on the funding side,
 * spender → vendor → ad → candidate on the spending side), so "upstream" is always `edge.from` and "downstream" `edge.to`,
 * whatever the edge's kind. Nothing here sums money: the lit set is a reading aid, amounts stay per edge.
 */

/** Stable identity of a drawn edge: its table row when it has one, else its ends (client-side folds). */
export const edgeKey = (e: ViewEdge) =>
  e.index >= 0 ? `e${e.index}` : `${e.from}|${e.to}|${e.kind}|${e.support_oppose ?? ""}`;

export type NavNode = VisibleGraph["nodes"][number];

export type NavGraph = {
  rootId: string;
  nodes: ReadonlyMap<string, NavNode>;
  /** Edges into a node (`edge.to === id`), in drawn order. */
  upstream: ReadonlyMap<string, readonly ViewEdge[]>;
  /** Edges out of a node (`edge.from === id`), in drawn order. */
  downstream: ReadonlyMap<string, readonly ViewEdge[]>;
  /** Drawn columns, left to right, each in drawn order (top to bottom). */
  columns: readonly (readonly string[])[];
  columnOf: ReadonlyMap<string, number>;
};

export type PathSet = { nodes: ReadonlySet<string>; edges: ReadonlySet<string> };

export function navGraph(
  graph: Pick<VisibleGraph, "nodes" | "edges">,
  rootId: string,
  columns: readonly (readonly Pick<NavNode, "id">[])[],
): NavGraph {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const upstream = new Map<string, ViewEdge[]>();
  const downstream = new Map<string, ViewEdge[]>();
  for (const e of graph.edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    push(upstream, e.to, e);
    push(downstream, e.from, e);
  }
  const cols = columns.map((c) => c.map((n) => n.id).filter((id) => nodes.has(id)));
  const columnOf = new Map<string, number>();
  cols.forEach((c, i) => c.forEach((id) => columnOf.set(id, i)));
  return { rootId, nodes, upstream, downstream, columns: cols, columnOf };
}

function push(m: Map<string, ViewEdge[]>, k: string, e: ViewEdge) {
  const list = m.get(k);
  if (list) list.push(e);
  else m.set(k, [e]);
}

function reach(
  g: NavGraph,
  id: string,
  via: ReadonlyMap<string, readonly ViewEdge[]>,
  next: (e: ViewEdge) => string,
): Set<string> {
  const seen = new Set<string>();
  if (!g.nodes.has(id)) return seen;
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of via.get(cur) ?? []) {
      const n = next(e);
      if (seen.has(n) || n === id) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

/** Every node upstream of `id` (money sources; on the spending side, the spender and vendor behind an ad). Excludes `id`. */
export const ancestors = (g: NavGraph, id: string): Set<string> => reach(g, id, g.upstream, (e) => e.from);

/** Every node downstream of `id` (toward the spender; past it, vendors, ads, candidates). Excludes `id`. */
export const descendants = (g: NavGraph, id: string): Set<string> => reach(g, id, g.downstream, (e) => e.to);

const withSelf = (s: Set<string>, id: string) => new Set(s).add(id);
const intersect = (a: ReadonlySet<string>, b: ReadonlySet<string>) => new Set([...a].filter((x) => b.has(x)));

/**
 * What lights up for `id`. Funding side: the nodes and edges on any path from `id` to the spender — "how this record
 * reaches the spender" — and nothing behind `id`. Spending side: the path back to the spender plus everything downstream
 * of `id` (an ad lights its sponsor, its placement spine, and its targeting arrows). The spender itself lights the whole
 * picture. Edges are lit only when they lie on such a path, never merely because both ends happen to be lit.
 */
export function pathSet(g: NavGraph, id: string): PathSet {
  const node = g.nodes.get(id);
  if (!node) return { nodes: new Set(), edges: new Set() };
  const all = (m: ReadonlyMap<string, readonly ViewEdge[]>) =>
    new Set([...m.values()].flatMap((es) => es.map(edgeKey)));
  if (id === g.rootId) return { nodes: new Set(g.nodes.keys()), edges: all(g.downstream) };

  const edges = new Set<string>();
  const litWithin = (s: ReadonlySet<string>) => {
    for (const from of s)
      for (const e of g.downstream.get(from) ?? []) if (s.has(e.to)) edges.add(edgeKey(e));
  };
  if (node.side === "in") {
    const route = intersect(withSelf(descendants(g, id), id), withSelf(ancestors(g, g.rootId), g.rootId));
    litWithin(route);
    return { nodes: route, edges };
  }
  const up = intersect(withSelf(ancestors(g, id), id), withSelf(descendants(g, g.rootId), g.rootId));
  const down = withSelf(descendants(g, id), id);
  litWithin(up);
  litWithin(down);
  return { nodes: new Set([...up, ...down]), edges };
}

const largest = (edges: readonly ViewEdge[] | undefined, pick: (e: ViewEdge) => string): string | null => {
  let best: ViewEdge | null = null;
  for (const e of edges ?? []) if (!best || e.amount > best.amount) best = e;
  return best ? pick(best) : null;
};

/** Cursor: the largest-amount neighbour drawn to the left (a source; on the spending side, the payer / placer). */
export const left = (g: NavGraph, id: string): string | null => largest(g.upstream.get(id), (e) => e.from);

/** Cursor: the largest-amount neighbour drawn to the right (toward the spender; past it, what it paid for / aimed at). */
export const right = (g: NavGraph, id: string): string | null => largest(g.downstream.get(id), (e) => e.to);

function sibling(g: NavGraph, id: string, step: 1 | -1): string | null {
  const c = g.columnOf.get(id);
  if (c === undefined) return null;
  const col = g.columns[c];
  const i = col.indexOf(id) + step;
  return i >= 0 && i < col.length ? col[i] : null;
}

/** Cursor: the node drawn just above in the same column. */
export const up = (g: NavGraph, id: string): string | null => sibling(g, id, -1);

/** Cursor: the node drawn just below in the same column. */
export const down = (g: NavGraph, id: string): string | null => sibling(g, id, 1);

/** Cursor: the spender. */
export const home = (g: NavGraph): string => g.rootId;

export type CursorKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home";

/** One keystroke; returns where the cursor lands (unchanged when there is nothing that way). */
export function moveCursor(g: NavGraph, cursor: string | null, key: CursorKey): string {
  if (key === "Home" || cursor === null || !g.nodes.has(cursor)) return home(g);
  const to =
    key === "ArrowLeft"
      ? left(g, cursor)
      : key === "ArrowRight"
        ? right(g, cursor)
        : key === "ArrowUp"
          ? up(g, cursor)
          : down(g, cursor);
  return to ?? cursor;
}

export const isCursorKey = (key: string): key is CursorKey =>
  key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown" || key === "Home";
