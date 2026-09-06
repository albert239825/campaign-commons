// OWNER: Money Trails exploratory mode (D-80) — @graph flow diagrams.
import Link from "next/link";
import { VISIBILITY_COLORS, VISIBILITY_LABELS } from "@campaign-commons/contracts";
import { Chip } from "@/components/ui";
import { money } from "@/lib/format";
import type { SankeyData, SankeyLink, SankeyNode } from "@/lib/graph/sankey";

type Drawable = Extract<SankeyData, { ok: true }>;

const NODE_W = 180;
const COL_GAP = 120;
const NODE_GAP = 12;
const MIN_H = 22;
const PLOT_H = 360;
const PAD = 8;
const TARGETING_COLOR = "#7c3aed";
const OWNERSHIP_COLOR = "#171717";

type Placed = SankeyNode & { x: number; y: number; h: number; flow: number };
type Ribbon = { link: SankeyLink; from: Placed; to: Placed; w: number; y0: number; y1: number };

/**
 * Layered left-to-right Sankey of the cited rows (same hand-rolled approach as the chain page, D-24): column = layer
 * from `sankeyFromRows`, node height and ribbon width share one dollar scale, ribbons are cubic Béziers coloured by
 * visibility (targeting edges in purple since that money never reaches the candidate). Deterministic: no layout solver.
 */
export function layoutSankey(data: Drawable): { width: number; height: number; nodes: Placed[]; ribbons: Ribbon[] } {
  const flowOf = new Map<string, number>();
  for (const l of data.links) {
    flowOf.set(l.source, (flowOf.get(l.source) ?? 0) + l.amount);
  }
  const inflow = new Map<string, number>();
  for (const l of data.links) inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.amount);
  const flow = (id: string) => Math.max(flowOf.get(id) ?? 0, inflow.get(id) ?? 0);

  const byLayer: SankeyNode[][] = Array.from({ length: data.layers }, () => []);
  for (const n of data.nodes) byLayer[n.layer].push(n);
  for (const col of byLayer) col.sort((a, b) => flow(b.id) - flow(a.id) || a.name.localeCompare(b.name));

  const colTotal = (col: SankeyNode[]) => col.reduce((s, n) => s + flow(n.id), 0);
  const busiest = Math.max(...byLayer.map((col) => colTotal(col) || 1));
  const rows = Math.max(...byLayer.map((col) => col.length));
  const usable = Math.max(PLOT_H - PAD * 2 - NODE_GAP * (rows - 1), rows * MIN_H);
  const pxPerDollar = usable / busiest;

  const nodes: Placed[] = [];
  byLayer.forEach((col, i) => {
    const x = PAD + i * (NODE_W + COL_GAP);
    const heights = col.map((n) => Math.max(MIN_H, flow(n.id) * pxPerDollar));
    const total = heights.reduce((s, h) => s + h, 0) + NODE_GAP * (col.length - 1);
    let y = PAD + Math.max(0, (usable - total) / 2);
    col.forEach((n, j) => {
      nodes.push({ ...n, x, y, h: heights[j], flow: flow(n.id) });
      y += heights[j] + NODE_GAP;
    });
  });
  const placed = new Map(nodes.map((n) => [n.id, n]));

  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();
  const ribbons: Ribbon[] = [];
  for (const link of [...data.links].sort((a, b) => b.amount - a.amount)) {
    const from = placed.get(link.source);
    const to = placed.get(link.target);
    if (!from || !to) continue;
    const w = Math.max(1.5, link.amount * pxPerDollar);
    const o = outCursor.get(from.id) ?? 0;
    const t = inCursor.get(to.id) ?? 0;
    ribbons.push({ link, from, to, w, y0: from.y + o + w / 2, y1: to.y + t + w / 2 });
    outCursor.set(from.id, o + w);
    inCursor.set(to.id, t + w);
  }

  const width = PAD * 2 + data.layers * NODE_W + (data.layers - 1) * COL_GAP;
  const height = Math.max(...nodes.map((n) => n.y + n.h)) + PAD;
  return { width, height, nodes, ribbons };
}

