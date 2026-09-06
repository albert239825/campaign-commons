"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { pieSectors, pieSlices, type FundingView, type SliceGroup } from "@/lib/funding-view";
import { money, pct, routes } from "@/lib/format";
import { Money, SourceLink } from "@/components/ui";

type Slice = SliceGroup;
type VisibilityKey = keyof FundingView["visibility"];
type VisibilityRow = { key: VisibilityKey; label: string; color: string; detail: string };
const DISCLOSED_ROWS: { total: VisibilityRow[]; split: VisibilityRow[] } = {
  total: [{ key: "disclosed", label: "Disclosed", color: "#4c645c", detail: "Resolves to a named individual, business, or union in filings." }],
  split: [
    { key: "disclosed_individuals", label: "Disclosed · individuals", color: "#4c645c", detail: "Resolves to a named person in filings." },
    { key: "disclosed_organizations", label: "Disclosed · organizations", color: "#8aa89c", detail: "Stops at a named business or union giving from its own treasury; its own funders are not walked." },
  ],
};
const OTHER_ROWS: VisibilityRow[] = [
  { key: "inferable", label: "Inferable", color: "#a68a5e", detail: "Potentially reconstructable from other public records." },
  { key: "unwalked", label: "Not walked", color: "#92908a", detail: "The source chain was not followed further; neither disclosed nor dark." },
  { key: "dark", label: "Undisclosed (dark)", color: "#67534e", detail: "Stops at an organization whose own funding is not on file." },
  { key: "unavailable", label: "Breakdown unavailable", color: "#d4d0c9", detail: "No source breakdown is available in this view." },
];

function sector(start: number, end: number) {
  const point = (angle: number) => [160 + 144 * Math.cos(angle), 160 + 144 * Math.sin(angle)];
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  return `M160,160 L${x1},${y1} A144,144 0 ${end - start > Math.PI ? 1 : 0},1 ${x2},${y2} Z`;
}

