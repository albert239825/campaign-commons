"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { FUNDING_MODES, pieSlices, pieTotal, splitFundingViews, type FundingMode, type FundingView, type PieSlice } from "@/lib/funding-view";
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
const DEFAULT_SLICE: Record<FundingMode, string> = { outside: "oppose", campaign: "individuals" };

function sector(start: number, end: number) {
  const point = (angle: number) => [160 + 144 * Math.cos(angle), 160 + 144 * Math.sin(angle)];
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  return `M160,160 L${x1},${y1} A144,144 0 ${end - start > Math.PI ? 1 : 0},1 ${x2},${y2} Z`;
}

type Focus = { candidate: number; slice: string };

export function FundingExplorer({ views, raceId }: { views: FundingView[]; raceId: string }) {
  const { race, candidates } = splitFundingViews(views);
  const [mode, setMode] = useState<FundingMode>("outside");
  const [focus, setFocus] = useState<Focus>({ candidate: 0, slice: DEFAULT_SLICE.outside });
  const modeIndex = FUNDING_MODES.findIndex(m => m.id === mode);
  const raceTotal = race ? pieTotal(race, mode) : candidates.reduce((sum, v) => sum + pieTotal(v, mode), 0);
  const view = candidates[Math.min(focus.candidate, candidates.length - 1)];

  const selectMode = (next: FundingMode) => {
    setMode(next);
    setFocus(f => ({ candidate: f.candidate, slice: DEFAULT_SLICE[next] }));
  };
  const selectTab = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = i;
    if (event.key === "ArrowRight") next = (i + 1) % FUNDING_MODES.length;
    else if (event.key === "ArrowLeft") next = (i - 1 + FUNDING_MODES.length) % FUNDING_MODES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = FUNDING_MODES.length - 1;
    else return;
    event.preventDefault(); selectMode(FUNDING_MODES[next].id);
    document.getElementById(`funding-tab-${next}`)?.focus();
  };

  if (!view) {
    return <section className="funding-explorer" aria-label="Outside spending and campaign receipts by candidate"><p className="funding-caption">No candidate records loaded yet.</p></section>;
  }

  return (
    <section className="funding-explorer" aria-label="Outside spending and campaign receipts by candidate">
      <div className="funding-tabs" role="tablist" aria-label="Funding views">
        {FUNDING_MODES.map((item, i) => (
          <button key={item.id} type="button" role="tab" id={`funding-tab-${i}`} aria-selected={i === modeIndex}
            aria-controls="funding-panel" tabIndex={i === modeIndex ? 0 : -1} onClick={() => selectMode(item.id)} onKeyDown={e => selectTab(e, i)}>
            <span>{item.label}</span>
            <small>{item.detail}</small>
          </button>
        ))}
      </div>
      <div id="funding-panel" className="funding-panel" role="tabpanel" aria-labelledby={`funding-tab-${modeIndex}`}>
        <div className="funding-chart-column">
          <div className="funding-pies" role="group" aria-label={`${FUNDING_MODES[modeIndex].label} by candidate`}>
            {candidates.map((candidate, i) => (
              <CandidatePie key={candidate.id} view={candidate} mode={mode} raceTotal={raceTotal} focus={focus.candidate === i ? focus.slice : null}
                onSelect={slice => setFocus({ candidate: i, slice })} />
            ))}
          </div>
          {mode === "outside" ? (
            <p className="funding-caption">
              Outside spending supports or opposes candidates; it does not go to their campaigns. Across the race: <Money amount={raceTotal} /> of
              outside spending{race && <> — <Money amount={race.outside.support} /> supporting and <Money amount={race.outside.oppose} /> opposing</>}.
              Pies share one scale: every percentage is a share of that race total, so the four slices add up to 100%. Select a slice to explore it.
            </p>
          ) : (
            <p className="funding-caption">
              Campaign receipts are what each candidate&apos;s authorized committees took in; they are never added to outside spending.
              Across the race: <Money amount={raceTotal} /> in receipts. Conduit receipts (ActBlue, WinRed) are already inside the individual
              total. Every percentage is a share of that race total. Select a slice to explore it.
            </p>
          )}
        </div>
        <div className="funding-detail" aria-live="polite" aria-atomic="false">
          <div className="funding-detail-heading">
            <h3>{FUNDING_MODES[modeIndex].label}<span className="funding-detail-candidate">{view.names}</span></h3>
            <div className="funding-detail-amount"><Money amount={pieTotal(view, mode)} compact={false} /></div>
          </div>
          {mode === "campaign" ? (
            <>
              <dl className="funding-lines">
                {pieSlices(view, "campaign").flatMap(s => [
                  <AmountLine key={s.id} label={s.label} amount={s.amount} color={s.color} selected={focus.slice === s.id} />,
                  ...(s.id === "individuals" ? [<AmountLine key="conduits" label="Of which via conduits" amount={view.campaign.conduits} nested />] : []),
                ])}
                <AmountLine label="Disbursements" amount={view.campaign.disbursements} />
                <AmountLine label="Cash on hand" amount={view.campaign.cash} />
              </dl>
              <p className="funding-caption">Individual receipts include unitemized contributions. Conduit receipts are already included in the individual total. Disbursements and cash on hand are shown for context and are not part of the pie.</p>
            </>
          ) : (
            <>
              <dl className="funding-lines funding-support">
                {pieSlices(view, "outside").map(s => <AmountLine key={s.id} label={s.label} amount={s.amount} color={s.color} selected={focus.slice === s.id} />)}
              </dl>
              <h4>Where outside funding can be traced</h4>
              <p className="funding-caption">Preliminary source composition · percentages of outside spending about {view.names}</p>
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
                <p>Each spender&apos;s spending about {view.names} is weighted by the source shares of that spender&apos;s receipts. This estimates funding composition; it does not match individual donations to specific expenditures. Missing chains or spending outside the loaded records are labeled breakdown unavailable.</p>
                <p>Candidate views use rounded source shares from the loaded spender records. Small differences from the published race totals are expected.</p>
                {race?.publishedVisibility && (
                  <p>
                    Published race total, both candidates: <Money amount={race.visibility.disclosed} /> disclosed ({pct(race.visibility.disclosed / race.outside.total)}), <Money amount={race.visibility.dark} /> dark ({pct(race.visibility.dark / race.outside.total)}), <Money amount={race.visibility.unwalked} /> not walked. {race.method}
                  </p>
                )}
                <Link href={routes.methodology()}>Read the methodology →</Link>
              </details>
            </>
          )}
          <div className="funding-sources">
            <h4>Source records</h4>
            {view.sources.map(source => (
              <div key={source.id}>
                <Link href={routes.candidate(raceId, source.id)}>{source.name}</Link>
                <SourceLink href={mode === "campaign" ? source.campaign : source.outside} label="FEC" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CandidatePie({ view, mode, raceTotal, focus, onSelect }: {
  view: FundingView; mode: FundingMode; raceTotal: number; focus: string | null; onSelect: (slice: string) => void;
}) {
  const total = pieTotal(view, mode);
  const { label: modeLabel, noun, about } = FUNDING_MODES.find(m => m.id === mode)!;
  const name = view.names || "this candidate";
  let angle = -Math.PI / 2;
  const slices = pieSlices(view, mode).map(s => {
    const start = angle;
    angle += total > 0 ? (s.amount / total) * Math.PI * 2 : 0;
    return { ...s, start, end: angle };
  });
  const describe = (s: PieSlice) =>
    `${s.label}: ${money(s.amount)}, ${total > 0 ? pct(s.amount / total) : "—"} of ${noun} ${about} ${name}, ${raceTotal > 0 ? pct(s.amount / raceTotal) : "—"} of the race's ${noun}`;

  return (
    <article className={`funding-pie-card${focus !== null ? " funding-pie-card-focused" : ""}`}>
      <header className="funding-pie-heading">
        <strong>{view.names}</strong>
        <small>{view.party && <PartyTag party={view.party} />}{view.label}</small>
      </header>
      <svg className="funding-pie" viewBox="0 0 320 320" role="group" aria-label={`${modeLabel} ${about} ${name}: ${money(total)}`}>
        {total <= 0 && <circle cx="160" cy="160" r="144" fill="#d4d0c9"><title>{`No ${noun} on file`}</title></circle>}
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
        <span>{raceTotal > 0 ? `${pct(total / raceTotal)} of the race's ${noun}` : `No ${noun} on file`}</span>
      </div>
      <div className="funding-slice-controls" aria-label={`${modeLabel} ${about} ${name}, by slice`}>
        {slices.map(s => (
          <button key={s.id} type="button" aria-pressed={focus === s.id} aria-label={`${describe(s)}. Show details`} onClick={() => onSelect(s.id)}>
            <span className="funding-swatch" style={{ background: s.color }} />
            <span>{s.short}</span><strong><Money amount={s.amount} /></strong><span>{raceTotal > 0 ? pct(s.amount / raceTotal) : "—"}</span>
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
