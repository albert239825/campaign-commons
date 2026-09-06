import Link from "next/link";
import type { IssueFocus, OutsideSpender, RaceCandidate } from "@campaign-commons/contracts";
import { routes } from "@/lib/format";
import { Chip, Money, SourceLink } from "@/components/ui";
import { FOCUS_KIND_LABELS } from "@/components/issues/focus-kind";

export type IssueFunder = { spender: OutsideSpender; focus: IssueFocus };

type Targeting = { candidate: RaceCandidate; support: number; oppose: number; unlabelled: number };

/** Sum a spender's IE rows per candidate. Support and oppose are kept apart; neither is money that reached a campaign. */
export function targetingByCandidate(spender: OutsideSpender, candidates: RaceCandidate[]): Targeting[] {
  return candidates
    .map((candidate) => {
      const rows = spender.by_candidate.filter((r) => r.candidate_id === candidate.candidate_id);
      const sum = (so: "S" | "O" | null) => rows.filter((r) => r.support_oppose === so).reduce((s, r) => s + r.amount, 0);
      return { candidate, support: sum("S"), oppose: sum("O"), unlabelled: sum(null) };
    })
    .filter((t) => t.support > 0 || t.oppose > 0 || t.unlabelled > 0);
}

const surname = (c: RaceCandidate) => c.name.split(" ").at(-1) ?? c.name;
const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/**
 * One outside spender whose self-described focus names the current issue (D-66: what the organisation says it is for,
 * never what its dollars were spent on). Dollar figures are independent expenditures targeting a candidate.
 */
export function FunderRow({ raceId, funder, candidates }: { raceId: string; funder: IssueFunder; candidates: RaceCandidate[] }) {
  const { spender, focus } = funder;
  const targeting = targetingByCandidate(spender, candidates);
  const focusSource = focus.basis.source_urls[0];
  return (
    <li className="policies-funder">
      <div className="policies-funder-head">
        <h4>
          <Link href={routes.entity(raceId, spender.entity_id)}>{spender.name}</Link>
        </h4>
        <div className="policies-chips">
          <Chip tone="muted">{spender.committee_type_label}</Chip>
          <Chip tone="neutral" title={focus.basis.rule}>
            {FOCUS_KIND_LABELS[focus.kind]}
          </Chip>
        </div>
      </div>
      <p className="policies-focus" title={focus.basis.rule}>
        <span className="policies-focus-label">Self-described focus</span> {focus.description}
        {focusSource && (
          <>
            {" "}
            <SourceLink href={focusSource} label={host(focusSource)} />
          </>
        )}
      </p>
      <dl className="policies-targeting">
        <div>
          <dt>Independent expenditures</dt>
          <dd>
            <Money amount={spender.total} /> <SourceLink href={spender.source_url} label="fec.gov" />
          </dd>
        </div>
        <div>
          <dt>Targeting</dt>
          <dd>
            {targeting.length === 0 ? (
              <span className="policies-meta">No candidate named on the IE rows.</span>
            ) : (
              targeting.map((t) => (
                <span key={t.candidate.candidate_id} className="policies-target">
                  {t.support > 0 && (
                    <>
                      Supports {surname(t.candidate)} <Money amount={t.support} />
                    </>
                  )}
                  {t.support > 0 && t.oppose > 0 && " · "}
                  {t.oppose > 0 && (
                    <>
                      Opposes {surname(t.candidate)} <Money amount={t.oppose} />
                    </>
                  )}
                  {(t.support > 0 || t.oppose > 0) && t.unlabelled > 0 && " · "}
                  {t.unlabelled > 0 && (
                    <>
                      Names {surname(t.candidate)} <Money amount={t.unlabelled} /> <small>(no support/oppose filed)</small>
                    </>
                  )}
                </span>
              ))
            )}
          </dd>
        </div>
      </dl>
      <footer className="policies-links">
        {spender.has_chain && <Link href={routes.chain(raceId, spender.entity_id)}>Funding chain →</Link>}
        <Link href={routes.entity(raceId, spender.entity_id)}>Entity →</Link>
      </footer>
    </li>
  );
}
