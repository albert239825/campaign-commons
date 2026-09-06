import Link from "next/link";
import {
  VISIBILITY_COLORS,
  type Chain,
  type ChainEdge,
  type ChainEdgeKind,
  type ChainNode,
  type Visibility,
} from "@citizen-gotham/contracts";
import { BASIS_LABELS, toBasisWire, type BasisWire } from "./basis";
import { date, money } from "@/lib/format";
import { pageHref, type NodeLinks } from "./links";
import { terminusLabel } from "./terminus";

/** One table row, already resolved against the chain's nodes; serialisable so the long tail can render client-side. */
export type EdgeRow = {
  depth: number;
  from: RowEnd | null;
  to: RowEnd | null;
  amount: number;
  visibility: Visibility;
  count: number;
  transaction_types: string[];
  date_range: [string, string] | null;
  source_url: string | null;
  /** Block 2: placement / targeting edges carry no dollars to `to`; money is the default. */
  kind: ChainEdgeKind;
  basis: BasisWire | null;
};
type RowEnd = {
  name: string;
  href: string | null;
  muted: boolean;
  terminus: string | null;
};

/** Rows on the wire: node ends deduplicated into `ends`, each row a positional tuple indexing into it (-1 = unknown node). */
export type EdgeRowsWire = {
  ends: RowEnd[];
  rows: [
    number,
    number,
    number,
    EdgeRow["amount"],
    EdgeRow["visibility"],
    EdgeRow["count"],
    EdgeRow["transaction_types"],
    EdgeRow["date_range"],
    EdgeRow["source_url"],
    ChainEdgeKind | null,
    BasisWire | null,
  ][];
};

export function toWireRows(
  edges: ChainEdge[],
  chain: Chain,
  links: NodeLinks,
): EdgeRowsWire {
  const byId = new Map(chain.nodes.map((n) => [n.id, n]));
  const ends: RowEnd[] = [];
  const endIndex = new Map<string, number>();
  const end = (id: string, withTerminus: boolean): number => {
    const key = `${withTerminus ? "t" : "n"}:${id}`;
    const seen = endIndex.get(key);
    if (seen !== undefined) return seen;
    const n: ChainNode | undefined = byId.get(id);
    if (!n) return -1;
    const idx =
      ends.push({
        name: n.name,
        href: pageHref(n, links),
        muted: n.kind === "aggregate",
        terminus: withTerminus && n.is_terminus ? terminusLabel(n) : null,
      }) - 1;
    endIndex.set(key, idx);
    return idx;
  };
  return {
    ends,
    rows: edges.map((e) => [
      e.depth,
      end(e.from, true),
      end(e.to, false),
      e.amount,
      e.visibility,
      e.count,
      e.transaction_types,
      e.date_range,
      e.source_url,
      e.kind && e.kind !== "money" ? e.kind : null,
      toBasisWire(e.basis),
    ]),
  };
}

export function fromWireRows(w: EdgeRowsWire): EdgeRow[] {
  return w.rows.map(
    ([
      depth,
      from,
      to,
      amount,
      visibility,
      count,
      transaction_types,
      date_range,
      source_url,
      kind,
      basis,
    ]) => ({
      depth,
      from: from >= 0 ? w.ends[from] : null,
      to: to >= 0 ? w.ends[to] : null,
      amount,
      visibility,
      count,
      transaction_types,
      date_range,
      source_url,
      kind: kind ?? "money",
      basis,
    }),
  );
}

function NodeName({ n }: { n: RowEnd | null }) {
  if (!n) return <span className="none">unknown</span>;
  const name = n.muted ? <span className="muted">{n.name}</span> : n.name;
  if (n.href) {
    return (
      <Link href={n.href} className="ent">
        {name}
      </Link>
    );
  }
  return name;
}

/** Table markup is deliberately class-light (styled via `.edge-table` in globals.css): a hundred rows ship in the page. */
export function EdgeRows({ rows }: { rows: EdgeRow[] }) {
  return (
    <div className="data-table-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable receipt records">
      <table className="edge-table">
        <thead>
          <tr>
            <th>Hop</th>
            <th>From</th>
            <th></th>
            <th>To</th>
            <th className="amount">Amount</th>
            <th>Visibility / evidence</th>
            <th>Txns</th>
            <th>Dates</th>
            <th className="record">Record</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={i}>
              <td className="hop">{e.depth}</td>
              <td>
                <NodeName n={e.from} />
                {e.from?.terminus && (
                  <div className="why">{e.from.terminus}</div>
                )}
              </td>
              <td className="arrow">→</td>
              <td>
                <NodeName n={e.to} />
              </td>
              <td className="amount tabular-nums">
                {e.kind === "money"
                  ? money(e.amount, { compact: false })
                  : `(${money(e.amount, { compact: false })})`}
                {e.kind !== "money" && (
                  <div className="why">
                    {e.kind === "targeting"
                      ? "IE dollars aimed at the candidate; none reach them"
                      : "est. ad spend, range midpoint; no dollars move on this edge"}
                  </div>
                )}
              </td>
              <td className="vis">
                {e.kind === "money" ? (
                  <>
                    <span
                      className="dot"
                      style={{
                        backgroundColor: VISIBILITY_COLORS[e.visibility],
                      }}
                    />
                    {e.visibility}
                  </>
                ) : (
                  <>
                    {e.kind} · {e.basis ? BASIS_LABELS[e.basis[0]] : "filed"}
                    {e.basis && <div className="why">{e.basis[1]}</div>}
                  </>
                )}
              </td>
              <td className="txns">
                {e.count}
                {e.transaction_types.map((t) => (
                  <span
                    key={t}
                    className="code"
                    title="FEC transaction type code"
                  >
                    {t}
                  </span>
                ))}
              </td>
              <td className="dates">
                {e.date_range
                  ? `${date(e.date_range[0])} – ${date(e.date_range[1])}`
                  : "—"}
              </td>
              <td className="record">
                {e.source_url ? (
                  <a
                    href={e.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rec"
                  >
                    {e.source_url.includes("adstransparency.google.com")
                      ? "Ad library ↗"
                      : "FEC ↗"}
                  </a>
                ) : (
                  <span className="none">no record</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
