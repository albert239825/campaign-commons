import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  ancestors,
  descendants,
  down,
  edgeKey,
  home,
  left,
  moveCursor,
  navGraph,
  pathSet,
  right,
  up,
  type NavNode,
} from "./graph-nav";
import type { ViewEdge } from "./view";

const node = (id: string, side: "in" | "out", kind: NavNode["kind"], amount_in: number, depth: number): NavNode => ({
  id,
  name: id,
  kind,
  committee_type: null,
  depth,
  visibility: "disclosed",
  amount_in,
  terminus_reason: null,
  organization_class: undefined,
  href: null,
  side,
  record: null,
  basis: null,
  medium: null,
  thumbnail: null,
  state: "leaf",
  userOpened: false,
  folded: 0,
  children: 0,
});

let n = 0;
const edge = (from: string, to: string, amount: number, kind: ViewEdge["kind"] = "money"): ViewEdge => ({
  from,
  to,
  amount,
  visibility: "disclosed",
  count: 1,
  kind,
  basis: null,
  support_oppose: kind === "targeting" ? "O" : null,
  index: n++,
});

// Funding side: FFPR → DemPAC → SMP → W; Other (fold) → DemPAC; Y → X → W. Spending side: W → V (paid), V ⇢ A1, A2
// (placement), A1 ⇢ C, A2 ⇢ C (targeting).
const nodes = [
  node("W", "in", "committee", 400, 0),
  node("SMP", "in", "committee", 313, 1),
  node("X", "in", "committee", 10, 1),
  node("DemPAC", "in", "committee", 71, 2),
  node("Y", "in", "individual", 5, 2),
  node("FFPR", "in", "organization", 60, 3),
  node("Other", "in", "aggregate", 11, 3),
  node("V", "out", "vendor", 100, 1),
  node("A1", "out", "ad", 20, 2),
  node("A2", "out", "ad", 15, 2),
  node("C", "out", "candidate", 35, 3),
];
const e = {
  smpW: edge("SMP", "W", 313),
  xW: edge("X", "W", 10),
  demSmp: edge("DemPAC", "SMP", 71),
  ffprDem: edge("FFPR", "DemPAC", 60),
  otherDem: edge("Other", "DemPAC", 11),
  yX: edge("Y", "X", 5),
  wV: edge("W", "V", 100),
  vA1: edge("V", "A1", 20, "placement"),
  vA2: edge("V", "A2", 15, "placement"),
  a1C: edge("A1", "C", 20, "targeting"),
  a2C: edge("A2", "C", 15, "targeting"),
};
const columns = [["FFPR", "Other"], ["DemPAC", "Y"], ["SMP", "X"], ["W"], ["V"], ["A1", "A2"], ["C"]].map((c) =>
  c.map((id) => ({ id })),
);
const g = navGraph({ nodes, edges: Object.values(e) }, "W", columns);

const ids = (s: ReadonlySet<string>) => [...s].sort();
const keys = (...es: ViewEdge[]) => es.map(edgeKey).sort();

describe("reachability", () => {
  it("ancestors walk upstream along every edge kind", () => {
    assert.deepEqual(ids(ancestors(g, "W")), ["DemPAC", "FFPR", "Other", "SMP", "X", "Y"]);
    assert.deepEqual(ids(ancestors(g, "C")), ["A1", "A2", "DemPAC", "FFPR", "Other", "SMP", "V", "W", "X", "Y"]);
    assert.deepEqual(ids(ancestors(g, "V")), ["DemPAC", "FFPR", "Other", "SMP", "W", "X", "Y"]);
    assert.deepEqual(ids(ancestors(g, "FFPR")), []);
  });
  it("descendants walk downstream along every edge kind", () => {
    assert.deepEqual(ids(descendants(g, "FFPR")), ["A1", "A2", "C", "DemPAC", "SMP", "V", "W"]);
    assert.deepEqual(ids(descendants(g, "V")), ["A1", "A2", "C"]);
    assert.deepEqual(ids(descendants(g, "C")), []);
  });
});

describe("pathSet", () => {
  it("funding-side node lights exactly its route to the spender", () => {
    const p = pathSet(g, "FFPR");
    assert.deepEqual(ids(p.nodes), ["DemPAC", "FFPR", "SMP", "W"]);
    assert.deepEqual([...p.edges].sort(), keys(e.ffprDem, e.demSmp, e.smpW));
  });
  it("an intermediary does not light what is behind it", () => {
    const p = pathSet(g, "DemPAC");
    assert.deepEqual(ids(p.nodes), ["DemPAC", "SMP", "W"]);
    assert.deepEqual([...p.edges].sort(), keys(e.demSmp, e.smpW));
  });
  it("an ad lights sponsor, placement spine, and its targeting arrow only", () => {
    const p = pathSet(g, "A1");
    assert.deepEqual(ids(p.nodes), ["A1", "C", "V", "W"]);
    assert.deepEqual([...p.edges].sort(), keys(e.wV, e.vA1, e.a1C));
  });
  it("a candidate lights every arrow aimed at it and the money behind them", () => {
    const p = pathSet(g, "C");
    assert.deepEqual(ids(p.nodes), ["A1", "A2", "C", "V", "W"]);
    assert.deepEqual([...p.edges].sort(), keys(e.wV, e.vA1, e.vA2, e.a1C, e.a2C));
  });
  it("the spender lights everything; an unknown id lights nothing", () => {
    assert.equal(pathSet(g, "W").nodes.size, nodes.length);
    assert.equal(pathSet(g, "W").edges.size, Object.keys(e).length);
    assert.equal(pathSet(g, "nope").nodes.size, 0);
  });
});

describe("cursor", () => {
  it("left/right follow the largest-amount edge", () => {
    assert.equal(left(g, "W"), "SMP");
    assert.equal(left(g, "DemPAC"), "FFPR");
    assert.equal(right(g, "FFPR"), "DemPAC");
    assert.equal(right(g, "W"), "V");
    assert.equal(right(g, "V"), "A1");
    assert.equal(right(g, "C"), null);
    assert.equal(left(g, "FFPR"), null);
  });
  it("up/down walk the drawn column", () => {
    assert.equal(down(g, "SMP"), "X");
    assert.equal(up(g, "X"), "SMP");
    assert.equal(up(g, "SMP"), null);
    assert.equal(down(g, "W"), null);
  });
  it("Home and a null cursor land on the spender; a dead end keeps the cursor", () => {
    assert.equal(home(g), "W");
    assert.equal(moveCursor(g, null, "ArrowLeft"), "W");
    assert.equal(moveCursor(g, "A2", "Home"), "W");
    assert.equal(moveCursor(g, "C", "ArrowRight"), "C");
    assert.equal(moveCursor(g, "W", "ArrowLeft"), "SMP");
  });
});
