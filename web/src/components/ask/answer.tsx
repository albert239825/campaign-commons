import Link from "next/link";
import type {
  AdSponsorTrail,
  CandidateAdFundingAnswer,
  CandidateSpenderAnswer,
  CommitteeFundingAnswer,
  TrailAnswer,
  TrailShares,
} from "@citizen-gotham/contracts";
import { Card, Chip, Money, ShareBar, SourceLink, Stat, VisibilityBadge } from "@/components/ui";
import { date, pct, routes } from "@/lib/format";
import { Caveats, EdgeLegend, Fig, MoneyEdgeRow, RangeFig, TargetingRow } from "./figures";

type Pages = { entityIds: Set<string>; chainIds: Set<string> };

/** Records behind the numbers quoted in the headline sentence, so the sentence itself is sourced. */
export function headlineSources(a: TrailAnswer): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const add = (label: string, url: string | undefined) => {
    if (url && !out.some((o) => o.url === url)) out.push({ label, url });
  };
  switch (a.intent) {
    case "candidate_spender":
      add("totals", a.total.source_url);
      add(a.spenders[0]?.spender_name ?? "", a.spenders[0]?.source_url);
      break;
    case "candidate_ad_funding":
      for (const s of a.sponsors.slice(0, 2)) {
        add(`${s.sponsor_name} ads`, s.ads.source_url);
        add(`${s.sponsor_name} Sched. E`, s.targeting?.source_url);
        add(`${s.sponsor_name} receipts`, s.campaign_receipts?.receipts.source_url ?? s.funded_by[0]?.source_url ?? s.shares?.source_url);
      }
      break;
    case "committee_funding":
      add("receipts", a.total_in.source_url);
      add(a.funders[0]?.from_name ?? "", a.funders[0]?.source_url);
      add(a.next_hop[0] ? `${a.next_hop[0].to_name} receipts` : "", a.next_hop[0]?.source_url);
      add("chain", a.shares?.source_url);
      break;
  }
  return out;
}

export function TrailAnswerView({ answer, raceId, pages }: { answer: TrailAnswer; raceId: string; pages: Pages }) {
  switch (answer.intent) {
    case "candidate_spender":
      return <SpenderAnswer a={answer} raceId={raceId} pages={pages} />;
    case "candidate_ad_funding":
      return <AdFundingAnswer a={answer} raceId={raceId} pages={pages} />;
    case "committee_funding":
      return <FundingAnswer a={answer} raceId={raceId} pages={pages} />;
  }
}

export function Headline({ answer }: { answer: TrailAnswer }) {
  const sources = headlineSources(answer);
  return (
    <div className="space-y-2">
      <p className="max-w-3xl text-lg leading-snug text-neutral-900">{answer.headline}</p>
      {sources.length > 0 && (
        <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-neutral-500">
          <span>Records behind this sentence:</span>
          {sources.map((s) => (
            <SourceLink key={s.url} href={s.url} label={s.label} />
          ))}
        </p>
      )}
    </div>
  );
}

function SpenderAnswer({ a, raceId, pages }: { a: CandidateSpenderAnswer; raceId: string; pages: Pages }) {
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Spent supporting" value={<Fig figure={a.support} />} />
          <Stat label="Spent opposing" value={<Fig figure={a.oppose} />} />
          <Stat label="All independent expenditures" value={<Fig figure={a.total} />} sub="paid to the spenders' vendors, not to the candidate" />
        </div>
      </Card>

      <Card title={`Who declared spending about ${a.subject_name}`}>
        {a.spenders.length === 0 ? (
          <p className="text-sm text-neutral-500">No independent expenditures about this candidate are on file.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {a.spenders.map((e) => (
              <TargetingRow key={`${e.spender_id}-${e.support_oppose}`} edge={e} raceId={raceId} hasChain={e.has_chain && pages.chainIds.has(e.spender_id)} showCandidate={false} />
            ))}
          </ul>
        )}
        <div className="mt-3">
          <EdgeLegend money={false} />
        </div>
      </Card>

      <Caveats items={a.caveats} />
      <p className="text-xs text-neutral-500">
        Want the money side? Open a spender&apos;s <em>its funders</em> link, or ask &ldquo;Who funds {a.spenders[0]?.spender_name ?? "a committee"}?&rdquo;
      </p>
    </div>
  );
}

