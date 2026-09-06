import Link from "next/link";
import { ISSUE_AXES, type Ad, type ISSUES, type RaceCandidate, type Stance } from "@campaign-commons/contracts";
import { date, money, range, routes } from "@/lib/format";
import { SourceLink } from "@/components/ui";
import { StanceCard } from "./stance-card";
import { FunderRow, type IssueFunder } from "./funder-row";

const ADS_SHOWN = 3;

export type CandidateStance = { candidate: RaceCandidate; stance: Stance | undefined; hasDossier: boolean };

/**
 * One issue: the candidates' stances on the left, beside the outside spenders whose self-described focus names the same
 * issue on the right. Same topic is the only link between the two columns; no direction is claimed for any funder.
 */
export function IssuePanel({ raceId, issue, stances, funders, ads, candidateNames }: {
  raceId: string;
  issue: (typeof ISSUES)[number];
  stances: CandidateStance[];
  funders: IssueFunder[];
  ads: Ad[];
  candidateNames: Record<string, string>;
}) {
  const axis = ISSUE_AXES[issue.id];
  const candidates = stances.map((s) => s.candidate);
  const lead = ads.slice().sort((a, b) => b.spend_range.min - a.spend_range.min).slice(0, ADS_SHOWN);
  return (
    <section className="policies-panel" aria-labelledby={`policies-${issue.id}-heading`}>
      <header className="policies-panel-head">
        <h2 id={`policies-${issue.id}-heading`}>{issue.label}</h2>
        <p>{issue.description}</p>
        <p className="policies-axis" title="The published axis the dossier's direction labels are coded against">
          Axis · <span>{axis.minus}</span> ↔ <span>{axis.plus}</span>
        </p>
      </header>

      <div className="policies-columns">
        <div className="policies-column">
          <h3>
            Candidate stances <small>from the dossier record</small>
          </h3>
          <div className="policies-stances">
            {stances.map((s) => (
              <StanceCard key={s.candidate.candidate_id} raceId={raceId} candidate={s.candidate} issueId={issue.id} stance={s.stance} hasDossier={s.hasDossier} />
            ))}
          </div>
        </div>

        <div className="policies-column">
          <h3>
            Spenders that describe themselves as focused on {issue.label.toLowerCase()} <small>self-description, sourced to the organisation</small>
          </h3>
          {funders.length === 0 ? (
            <p className="policies-empty">No outside spender in this race names {issue.label.toLowerCase()} in its self-described focus.</p>
          ) : (
            <ol className="policies-funders">
              {funders.map((f) => (
                <FunderRow key={f.spender.entity_id} raceId={raceId} funder={f} candidates={candidates} />
              ))}
            </ol>
          )}

          <div className="policies-ads">
            <h3>
              Ads tagged with this issue <small>a person tagged the creative; platform spend ranges</small>
            </h3>
            {ads.length === 0 ? (
              <p className="policies-empty">No ad in the loaded gallery is tagged with {issue.label.toLowerCase()}.</p>
            ) : (
              <>
                <ul>
                  {lead.map((ad) => {
                    const targets = ad.candidate_ids.map((id) => candidateNames[id] ?? id);
                    return (
                      <li key={ad.ad_id}>
                        <Link href={routes.ad(raceId, ad.ad_id)}>{ad.advertiser_name}</Link>
                        <span className="policies-meta">
                          {[
                            ad.support_oppose && targets.length > 0 ? `${ad.support_oppose === "S" ? "supports" : "opposes"} ${targets.join(", ")}` : null,
                            range(ad.spend_range.min, ad.spend_range.max, (n) => money(n)),
                            date(ad.first_shown),
                          ]
                            .filter(Boolean)
                            .join(" · ")}{" "}
                          <SourceLink href={ad.creative_url} label="ad library" />
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="policies-links">
                  <Link href={routes.ads(raceId)}>
                    {ads.length} tagged {ads.length === 1 ? "ad" : "ads"} on the ads wall →
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
