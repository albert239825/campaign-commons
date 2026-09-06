"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { aggregateOutside, buildSides, type FundingView, type Side, type SideSlice, type SideSliceId } from "@/lib/funding-view";
import { money, pct, routes } from "@/lib/format";
import { Money, SourceLink } from "@/components/ui";
import { PartyTag } from "@/components/ui/party-tag";

const VISIBILITY = [
  { key: "disclosed", label: "Disclosed", color: "#4c645c", detail: "Resolves to a named individual, business, or union in filings." },
  { key: "inferable", label: "Inferable", color: "#a68a5e", detail: "Potentially reconstructable from other public records." },
  { key: "unwalked", label: "Not walked", color: "#92908a", detail: "The source chain was not followed further; neither disclosed nor dark." },
  { key: "dark", label: "Undisclosed (dark)", color: "#67534e", detail: "Stops at an organization whose own funding is not on file." },
  { key: "unavailable", label: "Breakdown unavailable", color: "#d4d0c9", detail: "No source breakdown is available in this view." },
] as const;

function sector(start: number, end: number) {
  const point = (angle: number) => [160 + 144 * Math.cos(angle), 160 + 144 * Math.sin(angle)];
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  return `M160,160 L${x1},${y1} A144,144 0 ${end - start > Math.PI ? 1 : 0},1 ${x2},${y2} Z`;
}

type Focus = { candidate: number; slice: SideSliceId };