function SponsorBlock({ s, candidateName, raceId, pages }: { s: AdSponsorTrail; candidateName: string; raceId: string; pages: Pages }) {
  return (
    <Card
      title={
        <span className="flex flex-wrap items-baseline gap-x-2">
          {pages.entityIds.has(s.sponsor_id) ? (
            <Link href={routes.entity(raceId, s.sponsor_id)} className="hover:underline">
              {s.sponsor_name}
            </Link>
          ) : (
            s.sponsor_name
          )}
          <span className="text-xs font-normal text-neutral-500">{s.sponsor_type_label}</span>
          {s.is_candidate_committee && <Chip tone="neutral">{candidateName}&apos;s own campaign</Chip>}
        </span>
      }
      action={pages.chainIds.has(s.sponsor_id) ? <Link href={routes.chain(raceId, s.sponsor_id)} className="text-xs text-neutral-600 hover:underline">full chain →</Link> : undefined}
    >
      <div className="grid gap-5 md:grid-cols-3">
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Ads it ran</h3>
          <p className="text-sm">
            {s.ads.ad_count.toLocaleString("en-US")} {s.ads.ad_count === 1 ? "ad" : "ads"} in the {s.ads.platform === "google" ? "Google" : "Meta"} ad library
          </p>
          <p className="text-sm">
            <RangeFig figure={s.ads.spend} /> <span className="text-xs text-neutral-500">platform range</span>
          </p>
          <p className="text-xs text-neutral-500">
            {s.ads.first_shown || s.ads.last_shown ? `${date(s.ads.first_shown)} – ${date(s.ads.last_shown)}` : "dates not published"} · sponsor match{" "}
            {s.ads.match_confidence === "verified" ? "verified by hand" : "by advertiser name"} ·{" "}
            <Link href={routes.ads(raceId)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
              see the ads
            </Link>
          </p>
        </section>

        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">What it declared about {candidateName}</h3>
          {s.is_candidate_committee ? (
            <p className="text-sm text-neutral-600">This is the candidate&apos;s own committee; its ads are campaign spending, not independent expenditures.</p>
          ) : s.targeting ? (
            <ul>
              <TargetingRow edge={s.targeting} raceId={raceId} hasChain={false} showCandidate={false} />
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">No Schedule E about this candidate.</p>
          )}
        </section>

        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Money into {s.sponsor_name}</h3>
          {s.campaign_receipts && (
            <dl className="space-y-0.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">Total receipts</dt>
                <dd>
                  <Fig figure={s.campaign_receipts.receipts} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">from individuals</dt>
                <dd>
                  <Fig figure={s.campaign_receipts.from_individuals} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">from committees</dt>
                <dd>
                  <Fig figure={s.campaign_receipts.from_committees} />
                </dd>
              </div>
            </dl>
          )}
          {s.funded_by.length > 0 ? (
            <ul className="divide-y divide-neutral-100">
              {s.funded_by.map((e) => (
                <MoneyEdgeRow key={e.from_id} edge={e} raceId={raceId} hasPage={pages.entityIds.has(e.from_id)} />
              ))}
            </ul>
          ) : (
            !s.campaign_receipts && <p className="text-sm text-neutral-500">No itemized receipts on file.</p>
          )}
          {s.shares && <SharesLine shares={s.shares} />}
          <p className="text-xs text-neutral-500">Pooled: these gifts went into the sponsor&apos;s account as a whole. None of them paid for any particular ad.</p>
        </section>
      </div>
    </Card>
  );
}

function AdFundingAnswer({ a, raceId, pages }: { a: CandidateAdFundingAnswer; raceId: string; pages: Pages }) {
  return (
    <div className="space-y-6">
      {a.sponsors.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">No ads in the library are tied to a committee that filed about this candidate.</p>
        </Card>
      ) : (
        a.sponsors.map((s) => <SponsorBlock key={s.sponsor_id} s={s} candidateName={a.subject_name} raceId={raceId} pages={pages} />)
      )}
      {a.spenders_without_ads > 0 && (
        <p className="text-xs text-neutral-500">
          {a.spenders_without_ads} more {a.spenders_without_ads === 1 ? "group" : "groups"} filed independent expenditures about {a.subject_name} but {a.spenders_without_ads === 1 ? "has" : "have"} no ads in the Google library (TV, mail, and other media are not in it). They are on{" "}
          <Link href={routes.answer(raceId, "candidate_spender", a.candidate_id)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            the spending answer
          </Link>
          .
        </p>
      )}
      <EdgeLegend ranges />
      <Caveats items={a.caveats} />
    </div>
  );
}

function SharesLine({ shares }: { shares: TrailShares }) {
  return (
    <div className="space-y-1">
      <ShareBar shares={shares} />
      <p className="text-xs text-neutral-500">
        Of <Money amount={shares.total_in} /> traced back up to {shares.max_depth} {shares.max_depth === 1 ? "hop" : "hops"}: {pct(shares.disclosed)} reaches named sources, {pct(shares.dark)} stops at groups that do not disclose donors
        {shares.unwalked > 0 ? `, ${pct(shares.unwalked)} was not walked` : ""}. <SourceLink href={shares.source_url} label="Sched. A" />
      </p>
    </div>
  );
}

function FundingAnswer({ a, raceId, pages }: { a: CommitteeFundingAnswer; raceId: string; pages: Pages }) {
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Itemized receipts" value={<Fig figure={a.total_in} />} sub={a.committee_type_label ?? undefined} />
          <Stat label="Direct funders shown" value={a.funders.length} sub="largest first" />
          <Stat label="Trail ends at" value={a.ultimate.length > 0 ? `${a.ultimate.length} named` : "—"} sub={a.shares ? `${pct(a.shares.disclosed)} of the money` : "no chain walked"} />
          <Stat label="Committee record" value={<SourceLink href={a.committee_source_url} label="fec.gov" className="text-sm" />} />
        </div>
        {a.shares && (
          <div className="mt-4">
            <SharesLine shares={a.shares} />
          </div>
        )}
      </Card>

      <Card title={`Who gave to ${a.subject_name}`}>
        {a.funders.length === 0 ? (
          <p className="text-sm text-neutral-500">No itemized receipts on file.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {a.funders.map((e) => (
              <MoneyEdgeRow key={e.from_id} edge={e} raceId={raceId} hasPage={pages.entityIds.has(e.from_id)} />
            ))}
          </ul>
        )}
      </Card>

      {a.next_hop.length > 0 && (
        <Card title="One hop further back: who funded those funders">
          <ul className="divide-y divide-neutral-100">
            {a.next_hop.map((e) => (
              <MoneyEdgeRow key={`${e.from_id}-${e.to_id}`} edge={e} raceId={raceId} hasPage={pages.entityIds.has(e.from_id)} />
            ))}
          </ul>
        </Card>
      )}

      {a.ultimate.length > 0 && (
        <Card title="Where the trail ends: named people and organizations" action={pages.chainIds.has(a.committee_id) ? <Link href={routes.chain(raceId, a.committee_id)} className="text-xs text-neutral-600 hover:underline">full chain →</Link> : undefined}>
          <ul className="divide-y divide-neutral-100">
            {a.ultimate.map((t) => (
              <li key={`${t.id}-${t.gave_to_id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-l-2 border-neutral-900 py-1.5 pl-3 text-sm">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-neutral-500">{t.organization_class ?? t.kind}</span>
                  <VisibilityBadge visibility={t.visibility} />
                  <Chip tone="muted">{t.depth === 1 ? "gave directly" : `${t.depth} hops back`}</Chip>
                </span>
                <span className="inline-flex items-baseline gap-1.5">
                  <span className="text-xs text-neutral-500">gave</span>
                  <Money amount={t.amount} />
                  <span className="text-xs text-neutral-500">to {t.gave_to_name}</span>
                  <SourceLink href={t.source_url} label="FEC" />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Separately: what ${a.subject_name} declared about candidates in this race`}>
        {a.spent_on.length === 0 ? (
          <p className="text-sm text-neutral-500">No independent expenditures in this race.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {a.spent_on.map((e) => (
              <TargetingRow key={`${e.candidate_id}-${e.support_oppose}`} edge={e} raceId={raceId} hasChain={false} />
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-neutral-500">Listed apart from the funders above on purpose: receipts are pooled, so no funder can be tied to any of these expenditures.</p>
      </Card>

      <EdgeLegend />
      <Caveats items={a.caveats} />
    </div>
  );
}
