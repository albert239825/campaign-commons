import type { ChainNode } from "@campaign-commons/contracts";
import { donorKey, routes } from "@/lib/format";

/** Which chain nodes have a page of their own in this race. */
export type NodeLinks = {
  raceId: string;
  /** committees with entities/<id>.json */
  entityIds: ReadonlySet<string>;
  /** individuals/organizations with donors/<key>.json */
  donorKeys: ReadonlySet<string>;
};

/**
 * Internal page for the node when one exists, otherwise null. Spending-side nodes carry their own `href` from the
 * pipeline (vendor page, ad page, dossier); funding-side nodes resolve to the entity page or donor forward view.
 */
export function pageHref(
  n: Pick<ChainNode, "id" | "kind" | "href">,
  links: NodeLinks,
): string | null {
  if (n.href) return n.href;
  if (links.entityIds.has(n.id)) return routes.entity(links.raceId, n.id);
  if (n.kind === "individual" || n.kind === "organization") {
    const key = donorKey(n.id);
    if (links.donorKeys.has(key)) return routes.donor(links.raceId, key);
  }
  return null;
}