export function FundingExplorer({ views, raceId }: { views: FundingView[]; raceId: string }) {
  const { race, sides } = buildSides(views);
  const [focus, setFocus] = useState<Focus>({ candidate: 0, slice: "campaign" });
  const side = sides[Math.min(focus.candidate, sides.length - 1)];

  if (!side) {
    return <section className="funding-explorer" aria-label="Money working for each candidate"><p className="funding-caption">No candidate records loaded yet.</p></section>;
  }
  const { view } = side;
  const slice = side.slices.find(s => s.id === focus.slice) ?? side.slices[0];
  const outsideSubject = slice.id === "oppose" ? side.rivals : aggregateOutside([view]);

  return (
    <section className="funding-explorer" aria-label="Money working for each candidate">
      <div className="funding-panel">
        <div className="funding-chart-column">
          <div className="funding-pies" role="group" aria-label="Money working for each candidate">
            {sides.map((s, i) => (
              <SidePie key={s.view.id} side={s} focus={focus.candidate === i ? focus.slice : null} onSelect={id => setFocus({ candidate: i, slice: id })} />
            ))}
          </div>
          <p className="funding-caption">
            Money working for a candidate = the campaign&apos;s own receipts, plus outside spending supporting them, plus outside spending opposing
            their opponent. Only the receipts reach the campaign: outside spending is targeting — it supports or opposes candidates and does not go
            to their campaigns — so the side total is a comparison figure, not a fundraising total. Pies share one radius; each percentage is a share
            of that side&apos;s total.{" "}
            {race && <>Across the race: <Money amount={race.campaign.receipts} /> in campaign receipts and <Money amount={race.outside.total} /> of outside spending. </>}
            Select a slice to explore it.
          </p>
        </div>
        <div className="funding-detail" aria-live="polite" aria-atomic="false">
          <div className="funding-detail-heading">
            <h3>Money working for<span className="funding-detail-candidate">{view.names}</span></h3>
            <div className="funding-detail-amount"><Money amount={side.total} compact={false} /></div>
            <p className="funding-caption">Side total, not a fundraising total.</p>
          </div>
          <dl className="funding-lines">
            {side.slices.map(s => <AmountLine key={s.id} label={s.label} amount={s.amount} color={s.color} selected={slice.id === s.id} />)}
          </dl>
          {slice.id === "campaign" ? (
            <>
              <h4>Receipts breakdown</h4>
              <dl className="funding-lines">
                <AmountLine label="From individuals" amount={view.campaign.individuals} />
                <AmountLine label="Of which via conduits" amount={view.campaign.conduits} nested />
                <AmountLine label="From committees (PACs, party)" amount={view.campaign.committees} />
                <AmountLine label="Other receipts" amount={view.campaign.other} />
                <AmountLine label="Disbursements" amount={view.campaign.disbursements} />
                <AmountLine label="Cash on hand" amount={view.campaign.cash} />
              </dl>
              <p className="funding-caption">Individual receipts include unitemized contributions; conduit receipts (ActBlue, WinRed) are already inside the individual total. Disbursements and cash on hand are context, not part of the pie.</p>
            </>
          ) : (
            <>
              <h4>Outside spending about {outsideSubject.names}</h4>
              <dl className="funding-lines">
                {slice.id === "support" ? (
                  <>
                    <AmountLine label={`Supporting ${outsideSubject.names}`} amount={outsideSubject.outside.support} color={slice.color} selected />
                    <AmountLine label={`Opposing ${outsideSubject.names} — counted on the other side`} amount={outsideSubject.outside.oppose} nested />
                  </>
                ) : (
                  <>
                    <AmountLine label={`Opposing ${outsideSubject.names}`} amount={outsideSubject.outside.oppose} color={slice.color} selected />
                    <AmountLine label={`Supporting ${outsideSubject.names} — counted on the other side`} amount={outsideSubject.outside.support} nested />
                  </>
                )}
              </dl>
              <h4>Where outside funding can be traced</h4>
              <p className="funding-caption">Preliminary source composition · percentages of all outside spending about {outsideSubject.names}, supporting and opposing</p>
              <div className="funding-visibility-bar" role="img" aria-label={VISIBILITY.map(v => `${v.label}: ${money(outsideSubject.visibility[v.key])}`).join(", ")}>
                {VISIBILITY.map(v => <span key={v.key} style={{ flex: outsideSubject.visibility[v.key], background: v.color }} />)}
              </div>
              <dl className="funding-visibility-lines">
                {VISIBILITY.filter(v => v.key !== "unavailable" || outsideSubject.visibility.unavailable > .01).map(v => (
                  <div key={v.key}>
                    <dt><span className="funding-swatch" style={{ background: v.color }} />{v.label}<small>{v.detail}</small></dt>
                    <dd><Money amount={outsideSubject.visibility[v.key]} /><span>{outsideSubject.outside.total > 0 ? pct(outsideSubject.visibility[v.key] / outsideSubject.outside.total) : "—"}</span></dd>
                  </div>
                ))}
              </dl>
              <details className="funding-method">
                <summary>How this breakdown is calculated</summary>
                <p>Each spender&apos;s spending about {outsideSubject.names} is weighted by the source shares of that spender&apos;s receipts. This estimates funding composition; it does not match individual donations to specific expenditures. Missing chains or spending outside the loaded records are labeled breakdown unavailable.</p>
                <p>Candidate views use rounded source shares from the loaded spender records. Small differences from the published race totals are expected.</p>
                {race?.publishedVisibility && (
                  <p>
                    Published race total, all candidates: <Money amount={race.visibility.disclosed} /> disclosed ({pct(race.visibility.disclosed / race.outside.total)}), <Money amount={race.visibility.dark} /> dark ({pct(race.visibility.dark / race.outside.total)}), <Money amount={race.visibility.unwalked} /> not walked. {race.method}
                  </p>
                )}
                <Link href={routes.methodology()}>Read the methodology →</Link>
              </details>
            </>
          )}
          <div className="funding-sources">
            <h4>Source records</h4>
            {view.sources.map(source => (
              <div key={`${source.id}-campaign`}>
                <span><Link href={routes.candidate(raceId, source.id)}>{source.name}</Link> · campaign receipts</span>
                <SourceLink href={source.campaign} label="FEC" />
              </div>
            ))}
            {[view, ...side.opponents].flatMap(v => v.sources).map(source => (
              <div key={`${source.id}-outside`}>
                <span><Link href={routes.candidate(raceId, source.id)}>{source.name}</Link> · outside spending</span>
                <SourceLink href={source.outside} label="FEC" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SidePie({ side, focus, onSelect }: { side: Side; focus: SideSliceId | null; onSelect: (slice: SideSliceId) => void }) {
  const { view, total } = side;
  const name = view.names || "this candidate";
  let angle = -Math.PI / 2;
  const slices = side.slices.map(s => {
    const start = angle;
    angle += total > 0 ? (s.amount / total) * Math.PI * 2 : 0;
    return { ...s, start, end: angle };
  });
  const describe = (s: SideSlice) => `${s.label}: ${money(s.amount)}, ${total > 0 ? pct(s.amount / total) : "—"} of the money working for ${name}`;

  return (
    <article className={`funding-pie-card${focus !== null ? " funding-pie-card-focused" : ""}`}>
      <header className="funding-pie-heading">
        <strong>Money working for {view.names}</strong>
        <small>{view.party && <PartyTag party={view.party} />}{view.label}</small>
      </header>
      <svg className="funding-pie" viewBox="0 0 320 320" role="group" aria-label={`Money working for ${name}: ${money(total)}, side total`}>
        {total <= 0 && <circle cx="160" cy="160" r="144" fill="#d4d0c9"><title>No money on file</title></circle>}
        {slices.filter(s => s.amount > 0).map(s => {
          const props = {
            fill: s.color, stroke: "#f2efeb", strokeWidth: 3,
            role: "button", tabIndex: 0, "aria-pressed": focus === s.id,
            "aria-label": `${describe(s)}. Show details`,
            onClick: () => onSelect(s.id),
            onKeyDown: (e: KeyboardEvent<SVGElement>) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(s.id); } },
          };
          return s.amount === total
            ? <circle key={s.id} {...props} cx="160" cy="160" r="144"><title>{`${s.label}: ${money(s.amount)}`}</title></circle>
            : <path key={s.id} {...props} d={sector(s.start, s.end)}><title>{`${s.label}: ${money(s.amount)}`}</title></path>;
        })}
      </svg>
      <div className="funding-chart-total">
        <Money amount={total} />
        <span>side total · not a fundraising total</span>
      </div>
      <div className="funding-slice-controls" aria-label={`Money working for ${name}, by slice`}>
        {slices.map(s => (
          <button key={s.id} type="button" aria-pressed={focus === s.id} aria-label={`${describe(s)}. Show details`} onClick={() => onSelect(s.id)}>
            <span className="funding-swatch" style={{ background: s.color }} />
            <span>{s.short}</span><strong><Money amount={s.amount} /></strong><span>{total > 0 ? pct(s.amount / total) : "—"}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

function AmountLine({ label, amount, nested = false, color, selected = false }: {
  label: string; amount: number | null; nested?: boolean; color?: string; selected?: boolean;
}) {
  return (
    <div className={`${nested ? "funding-line-nested" : ""}${selected ? " funding-line-selected" : ""}`.trim()} aria-current={selected || undefined}>
      <dt>{color && <span className="funding-swatch" style={{ background: color }} />}{label}</dt>
      <dd>{amount === null ? "Not available" : <Money amount={amount} compact={false} />}</dd>
    </div>
  );
}
