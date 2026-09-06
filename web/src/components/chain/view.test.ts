import { describe, expect, it } from "vitest";
import type { ChainView, ViewEdge, ViewNode } from "./view";
import { visibleGraph } from "./view";

const node = (id: string, depth: number, amount_in: number): ViewNode => ({
  id,
  name: id,
  kind: "committee",
  committee_type: null,
  depth,
  visibility: "disclosed",
  amount_in,
  terminus_reason: null,
  organization_class: undefined,
  side: "in",
  href: null,
  record: null,
  basis: null,
  medium: null,
  thumbnail: null,
});

const edge = (): ViewEdge => ({
  from: "A",
  to: "root",
  amount: 50,
  visibility: "disclosed",
  count: 1,
  kind: "money",
  basis: null,
  support_oppose: null,
});

describe("visibleGraph", () => {
  it("places a node once when parallel edges enter the same root", () => {
    const view: ChainView = {
      rootId: "root",
      rootName: "Root",
      nodes: [node("root", 0, 100), node("A", 1, 50)],
      edges: [edge(), edge()],
    };
    const graph = visibleGraph(view, {
      opened: new Set(["root"]),
      collapsed: new Set(),
      hidden: new Set(),
    });

    expect(graph.nodes.filter((n) => n.id === "A")).toHaveLength(1);
    expect(graph.edges.filter((e) => e.from === "A" && e.to === "root")).toHaveLength(2);
  });
});