const ribbonPath = (r: Ribbon) => {
  const x0 = r.from.x + NODE_W;
  const x1 = r.to.x;
  const c = (x0 + x1) / 2;
  return `M${x0},${r.y0} C${c},${r.y0} ${c},${r.y1} ${x1},${r.y1}`;
};

const ribbonColor = (l: SankeyLink) => (l.rel === "TARGETED" ? TARGETING_COLOR : l.rel === "CAMPAIGN_OF" ? OWNERSHIP_COLOR : VISIBILITY_COLORS[l.visibility]);

const ribbonTitle = (l: SankeyLink, from: SankeyNode, to: SankeyNode) => {
  if (l.rel === "CAMPAIGN_OF") return `[${l.n}] ${from.name} is the campaign committee of ${to.name} (${money(l.amount)} reached it in these rows)`;
  const verb = l.rel === "GAVE" ? "gave" : l.rel === "PAID" ? "paid" : l.rel === "TARGETED" ? (l.support_oppose === "O" ? "spent against" : "spent supporting") : l.rel.toLowerCase();
  return `[${l.n}] ${from.name} ${verb} ${money(l.amount)} → ${to.name} · ${VISIBILITY_LABELS[l.visibility]}`;
};

function truncate(s: string, max = 26) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function ExploreSankey({ data }: { data: Drawable }) {
  const { width, height, nodes, ribbons } = layoutSankey(data);
  const visibilities = [...new Set(data.links.filter((l) => l.rel === "GAVE" || l.rel === "PAID").map((l) => l.visibility))];
  const hasTargeting = data.links.some((l) => l.rel === "TARGETED");
  const hasOwnership = data.links.some((l) => l.rel === "CAMPAIGN_OF");
  return (
    <section className="explore-sankey space-y-2" aria-label="Flow diagram of the returned rows">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="amber">Flow diagram — drawn from the rows below only</Chip>
        <span className="text-xs text-neutral-500">
          {data.links.length} flows between {data.nodes.length} parties; ribbon width ∝ filed dollars; bracketed numbers are row citations.
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Money flows, left to right">
          {ribbons.map((r) => (
            <path key={`${r.link.n}-${r.link.source}-${r.link.target}`} d={ribbonPath(r)} fill="none" stroke={ribbonColor(r.link)} strokeWidth={r.w} strokeOpacity={0.45}>
              <title>{ribbonTitle(r.link, r.from, r.to)}</title>
            </path>
          ))}
          {nodes.map((n) => {
            const label = (
              <>
                <rect x={n.x} y={n.y} width={NODE_W} height={n.h} rx={2} fill="#fafafa" stroke="#d4d4d4" />
                <rect x={n.x} y={n.y} width={4} height={n.h} fill="#171717" />
                <text x={n.x + 10} y={n.y + Math.min(n.h / 2 + 4, 16)} fontSize={11} fontWeight={600} fill="#171717">
                  {truncate(n.name)}
                </text>
                {n.h >= 30 && (
                  <text x={n.x + 10} y={n.y + Math.min(n.h / 2 + 18, 30)} fontSize={10} fill="#737373">
                    {money(n.flow)} · {n.kind}
                  </text>
                )}
                <title>{`${n.name} (${n.kind}) — ${money(n.flow)}`}</title>
              </>
            );
            return n.href ? (
              <Link key={n.id} href={n.href}>
                <g className="cursor-pointer">{label}</g>
              </Link>
            ) : (
              <g key={n.id}>{label}</g>
            );
          })}
        </svg>
      </div>
      <ul className="flex flex-wrap gap-3 text-xs text-neutral-600">
        {visibilities.map((v) => (
          <li key={v} className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: VISIBILITY_COLORS[v] }} /> {VISIBILITY_LABELS[v]}
          </li>
        ))}
        {hasTargeting && (
          <li className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: TARGETING_COLOR }} /> Independent spending for/against (never reaches the candidate)
          </li>
        )}
        {hasOwnership && (
          <li className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: OWNERSHIP_COLOR }} /> Campaign committee → its candidate
          </li>
        )}
      </ul>
    </section>
  );
}
