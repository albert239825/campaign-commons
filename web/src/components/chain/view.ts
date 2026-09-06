import type {
  Chain,
  ChainEdge,
  ChainEdgeKind,
  ChainNode,
  Medium,
  SupportOppose,
} from "@campaign-commons/contracts";
import { toBasisWire, type BasisWire } from "./basis";
import { pageHref, type NodeLinks } from "./links";

export type Side = "in" | "out";

/**
 * Compact, serialisable slice of a chain for the client diagram: node/edge fields the picture and the node panel need and
 * nothing else (no dates, transaction codes or per-edge record URLs — those stay in the server-rendered table).
 */
export type ViewNode = Pick<
  ChainNode,
  | "id"
  | "name"
  | "kind"
  | "committee_type"
  | "depth"
  | "visibility"
  | "amount_in"
  | "terminus_reason"
  | "organization_class"
> & {
  /** "in" = funding side (money toward the spender); "out" = spending side (spender → vendor → ad ⇢ candidate). */
  side: Side;
  /** In-app page (entity, donor, vendor, ad card, dossier) when one exists, else the FEC / ad-library record; null when none. */
  href: string | null;
  /** The external record when `href` is an in-app page (so the panel can offer both). */
  record: string | null;
  /** How a derived (spending-side) node's dollars were arrived at; null for nodes read off filings. */
  basis: BasisWire | null;
  medium: Medium | null;
  thumbnail: string | null;
};
export type ViewEdge = Pick<
  ChainEdge,
  "from" | "to" | "amount" | "visibility" | "count"
> & {
  kind: ChainEdgeKind;
  basis: BasisWire | null;
  support_oppose: SupportOppose | null;
  /** Position in `chain.edges`, which is also the edge's row id in the table; -1 for edges synthesised in the client. */
  index: number;
};
export type ChainView = {
  rootId: string;
  rootName: string;
  nodes: ViewNode[];
  edges: ViewEdge[];
};

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
  ViewNode["side"],
  ViewNode["record"],
  ViewNode["basis"],
  ViewNode["medium"],
  ViewNode["thumbnail"],
];
/**
 * [from index, to index, amount, visibility, count, kind (null = money), basis, support/oppose, chain edge index];
 * from / to index into the nodes array.
 */
export type ViewEdgeWire = [
  number,
  number,
  ViewEdge["amount"],
  ViewEdge["visibility"],
  ViewEdge["count"],
  ChainEdgeKind | null,
  BasisWire | null,
  SupportOppose | null,
  number,
];
export type ChainViewWire = {
  rootId: string;
  rootName: string;
  nodes: ViewNodeWire[];
  edges: ViewEdgeWire[];
};

export const sideOf = (n: Pick<ChainNode, "side">): Side =>
  n.side === "out" ? "out" : "in";

export function graphToWire(
  g: { rootId: string; rootName: string; nodes: ChainNode[]; edges: ChainEdge[] },
  links: NodeLinks,
): ChainViewWire {
  const index = new Map(g.nodes.map((n, i) => [n.id, i]));
  return {
    rootId: g.rootId,
    rootName: g.rootName,
    nodes: g.nodes.map((n) => {
      const page = pageHref(n, links);
      return [
        n.id,
        n.name,
        n.kind,
        n.committee_type,
        n.depth,
        n.visibility,
        n.amount_in,
        n.terminus_reason,
        n.organization_class ?? null,
        page ?? n.source_url,
        sideOf(n),
        page ? n.source_url : null,
        toBasisWire(n.basis),
        n.medium ?? null,
        n.thumbnail_path ?? null,
      ];
    }),
    edges: g.edges.flatMap((e, i) => {
      const from = index.get(e.from);
      const to = index.get(e.to);
      if (from === undefined || to === undefined) return [];
      const kind = e.kind ?? "money";
      return [
        [
          from,
          to,
          e.amount,
          e.visibility,
          e.count,
          kind === "money" ? null : kind,
          toBasisWire(e.basis),
          e.support_oppose ?? null,
          i,
        ] as ViewEdgeWire,
      ];
    }),
  };
}

