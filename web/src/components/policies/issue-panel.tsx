import Link from "next/link";
import { ISSUE_AXES, type Ad, type ISSUES, type RaceCandidate, type Stance } from "@campaign-commons/contracts";
import { date, money, range, routes } from "@/lib/format";
import { SourceLink } from "@/components/ui";
import { StanceCard } from "./stance-card";
import { FunderRow, surname, targetingSide, type IssueFunder } from "./funder-row";

const ADS_SHOWN = 3;

export type CandidateStance = { candidate: RaceCandidate; stance: Stance | undefined; hasDossier: boolean };

/**
 * One issue: the candidates' full stance records side by side on top, then — in the same two columns — the outside spenders
 * whose self-described focus names the same issue, each placed under the candidate its FEC-coded IE dollars work for
 * (supports X, or opposes the other), then the ads tagged with the issue. Same topic is the only link between a stance and a
 * funder; the column a funder sits in is a targeting fact on file, not agreement with the stance above it.
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
  const sided = candidates.length === 2;
  const bySide = candidates.map((c) => funders.filter((f) => targetingSide(f.spender, candidates)?.candidate_id === c.candidate_id));
  const unsided = sided ? funders.filter((f) => targetingSide(f.spender, candidates) === null) : funders;
  const other = (c: RaceCandidate) => candidates.find((x) => x.candidate_id !== c.candidate_id) ?? c;
  const lower = issue.label.toLowerCase();
  return (
    <section className="policies-panel" aria-labelledby={`policies-${issue.id}-heading`}>
      <header className="policies-panel-head">
        <h2 id={`policies-${issue.id}-heading`}>{issue.label}</h2>
        <p>{issue.description}</p>
        <p className="policies-axis" title="The published axis the dossier's direction labels are coded against">
          Axis · <span>{axis.minus}</span> ↔ <span>{axis.plus}</span>
        </p>
      </header>

      <div className="policies-column policies-record">
        <h3>
          Candidate stances <small>the stance record: position, coded direction and every evidence record, each linked to its source</small>
        </h3>
        <div className="policies-stances">
          {stances.map((s) => (
            <StanceCard key={s.candidate.candidate_id} raceId={raceId} candidate={s.candidate} issueId={issue.id} stance={s.stance} hasDossier={s.hasDossier} />
          ))}
        </div>
      </div>

      <div className="policies-column policies-funders-section">
        <h3>
          Spenders that describe themselves as focused on {lower}{" "}
          <small>
            self-description, sourced to the organisation{sided && "; placed by whose side their FEC-coded independent expenditures were on — targeting, not money to a campaign"}
          </small>
        </h3>
        {funders.length === 0 ? (
          <p className="policies-empty">No outside spender in this race names {lower} in its self-described focus.</p>
        ) : (
          <>
            {sided && (
              <div className="policies-stances policies-sides">
                {candidates.map((c, i) => (
                  <div key={c.candidate_id} className="policies-side" aria-label={`Spenders on ${surname(c)}'s side`}>
                    <h4>
                      For {surname(c)} <small>supports {surname(c)} or opposes {surname(other(c))}</small>
                    </h4>
                    {bySide[i].length === 0 ? (
                      <p className="policies-empty">No {lower} spender&apos;s IEs were on {surname(c)}&apos;s side.</p>
                    ) : (
                      <ol className="policies-funders">
                        {bySide[i].map((f) => (
                          <FunderRow key={f.spender.entity_id} raceId={raceId} funder={f} candidates={candidates} />
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            )}
            {unsided.length > 0 && (
              <div className="policies-side" aria-label="Spenders on neither side">
                {sided && (
                  <h4>
                    No single side <small>labelled IEs for both candidates&apos; sides, or no support/oppose code filed</small>
                  </h4>
                )}
                <ol className="policies-funders policies-funders-wide">
                  {unsided.map((f) => (
                    <FunderRow key={f.spender.entity_id} raceId={raceId} funder={f} candidates={candidates} />
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>

      <div className="policies-ads">
        <h3>
          Ads tagged with this issue <small>a person tagged the creative; platform spend ranges</small>
        </h3>
        {ads.length === 0 ? (
          <p className="policies-empty">No ad in the loaded gallery is tagged with {lower}.</p>
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
    </section>
  );
}
