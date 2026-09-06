import type { TrailAnswer, TrailGraph, TrailGraphTruncation } from "@campaign-commons/contracts";
import { graphToWire, type ChainViewWire } from "@/components/chain/view";
import type { NodeLinks } from "@/components/chain/links";

export const LAYER_LABELS: Record<TrailGraphTruncation["layer"], string> = {
  funders_1: "direct funders",
  funders_2: "funders one hop further back",
  spenders: "outside spenders",
  sponsors: "ad sponsors",
  vendors: "vendors",
  ads: "ads",
};

/**
 * Candidate-rooted graphs draw the funding/targeting side only. The candidate is treated as the picture's root so
 * the chain layout places it where a spender normally sits; committee-rooted graphs keep both sides.
 */
export function trailGraphWire(answer: TrailAnswer, graph: TrailGraph, links: NodeLinks): ChainViewWire {
  const candidateRooted = answer.intent === "candidate_spender" || answer.intent === "candidate_ad_funding";
  const nodes = candidateRooted ? graph.nodes.filter((n) => n.side !== "out" || n.id === graph.root_id) : graph.nodes;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const wire = graphToWire(
    {
      rootId: graph.root_id,
      rootName: answer.subject_name,
      nodes,
      edges,
    },
    links,
  );
  if (candidateRooted) {
    const rootIndex = wire.nodes.findIndex(([id]) => id === graph.root_id);
    if (rootIndex >= 0) wire.nodes[rootIndex][10] = "in";
  }
  return wire;
}

export function truncationSentence(graph: TrailGraph): string | null {
  if (graph.truncated.length === 0) return null;
  const parts = graph.truncated.map((t) => `the ${t.kept} largest of ${t.kept + t.hidden} ${LAYER_LABELS[t.layer]}`);
  return `Showing ${parts.join(" and ")}.`;
}
