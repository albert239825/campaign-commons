import Link from "next/link";
import type { DonorEdge, DonorNode, DonorView } from "@citizen-gotham/contracts";
import { money, routes } from "@/lib/format";
import { Chip, SourceLink } from "@/components/ui";

const KIND_LABEL: Record<DonorNode["kind"], string> = {
  individual: "individual",
  organization: "organization",
  committee: "FEC committee",
  candidate: "candidate",
};

/**
 * Server-rendered forward tree: donor → committees → outside spenders → independent expenditures.
 * Money edges are solid rows with a dollar amount; targeting edges are dashed rows and never carry money to the candidate.
 * A node reached by several parents is expanded once; later mentions point back up.
 */
export function DonorTree({ view, raceId }: { view: DonorView; raceId: string }) {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const out = new Map<string, DonorEdge[]>();
  for (const e of view.edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const expanded = new Set<string>();
  const root = byId.get(view.donor_id);
  if (!root) return null;

  function Node({ n, via }: { n: DonorNode; via: DonorEdge | null }) {
    const first = !expanded.has(n.id);
    expanded.add(n.id);
    const children = first ? (out.get(n.id) ?? []).slice().sort((a, b) => b.amount - a.amount) : [];
    const targeting = via?.kind === "targeting";
    return (
      <li className={targeting ? "border-l-2 border-dashed border-amber-400 pl-3" : "border-l-2 border-neutral-300 pl-3"}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1 text-sm">
          {via && (
            <span className={`tabular-nums ${targeting ? "text-amber-800" : "text-neutral-900"}`}>
              {targeting ? `${via.support_oppose === "O" ? "opposed" : "supported"} with ${money(via.amount, { compact: false })} in IEs` : money(via.amount, { compact: false })}
              {targeting ? " ⇢" : " →"}
            </span>
          )}
          <NodeName n={n} raceId={raceId} />
          <span className="text-xs text-neutral-500">{KIND_LABEL[n.kind]}</span>
          {n.is_spender && <Chip tone="neutral">outside spender in this race</Chip>}
          {targeting && <Chip tone="amber">targeting edge — no money to the candidate</Chip>}
          {via && <SourceLink href={via.source_url} label="FEC record" />}
          {!first && <span className="text-xs italic text-neutral-500">(expanded above)</span>}
        </div>
        {children.length > 0 && (
          <ul className="ml-2 space-y-0.5">
            {children.map((e) => {
              const child = byId.get(e.to);
              return child ? <Node key={`${e.from}>${e.to}>${e.kind}>${e.support_oppose ?? ""}`} n={child} via={e} /> : null;
            })}
          </ul>
        )}
      </li>
    );
  }

  return (
    <ul className="space-y-0.5">
      <Node n={root} via={null} />
    </ul>
  );
}

function NodeName({ n, raceId }: { n: DonorNode; raceId: string }) {
  const cls = "font-medium hover:underline";
  if (n.kind === "committee" && n.has_chain) {
    return (
      <Link href={routes.chain(raceId, n.id)} className={cls}>
        {n.name}
      </Link>
    );
  }
  if (n.kind === "candidate") {
    return (
      <Link href={routes.candidate(raceId, n.id)} className={cls}>
        {n.name}
      </Link>
    );
  }
  return (
    <a href={n.source_url} target="_blank" rel="noreferrer" className={cls}>
      {n.name}
    </a>
  );
}
