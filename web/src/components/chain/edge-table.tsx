import type { Chain, ChainEdge } from "@campaign-commons/contracts";
import { EdgeLedger } from "./edge-ledger";
import { EdgeRows, fromWireRows, toWireRows } from "./edge-rows";
import type { NodeLinks } from "./links";

/** Rows rendered into the page before the reader has to ask for the rest. */
export const TOP_EDGES = 100;

const byHopThenAmount = (a: ChainEdge, b: ChainEdge) =>
  a.depth - b.depth || b.amount - a.amount;

/**
 * The receipts layer: every drawn (and undrawn) edge with its FEC record link, folded until asked for. The largest
 * TOP_EDGES edges are server-rendered; the long tail travels as data and renders on demand. Rows carry the edge's
 * index in `chain.edges` as their id so the picture can point at them.
 */
export function EdgeTable({
  chain,
  links,
}: {
  chain: Chain;
  links: NodeLinks;
}) {
  const byAmount = chain.edges.slice().sort((a, b) => b.amount - a.amount);
  const head = fromWireRows(
    toWireRows(
      byAmount.slice(0, TOP_EDGES).sort(byHopThenAmount),
      chain,
      links,
    ),
  );
  const tail = toWireRows(
    byAmount.slice(TOP_EDGES).sort(byHopThenAmount),
    chain,
    links,
  );
  return (
    <EdgeLedger tail={tail} total={chain.edges.length} headCount={head.length}>
      <EdgeRows rows={head} />
    </EdgeLedger>
  );
}
