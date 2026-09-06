/**
 * The picture and the receipts table are separate islands on the page (client diagram, server-rendered rows), so an
 * edge click reaches its row through a DOM event and a stable row id rather than shared React state.
 */

export const REVEAL_EDGE_EVENT = "chain:reveal-edge";

/** Row id of the edge at `index` in `chain.edges`; the same index travels on the diagram wire. */
export const edgeRowId = (index: number) => `edge-${index}`;

export const edgeIndexFromHash = (hash: string): number | null => {
  const m = /^#edge-(\d+)$/.exec(hash);
  return m ? Number(m[1]) : null;
};

export function revealEdge(index: number) {
  if (index < 0 || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<number>(REVEAL_EDGE_EVENT, { detail: index }));
}