export function toWire(chain: Chain, links: NodeLinks): ChainViewWire {
  return graphToWire(
    {
      rootId: chain.root_entity_id,
      rootName: chain.root_name,
      nodes: chain.nodes,
      edges: chain.edges,
    },
    links,
  );
}

export function fromWire(w: ChainViewWire): ChainView {
  const nodes: ViewNode[] = w.nodes.map(
    ([
      id,
      name,
      kind,
      committee_type,
      depth,
      visibility,
      amount_in,
      terminus_reason,
      organization_class,
      href,
      side,
      record,
      basis,
      medium,
      thumbnail,
    ]) => ({
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
      side,
      record,
      basis,
      medium,
      thumbnail,
    }),
  );
  return {
    rootId: w.rootId,
    rootName: w.rootName,
    nodes,
    edges: w.edges.map(
      ([from, to, amount, visibility, count, kind, basis, support_oppose, index]) => ({
        from: nodes[from].id,
        to: nodes[to].id,
        amount,
        visibility,
        count,
        kind: kind ?? "money",
        basis,
        support_oppose,
        index,
      }),
    ),
  };
}

/**
 * Funding side — leaf: no sources in the chain. closed: sources exist, none drawn. partial: material sources drawn, the
 * rest folded. full: every source drawn. Spending side — leaf: nothing paid for / targeted from here. closed: children
 * exist, collapsed by the reader. full: children drawn.
 */
export type NodeState = "leaf" | "closed" | "partial" | "full";

export type VisibleNode = ViewNode & {
  state: NodeState;
  /** Toggled open by the reader (so a click closes it again). Funding side only. */
  userOpened: boolean;
  /** Aggregates only: how many sources were folded into this node in the picture (beyond the pipeline's own roll-up). */
  folded: number;
  /** Spending side: how many children hang off this node in the chain (drawn or collapsed). */
  children: number;
};

/** What the reader has done to the picture. Every set holds node ids. */
export type GraphControls = {
  /** funding-side nodes whose sources are all drawn */
  opened: ReadonlySet<string>;
  /** spending-side nodes whose children are not drawn */
  collapsed: ReadonlySet<string>;
  /** nodes removed from the picture (with everything only reachable through them) */
  hidden: ReadonlySet<string>;
};

export const NO_CONTROLS: GraphControls = {
  opened: new Set(),
  collapsed: new Set(),
  hidden: new Set(),
};

export type VisibleGraph = {
  nodes: VisibleNode[];
  edges: ViewEdge[];
  /** funding-side sources folded into “other” nodes because they are small */
  hidden: { nodes: number; amount: number };
  /** nodes the reader hid, plus anything that was only reachable through them */
  userHidden: number;
  /** true when the chain carries a spending side at all */
  hasOut: boolean;
};

const plain = (n: ViewNode): VisibleNode => ({
  ...n,
  state: "leaf",
  userOpened: false,
  folded: 0,
  children: 0,
});

const foldId = (parent: string) => `agg:other@${parent}`;

/**
 * The drawn subgraph. Funding side: root and its direct sources always; every node with amount_in >= MATERIAL_SHARE of
 * the root (top MAX_MATERIAL_NODES by amount); every source of a node the reader opened. Anything else is folded into
 * its parent's aggregate node (the pipeline's `agg:other@<parent>` when it exists, else a synthetic one) so dollars
 * still conserve at every drawn parent. Spending side: every out-side node reachable from the root through nodes the
 * reader has not collapsed. Hidden nodes are dropped on both sides and counted in `userHidden`.
 */
