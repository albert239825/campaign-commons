import type { ChainEdge, ChainNode, TrailAnswer, TrailGraph } from "@campaign-commons/contracts";
import { describe, expect, it } from "vitest";
import { fromWire, visibleGraph } from "@/components/chain/view";
import type { NodeLinks } from "@/components/chain/links";
import { trailGraphWire, truncationSentence } from "./trail-graph";

const basis = {
  basis: "filed" as const,
  rule: "test fixture",
  source_urls: ["https://example.com/record"],
  checked_by: null,
  checked_at: null,
};

function node(overrides: Partial<ChainNode>): ChainNode {
  return {
    id: "N",
    name: "Node",
    kind: "committee",
    committee_type: null,
    depth: 0,
    visibility: "disclosed",
    amount_in: 100,
    is_terminus: false,
    terminus_reason: null,
    source_url: "https://example.com/node",
    ...overrides,
  } as ChainNode;
}

function edge(overrides: Partial<ChainEdge>): ChainEdge {
  return {
    from: "N",
    to: "M",
    amount: 100,
    visibility: "disclosed",
    depth: 1,
    transaction_types: ["test"],
    count: 1,
    date_range: null,
    source_url: "https://example.com/edge",
    kind: "money",
    ...overrides,
  } as ChainEdge;
}

const links: NodeLinks = {
  raceId: "pa-sen-2024",
  entityIds: new Set(),
  donorKeys: new Set(),
};

const candidateGraph: TrailGraph = {
  root_id: "S1",
  nodes: [
    node({ id: "S1", name: "Casey", kind: "candidate", side: "out", depth: 0, basis }),
    node({ id: "C1", name: "Committee One", side: "in", depth: 1 }),
    node({ id: "C2", name: "Committee Two", side: "in", depth: 1 }),
    node({ id: "F1", name: "Funder One", side: "in", depth: 2 }),
    node({ id: "A1", name: "Ad One", kind: "ad", side: "out", depth: 2, basis }),
  ],
  edges: [
    edge({ from: "C1", to: "S1", kind: "targeting", depth: 1, support_oppose: "O" }),
    edge({ from: "C2", to: "S1", kind: "targeting", depth: 1, support_oppose: "S" }),
    edge({ from: "F1", to: "C1", depth: 2 }),
    edge({ from: "C1", to: "A1", kind: "placement", depth: 2, basis }),
  ],
  truncated: [{ layer: "spenders", kept: 5, hidden: 3 }],
};

const candidateAnswer = {
  intent: "candidate_spender",
  subject_name: "Casey",
} as TrailAnswer;

describe("trailGraphWire", () => {
  it("keeps the candidate-rooted funding side and remaps edges", () => {
    const wire = trailGraphWire(candidateAnswer, candidateGraph, links);
    const view = fromWire(wire);

    expect(view.nodes.map((n) => n.id)).toEqual(["S1", "C1", "C2", "F1"]);
    expect(view.nodes.find((n) => n.id === "S1")?.side).toBe("in");
    expect(view.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["C1->S1", "C2->S1", "F1->C1"]);
  });

  it("keeps every candidate fixture node open when all in-side ids are opened", () => {
    const view = fromWire(trailGraphWire(candidateAnswer, candidateGraph, links));
    const graph = visibleGraph(view, {
      opened: new Set(view.nodes.filter((n) => n.side === "in").map((n) => n.id)),
      collapsed: new Set(),
      hidden: new Set(),
    });

    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["C1", "C2", "F1", "S1"]);
    expect(graph.hidden.nodes).toBe(0);
  });

  it("keeps both sides for committee-rooted graphs", () => {
    const graph: TrailGraph = {
      root_id: "C0",
      nodes: [
        node({ id: "C0", name: "Committee Zero", depth: 0 }),
        node({ id: "V1", name: "Vendor One", kind: "vendor", side: "out", depth: 1, basis }),
        node({ id: "A1", name: "Ad One", kind: "ad", side: "out", depth: 2, basis }),
      ],
      edges: [
        edge({ from: "C0", to: "V1", depth: 1 }),
        edge({ from: "V1", to: "A1", kind: "placement", depth: 2, basis }),
      ],
      truncated: [],
    };
    const wire = trailGraphWire(
      { intent: "committee_funding", subject_name: "Committee Zero" } as TrailAnswer,
      graph,
      links,
    );
    const view = fromWire(wire);

    expect(view.nodes.map((n) => [n.id, n.side])).toEqual([
      ["C0", "in"],
      ["V1", "out"],
      ["A1", "out"],
    ]);
  });
});

describe("truncationSentence", () => {
  it("returns null when no layer was cut", () => {
    expect(truncationSentence({ ...candidateGraph, truncated: [] })).toBeNull();
  });

  it("describes one and two truncated layers", () => {
    expect(truncationSentence(candidateGraph)).toBe("Showing the 5 largest of 8 outside spenders.");
    expect(
      truncationSentence({
        ...candidateGraph,
        truncated: [
          { layer: "spenders", kept: 5, hidden: 3 },
          { layer: "funders_1", kept: 5, hidden: 60 },
        ],
      }),
    ).toBe("Showing the 5 largest of 8 outside spenders and the 5 largest of 65 direct funders.");
    expect(
      truncationSentence(
        {
          ...candidateGraph,
          truncated: [
            { layer: "spenders", kept: 5, hidden: 3 },
            { layer: "ads", kept: 5, hidden: 28 },
          ],
        },
        new Set(["spenders", "funders_1", "funders_2", "sponsors"]),
      ),
    ).toBe("Showing the 5 largest of 8 outside spenders.");
  });
});