export function FundingExplorer({ views, raceId }: { views: FundingView[]; raceId: string }) {
  const [index, setIndex] = useState(0);
  const [slice, setSlice] = useState<Slice>("outside");
  const [detailed, setDetailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const view = views[index];
  const total = view.campaign.receipts + view.outside.total;
  const VISIBILITY = [...(view.hasSplit ? DISCLOSED_ROWS.split : DISCLOSED_ROWS.total), ...OTHER_ROWS];
  const slices = pieSectors(pieSlices(view, detailed, views.filter(v => v.id !== "all")));
  const sides = [...new Set(slices.map(s => s.side).filter((s): s is string => !!s))];
  const bySide = sides.map(side => {
    const own = slices.filter(s => s.side === side);
    return { side, slices: own, total: own.reduce((sum, s) => sum + s.amount, 0) };
  });
  const pick = (s: { id: string; group: Slice; viewId?: string; pickId?: string }) => {
    setSlice(s.group);
    if (s.viewId) {
      const target = views.findIndex(v => v.id === s.viewId);
      if (target >= 0) setIndex(target);
      setPicked(s.pickId ?? null);
      return;
    }
    setPicked(detailed ? s.id : null);
  };
  const isPicked = (s: { id: string; group: Slice }) => (detailed ? picked === s.id : slice === s.group);
  const toggleDetail = () => { setDetailed(!detailed); setPicked(null); };
  const selectTab = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = i;
    if (event.key === "ArrowRight") next = (i + 1) % views.length;
    else if (event.key === "ArrowLeft") next = (i - 1 + views.length) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else return;
    event.preventDefault(); setIndex(next);
    document.getElementById(`funding-tab-${next}`)?.focus();
  };

  return (
    <section className="funding-explorer" aria-label="Campaign receipts and outside spending by candidate">
      <div className="funding-tabs" role="tablist" aria-label="Candidate funding views">
        {views.map((item, i) => (
          <button key={item.id} type="button" role="tab" id={`funding-tab-${i}`} aria-selected={i === index}
            aria-controls="funding-panel" tabIndex={i === index ? 0 : -1} onClick={() => setIndex(i)} onKeyDown={e => selectTab(e, i)}>
            <span>{item.label}</span>
            {item.id !== "all" && <small>{item.names}</small>}
          </button>
        ))}
      </div>
      <div id="funding-panel" className="funding-panel" role="tabpanel" aria-labelledby={`funding-tab-${index}`}>
        <div className="funding-chart-column">
          <svg className="funding-pie" viewBox="0 0 320 320" role="group" aria-label={`Campaign receipts and outside spending for ${view.names || "this race"}`}>
            {total <= 0 && <circle cx="160" cy="160" r="144" fill="#d4d0c9"><title>No funding data available</title></circle>}
            {slices.filter(s => s.amount > 0).map(s => {
              const props = {
                fill: s.color, stroke: "#f2efeb", strokeWidth: 3,
                role: "button", tabIndex: 0, "aria-pressed": isPicked(s),
                "aria-label": `${s.label}: ${money(s.amount)}, ${pct(s.share)}. Show details`,
                onClick: () => pick(s),
                onKeyDown: (e: KeyboardEvent<SVGElement>) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(s); } },
              };
              return s.end - s.start >= Math.PI * 2 - 1e-9
                ? <circle key={s.id} {...props} cx="160" cy="160" r="144"><title>{`${s.label}: ${money(s.amount)}`}</title></circle>
                : <path key={s.id} {...props} d={sector(s.start, s.end)}><title>{`${s.label}: ${money(s.amount)}`}</title></path>;
            })}
          </svg>
          <div className="funding-chart-total"><Money amount={total} /><span>Campaign receipts + outside spending</span></div>
          <div className="funding-detail-toggle">
            <button type="button" aria-pressed={detailed} onClick={toggleDetail}>
              {detailed ? "Show summary" : "Show detail"}
            </button>
            <span>{!detailed ? "Campaign receipts vs outside spending" : bySide.length > 1 ? "Money working for each side" : "Receipts by source · outside spending by stance"}</span>
          </div>
          <div className="funding-slice-controls" aria-label="Choose a funding breakdown">
            {(bySide.length > 1 ? bySide : [{ side: null, slices, total }]).map(b => (
              <div key={b.side ?? "all"} className="funding-side">
                {b.side && (
                  <div className="funding-side-heading">
                    <span>Working for {b.side}</span><strong><Money amount={b.total} /></strong><span>{total > 0 ? pct(b.total / total) : "—"}</span>
                  </div>
                )}
                {b.slices.map(s => (
                  <button key={s.id} type="button" aria-pressed={isPicked(s)} onClick={() => pick(s)}>
                    <span className="funding-swatch" style={{ background: s.color }} />
                    <span>{s.label}</span><strong><Money amount={s.amount} /></strong><span>{total > 0 ? pct(s.share) : "—"}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <p className="funding-caption">
            Select a slice to explore it. Outside spending supports or opposes candidates; it does not go to their campaigns. The combined amount is not a campaign fundraising total.
            {detailed && bySide.length > 1 && " Each side groups money working for one candidate: each side has its own hue; the darkest shade is the campaign's receipts, lighter shades are outside spending supporting them and opposing their opponent. Only the receipts reach the campaign; a side total is a comparison figure, not a fundraising total. Selecting a slice opens the candidate record it comes from."}
            {detailed && bySide.length <= 1 && " Darker slices are money to the campaign, by source; lighter slices are independent expenditures, by stance. Conduit receipts are already inside the individuals slice."}
          </p>
        </div>
        <div className="funding-detail" aria-live="polite" aria-atomic="false">
          <div className="funding-detail-heading">
            <h3>{slice === "campaign" ? "Campaign receipts" : "Outside spending"}</h3>
            <div className="funding-detail-amount"><Money amount={slice === "campaign" ? view.campaign.receipts : view.outside.total} compact={false} /></div>
          </div>
          {slice === "campaign" ? (
            <>
              <dl className="funding-lines">
                <AmountLine label="From individuals" amount={view.campaign.individuals} selected={picked === "individuals"} />
                <AmountLine label="Of which via conduits" amount={view.campaign.conduits} nested />
                <AmountLine label="From committees (PACs, party)" amount={view.campaign.committees} selected={picked === "committees"} />
                <AmountLine label="Other receipts" amount={view.campaign.other} selected={picked === "other"} />
                <AmountLine label="Disbursements" amount={view.campaign.disbursements} />
                <AmountLine label="Cash on hand" amount={view.campaign.cash} />
              </dl>
              <p className="funding-caption">Individual receipts include unitemized contributions. Conduit receipts are already included in the individual total. Disbursements and cash on hand are shown for context and are not added to the pie.</p>
            </>
          ) : (
            <>
              <dl className="funding-lines funding-support">
                <AmountLine label="Supporting candidates" amount={view.outside.support} selected={picked === "support"} />
                <AmountLine label="Opposing candidates" amount={view.outside.oppose} selected={picked === "oppose"} />
              </dl>
              <h4>Where outside funding can be traced</h4>
              <p className="funding-caption">Preliminary source composition · percentages of outside spending</p>
              <div className="funding-visibility-bar" role="img" aria-label={VISIBILITY.map(v => `${v.label}: ${money(view.visibility[v.key])}`).join(", ")}>
                {VISIBILITY.map(v => <span key={v.key} style={{ flex: view.visibility[v.key], background: v.color }} />)}
              </div>
              <dl className="funding-visibility-lines">
                {VISIBILITY.filter(v => v.key !== "unavailable" || view.visibility.unavailable > .01).map(v => (
                  <div key={v.key}>
                    <dt><span className="funding-swatch" style={{ background: v.color }} />{v.label}<small>{v.detail}</small></dt>
                    <dd><Money amount={view.visibility[v.key]} /><span>{view.outside.total > 0 ? pct(view.visibility[v.key] / view.outside.total) : "—"}</span></dd>
                  </div>
                ))}
              </dl>
              <details className="funding-method">
                <summary>How this breakdown is calculated</summary>
                <p>{view.method ?? "Each spender's spending about the selected candidate is weighted by the source shares of that spender's receipts. This estimates funding composition; it does not match individual donations to specific expenditures. Missing chains or spending outside the loaded records are labeled breakdown unavailable."}</p>
                {!view.publishedVisibility && <p>Candidate views use rounded source shares from the loaded spender records. The all-candidates view uses the published race totals, including classifications that may be unavailable in candidate views. Small differences are expected.</p>}
                <Link href={routes.methodology()}>Read the methodology →</Link>
              </details>
            </>
          )}
          <div className="funding-sources">
            <h4>Source records</h4>
            {view.sources.map(source => (
              <div key={source.id}>
                <Link href={routes.candidate(raceId, source.id)}>{source.name}</Link>
                <SourceLink href={slice === "campaign" ? source.campaign : source.outside} label="FEC" />
              </div>
            ))}
            {view.sources.length === 0 && <p>No candidate records loaded yet.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function AmountLine({ label, amount, nested = false, selected = false }: { label: string; amount: number | null; nested?: boolean; selected?: boolean }) {
  return <div className={[nested && "funding-line-nested", selected && "funding-line-selected"].filter(Boolean).join(" ")} aria-current={selected || undefined}><dt>{label}</dt><dd>{amount === null ? "Not available" : <Money amount={amount} compact={false} />}</dd></div>;
}
