import Link from "next/link";
import Image from "next/image";
import type { Party, RaceSummary } from "@campaign-commons/contracts";
import { date, routes } from "@/lib/format";

const PARTY_NAMES: Record<Party, string> = {
  DEM: "Democratic Party",
  REP: "Republican Party",
  LIB: "Libertarian Party",
  GRE: "Green Party",
  IND: "Independent",
  CON: "Constitution Party",
  OTH: "Other",
};

export function RaceBanner({ race }: { race: RaceSummary }) {
  const parties = Array.from(new Set(race.candidates.map((c) => c.party)));
  const officeName = { S: "US Senate", H: "US House", P: "US President" }[race.office];
  const stateName = race.label.split("·")[0].trim();

  return (
    <header className="race-overview">
      <div className={`race-banner ${race.office === "S" ? "race-banner--senate" : ""}`}>
        {race.office === "S" && (
          <Image
            className="race-banner-seal"
            src="/images/united-states-senate.webp"
            alt="United States Senate seal"
            width={160}
            height={160}
            sizes="(max-width: 680px) 88px, 140px"
            priority
          />
        )}
        <div className="race-banner-heading">
          <h1 className="race-title">
            <span className="block">{officeName} {race.cycle}</span>
            <span className="block">{stateName}</span>
          </h1>
          <p className="race-election-date">
            {race.status === "complete" ? "Election held" : "Election day"}
            {" · "}<time dateTime={race.election_date}>{date(race.election_date)}</time>
          </p>
        </div>
        <section className="race-banner-candidates" aria-labelledby="notable-candidates-title">
          <h2 id="notable-candidates-title">Notable candidates</h2>
          {parties.length > 0 ? (
            <dl>
              {parties.map((party) => (
                <div key={party}>
                  <dt>{PARTY_NAMES[party]}</dt>
                  <dd>
                    <ul>
                      {race.candidates.filter((c) => c.party === party).map((c) => (
                        <li key={c.candidate_id}>
                          <Link href={routes.candidate(race.race_id, c.candidate_id)}>{c.name}</Link>
                          {c.incumbent && <span className="race-candidate-role">{race.status === "complete" ? "Incumbent at election" : "Incumbent"}</span>}
                          <Link href={routes.candidate(race.race_id, c.candidate_id)} className="race-candidate-dossier" aria-label={`${c.name} dossier`}>
                            Dossier →
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          ) : <p>Candidate information has not been added yet.</p>}
        </section>
      </div>
    </header>
  );
}
