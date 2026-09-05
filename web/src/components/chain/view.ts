import type { Chain, ChainEdge, ChainNode } from "@citizen-gotham/contracts";
import { pageHref, type NodeLinks } from "./links";

/**
 * Compact, serialisable slice of a chain for the client diagram: node/edge fields the picture needs and
 * nothing else (no dates, transaction codes or per-edge record URLs — those stay in the server-rendered table).
 */
export type ViewNode = Pick<ChainNode, "id" | "name" | "kind" | "committee_type" | "depth" | "visibility" | "amount_in" | "terminus_reason" | "organization_class"> & {
  /** Entity page for committees in this race or donor page for a top source, else the FEC record; null when none exists. */
  href: string | null;
};
export type ViewEdge = Pick<ChainEdge, "from" | "to" | "amount" | "visibility" | "count">;
export type ChainView = { rootId: string; rootName: string; nodes: ViewNode[]; edges: ViewEdge[] };

/** Nodes whose dollars are at least this share of the root's receipts are drawn without a click. */
export const MATERIAL_SHARE = 0.02;
/** Hard ceiling on nodes drawn without a click, in case a chain is very flat. */
export const MAX_MATERIAL_NODES = 40;

/** Wire form of ChainView: positional tuples, because the payload ships inline in every chain page. */
export type ViewNodeWire = [
  ViewNode["id"],
  ViewNode["name"],
  ViewNode["kind"],
  ViewNode["committee_type"],
  ViewNode["depth"],
  ViewNode["visibility"],
  ViewNode["amount_in"],
  ViewNode["terminus_reason"],
  ViewNode["organization_class"] | null,
  ViewNode["href"],
];
/** [from index, to index, amount, visibility, count]; indices into the nodes array. */
export type ViewEdgeWire = [number, number, ViewEdge["amount"], ViewEdge["visibility"], ViewEdge["count"]];
export type ChainViewWire = { rootId: string; rootName: string; nodes: ViewNodeWire[]; edges: ViewEdgeWire[] };

export function toWire(chain: Chain, links: NodeLinks): ChainViewWire {
  const index = new Map(chain.nodes.map((n, i) => [n.id, i]));
  return {
    rootId: chain.root_entity_id,
    rootName: chain.root_name,
    nodes: chain.nodes.map((n) => [
      n.id,
      n.name,
      n.kind,
      n.committee_type,
      n.depth,
      n.visibility,
      n.amount_in,
      n.terminus_reason,
      n.organization_class ?? null,
      pageHref(n, links) ?? n.source_url,
    ]),
    edges: chain.edges.flatMap((e) => {
      const from = index.get(e.from);
      const to = index.get(e.to);
      return from === undefined || to === undefined ? [] : [[from, to, e.amount, e.visibility, e.count] as ViewEdgeWire];
    }),
  };
}

export function fromWire(w: ChainViewWire): ChainView {
  const nodes: ViewNode[] = w.nodes.map(([id, name, kind, committee_type, depth, visibility, amount_in, terminus_reason, organization_class, href]) => ({
    id,
    name,
    kind,
    committee_type,
    depth,
    visibility,
    amount_in,
    terminus_reason,
    organization_class: organization_class ?? undefined,
    href,
  }));
  return {
    rootId: w.rootId,
    rootName: w.rootName,
    nodes,
    edges: w.edges.map(([from, to, amount, visibility, count]) => ({ from: nodes[from].id, to: nodes[to].id, amount, visibility, count })),
  };
}

/**
 * leaf: no sources in the chain. closed: sources exist, none drawn. partial: material sources drawn, the rest
 * folded. full: every source drawn. Clicking a non-root node toggles it between the default and `full`.
 */
export type NodeState = "leaf" | "closed" | "partial" | "full";

export type VisibleNode = ViewNode & {
  state: NodeState;
  /** Toggled open by the user (so a click closes it again). */
  userOpened: boolean;
  /** Aggregates only: how many sources were folded into this node in the picture (beyond the pipeline's own roll-up). */
  folded: number;
};

