import Link from "next/link";
import { ISSUES, type IssueId, type Party } from "@campaign-commons/contracts";
import { directionLabel, type CandidateAlignment, type RaceAlignment } from "@/lib/alignment";
import { routes } from "@/lib/format";

/** Party hue for the matrix; globals.css maps `data-party` to the site palette (DEM blue, REP red). */
const PARTY_HUE: Record<Party, "dem" | "rep" | "lib" | "gre" | "other"> = {
  DEM: "dem",
  REP: "rep",
  LIB: "lib",
  GRE: "gre",
  IND: "other",
  CON: "other",
  OTH: "other",
};

type Cell = { kind: "compared"; direction: number; agreement: number } | { kind: "skipped"; reason: string };

const SKIP_REASON: Record<CandidateAlignment["skipped"][number]["reason"], string> = {
  no_record: "no record",
  no_coded_position: "no coded position",
  no_opinion: "—",
};

function cellFor(candidate: CandidateAlignment, issueId: IssueId): Cell {
  const compared = candidate.compared.find((item) => item.issue_id === issueId);
  if (compared) return { kind: "compared", direction: compared.candidate, agreement: compared.agreement };
  const skipped = candidate.skipped.find((item) => item.issue_id === issueId);
  return { kind: "skipped", reason: skipped ? SKIP_REASON[skipped.reason] : "—" };
}

/** Issue × (you, candidates) grid. Per row, the candidate(s) with the highest agreement are filled in party colour. */
export function AlignmentMatrix({ result, opinions }: { result: RaceAlignment; opinions: Partial<Record<IssueId, number>> }) {
  const rows = ISSUES.filter((issue) => opinions[issue.id] !== undefined);
  if (rows.length === 0) return null;
  return (
    <div className="alignment-matrix">
      <div className="data-table-scroll overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs font-medium uppercase tracking-wider text-neutral-500">
              <th scope="col">Issue</th>
              <th scope="col">Your position</th>
              {result.candidates.map((candidate) => (
                <th key={candidate.candidate_id} scope="col" data-party={PARTY_HUE[candidate.party]}>
                  <Link href={routes.candidate(candidate.race_id, candidate.candidate_id)} className="underline decoration-dotted underline-offset-4">
                    {candidate.name}
                  </Link>{" "}
                  <span className="font-normal normal-case tracking-normal">({candidate.party})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((issue) => {
              const opinion = opinions[issue.id] ?? 3;
              const cells = result.candidates.map((candidate) => ({ candidate, cell: cellFor(candidate, issue.id) }));
              const comparable = cells.filter(({ cell }) => cell.kind === "compared").length;
              const best = comparable >= 2 ? Math.max(...cells.map(({ cell }) => (cell.kind === "compared" ? cell.agreement : -1))) : Number.NaN;
              return (
                <tr key={issue.id}>
                  <th scope="row" className="align-top font-medium">
                    {issue.label}
                  </th>
                  <td className="align-top">{opinion === 3 ? "neutral" : directionLabel(issue.id, opinion - 3)}</td>
                  {cells.map(({ candidate, cell }) => {
                    const closest = cell.kind === "compared" && cell.agreement === best;
                    return (
                      <td
                        key={candidate.candidate_id}
                        className="align-top"
                        data-party={PARTY_HUE[candidate.party]}
                        data-state={cell.kind === "compared" ? (closest ? "closest" : "other") : "skipped"}
                      >
                        {cell.kind === "compared" ? (
                          <>
                            {directionLabel(issue.id, cell.direction)}
                            {closest && <span className="sr-only"> (closer to you)</span>}
                          </>
                        ) : (
                          cell.reason
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="alignment-matrix-note">
        Filled cells mark the candidate whose coded record is closer to your position on that issue (ties fill both; rows with only one comparable
        candidate are not filled). Positions are human-coded estimates; open a dossier for the underlying votes, bills, and statements.
      </p>
    </div>
  );
}
