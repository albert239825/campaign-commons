import type { ChainNode } from "@citizen-gotham/contracts";
import { donorKey, routes } from "@/lib/format";

/** Which chain nodes have a page of their own in this race. */
export type NodeLinks = {
  raceId: string;
  /** committees with entities/<id>.json */
  entityIds: ReadonlySet<string>;
  /** individuals/organizations with donors/<key>.json */
  donorKeys: ReadonlySet<string>;
};

/** Internal page for the node when one exists (entity page, else donor forward view), otherwise null. */
export function pageHref(n: Pick<ChainNode, "id" | "kind">, links: NodeLinks): string | null {
  if (links.entityIds.has(n.id)) return routes.entity(links.raceId, n.id);
  if (n.kind === "individual" || n.kind === "organization") {
    const key = donorKey(n.id);
    if (links.donorKeys.has(key)) return routes.donor(links.raceId, key);
  }
  return null;
}