export type VisibleGraph = { nodes: VisibleNode[]; edges: ViewEdge[]; hidden: { nodes: number; amount: number } };

const plain = (n: ViewNode): VisibleNode => ({ ...n, state: "leaf", userOpened: false, folded: 0 });

const foldId = (parent: string) => `agg:other@${parent}`;

/**
 * The drawn subgraph. Root and its direct sources always; every node with amount_in >= MATERIAL_SHARE of the root
 * (top MAX_MATERIAL_NODES by amount); every source of a node the user opened. Anything else is folded into its
 * parent's aggregate node (the pipeline's `agg:other@<parent>` when it exists, else a synthetic one) so dollars still
 * conserve at every drawn parent.
 */
export function visibleGraph(view: ChainView, opened: ReadonlySet<string>): VisibleGraph {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const root = byId.get(view.rootId);
  if (!root) return { nodes: [], edges: [], hidden: { nodes: 0, amount: 0 } };
  const sources = new Map<string, ViewEdge[]>();
  for (const e of view.edges) {
    const list = sources.get(e.to);
    if (list) list.push(e);
    else sources.set(e.to, [e]);
  }
  const material = new Set(
    view.nodes
      .filter((n) => n.depth > 0 && n.kind !== "aggregate" && n.amount_in >= root.amount_in * MATERIAL_SHARE)
      .sort((a, b) => b.amount_in - a.amount_in)
      .slice(0, MAX_MATERIAL_NODES)
      .map((n) => n.id),
  );

  const nodes: VisibleNode[] = [];
  const edges: ViewEdge[] = [];
  const hidden = { nodes: 0, amount: 0 };
  const place = (n: ViewNode) => {
    const own = sources.get(n.id) ?? [];
    const open = own.length > 0 && (n.id === view.rootId || opened.has(n.id) || material.has(n.id));
    const vn: VisibleNode = { ...plain(n), state: own.length === 0 ? "leaf" : open ? "full" : "closed", userOpened: opened.has(n.id) };
    nodes.push(vn);
    if (!open) return;
    const showAll = n.id === view.rootId || opened.has(n.id);
    let fold: VisibleNode | null = null;
    let foldEdge = -1;
    const folded: ViewEdge[] = [];
    for (const e of own) {
      const child = byId.get(e.from);
      if (!child) continue;
      if (child.kind === "aggregate") {
        fold = plain(child);
        foldEdge = edges.push(e) - 1;
        continue;
      }
      if (showAll || material.has(child.id)) {
        edges.push(e);
        place(child);
      } else {
        folded.push(e);
        hidden.nodes += 1;
        hidden.amount += child.amount_in;
      }
    }
    if (folded.length > 0) {
      vn.state = "partial";
      const amount = folded.reduce((s, e) => s + e.amount, 0);
      const dark = folded.filter((e) => e.visibility === "dark").reduce((s, e) => s + e.amount, 0);
      const count = folded.reduce((s, e) => s + e.count, 0);
      if (fold && foldEdge >= 0) {
        const total = fold.amount_in + amount;
        fold = { ...fold, amount_in: total, folded: folded.length, visibility: dark > total / 2 ? "dark" : fold.visibility };
        edges[foldEdge] = { ...edges[foldEdge], amount: total, count: edges[foldEdge].count + count };
      } else {
        fold = {
          ...plain({
            id: foldId(n.id),
            name: `Other sources of ${n.name}`,
            kind: "aggregate",
            committee_type: null,
            depth: n.depth + 1,
            visibility: dark > amount / 2 ? "dark" : "disclosed",
            amount_in: amount,
            terminus_reason: "pruned",
            href: null,
          }),
          folded: folded.length,
        };
        edges.push({ from: fold.id, to: n.id, amount, visibility: fold.visibility, count });
      }
    }
    if (fold) nodes.push(fold);
  };
  place(root);
  return { nodes, edges, hidden };
}