export function visibleGraph(
  view: ChainView,
  controls: GraphControls = NO_CONTROLS,
): VisibleGraph {
  const { opened, collapsed, hidden } = controls;
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const root = byId.get(view.rootId);
  const empty: VisibleGraph = {
    nodes: [],
    edges: [],
    hidden: { nodes: 0, amount: 0 },
    userHidden: 0,
    hasOut: false,
  };
  if (!root) return empty;
  const sources = new Map<string, ViewEdge[]>();
  const children = new Map<string, ViewEdge[]>();
  let hasOut = false;
  for (const e of view.edges) {
    const to = byId.get(e.to);
    if (to?.side === "out") {
      hasOut = true;
      const list = children.get(e.from);
      if (list) list.push(e);
      else children.set(e.from, [e]);
      continue;
    }
    const list = sources.get(e.to);
    if (list) list.push(e);
    else sources.set(e.to, [e]);
  }
  const material = new Set(
    view.nodes
      .filter(
        (n) =>
          n.side === "in" &&
          n.depth > 0 &&
          n.kind !== "aggregate" &&
          n.amount_in >= root.amount_in * MATERIAL_SHARE,
      )
      .sort((a, b) => b.amount_in - a.amount_in)
      .slice(0, MAX_MATERIAL_NODES)
      .map((n) => n.id),
  );

  const nodes: VisibleNode[] = [];
  const edges: ViewEdge[] = [];
  const foldedSmall = { nodes: 0, amount: 0 };
  let userHidden = 0;
  const placed = new Set<string>();

  const placeIn = (n: ViewNode) => {
    const own = (sources.get(n.id) ?? []).filter((e) => {
      if (hidden.has(e.from)) {
        userHidden += 1;
        return false;
      }
      return true;
    });
    const open =
      own.length > 0 &&
      (n.id === view.rootId || opened.has(n.id) || material.has(n.id));
    const vn: VisibleNode = {
      ...plain(n),
      state: own.length === 0 ? "leaf" : open ? "full" : "closed",
      userOpened: opened.has(n.id),
    };
    nodes.push(vn);
    placed.add(n.id);
    if (!open) return vn;
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
        if (!placed.has(child.id)) placeIn(child);
      } else {
        folded.push(e);
        foldedSmall.nodes += 1;
        foldedSmall.amount += child.amount_in;
      }
    }
    if (folded.length > 0) {
      vn.state = "partial";
      const amount = folded.reduce((s, e) => s + e.amount, 0);
      const dark = folded
        .filter((e) => e.visibility === "dark")
        .reduce((s, e) => s + e.amount, 0);
      const count = folded.reduce((s, e) => s + e.count, 0);
      if (fold && foldEdge >= 0) {
        const total = fold.amount_in + amount;
        fold = {
          ...fold,
          amount_in: total,
          folded: folded.length,
          visibility: dark > total / 2 ? "dark" : fold.visibility,
        };
        edges[foldEdge] = {
          ...edges[foldEdge],
          amount: total,
          count: edges[foldEdge].count + count,
        };
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
            side: "in",
            record: null,
            basis: null,
            medium: null,
            thumbnail: null,
          }),
          folded: folded.length,
        };
        edges.push({
          from: fold.id,
          to: n.id,
          amount,
          visibility: fold.visibility,
          count,
          kind: "money",
          basis: null,
          support_oppose: null,
          index: -1,
        });
      }
    }
    if (fold) {
      nodes.push(fold);
      placed.add(fold.id);
    }
    return vn;
  };

  // Spending side: breadth-first from the root; a node reached through several parents is drawn once with every edge.
  const placeOut = (vn: VisibleNode) => {
    const own = children.get(vn.id) ?? [];
    vn.children = own.length;
    if (own.length === 0) return;
    if (collapsed.has(vn.id)) {
      vn.state = vn.side === "in" ? vn.state : "closed";
      return;
    }
    if (vn.side === "out") vn.state = "full";
    for (const e of own) {
      if (hidden.has(e.to)) {
        userHidden += 1;
        continue;
      }
      edges.push(e);
      if (placed.has(e.to)) continue;
      const child = byId.get(e.to);
      if (!child) continue;
      const cn = plain(child);
      nodes.push(cn);
      placed.add(cn.id);
      placeOut(cn);
    }
  };

  const rootNode = placeIn(root);
  placeOut(rootNode);
  // Drop edges into out-side nodes that ended up not drawn (reached only through a hidden or collapsed node).
  const drawn = new Set(nodes.map((n) => n.id));
  const kept = edges.filter((e) => drawn.has(e.from) && drawn.has(e.to));
  return { nodes, edges: kept, hidden: foldedSmall, userHidden, hasOut };
}
