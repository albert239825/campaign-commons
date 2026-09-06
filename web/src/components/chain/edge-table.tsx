import type { Chain, ChainEdge } from "@citizen-gotham/contracts";
import { EdgeRows, fromWireRows, toWireRows } from "./edge-rows";
import { EdgeTail } from "./edge-tail";
import type { NodeLinks } from "./links";

/** Rows rendered into the page before the reader has to ask for the rest. */
export const TOP_EDGES = 100;

const byHopThenAmount = (a: ChainEdge, b: ChainEdge) =>
  a.depth - b.depth || b.amount - a.amount;

/**
 * The receipts layer: every drawn (and undrawn) edge with its FEC record link. The largest TOP_EDGES edges are
 * server-rendered; the long tail travels as data and renders on demand.
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
    <div className="space-y-3">
      <EdgeRows rows={head} />
      {tail.rows.length > 0 && (
        <EdgeTail wire={tail} total={chain.edges.length} />
      )}
    </div>
  );
}
