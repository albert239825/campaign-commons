import Link from "next/link";
import { ISSUES, type IssueId, type Party } from "@citizen-gotham/contracts";
import { directionLabel, type CandidateAlignment, type RaceAlignment } from "@/lib/alignment";
import { routes } from "@/lib/format";

const PARTY_CELL: Record<Party, { closest: string; other: string; header: string }> = {
  DEM: { closest: "bg-blue-600 text-white border-blue-700", other: "bg-blue-50 text-blue-900 border-blue-200", header: "text-blue-800" },
  REP: { closest: "bg-red-600 text-white border-red-700", other: "bg-red-50 text-red-900 border-red-200", header: "text-red-800" },
  LIB: { closest: "bg-yellow-500 text-white border-yellow-600", other: "bg-yellow-50 text-yellow-900 border-yellow-200", header: "text-yellow-800" },
  GRE: { closest: "bg-green-600 text-white border-green-700", other: "bg-green-50 text-green-900 border-green-200", header: "text-green-800" },
  IND: { closest: "bg-neutral-700 text-white border-neutral-800", other: "bg-neutral-50 text-neutral-900 border-neutral-200", header: "text-neutral-800" },
  CON: { closest: "bg-neutral-700 text-white border-neutral-800", other: "bg-neutral-50 text-neutral-900 border-neutral-200", header: "text-neutral-800" },
  OTH: { closest: "bg-neutral-700 text-white border-neutral-800", other: "bg-neutral-50 text-neutral-900 border-neutral-200", header: "text-neutral-800" },
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
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr className="text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
            <th scope="col" className="px-3 py-2">
              Issue
            </th>
            <th scope="col" className="px-3 py-2">
              Your position
            </th>
            {result.candidates.map((candidate) => (
              <th key={candidate.candidate_id} scope="col" className={`px-3 py-2 ${PARTY_CELL[candidate.party].header}`}>
                <Link href={routes.candidate(candidate.race_id, candidate.candidate_id)} className="underline decoration-dotted underline-offset-2">
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
                <th scope="row" className="rounded-l-md bg-neutral-50 px-3 py-3 text-left align-top font-semibold text-neutral-900">
                  {issue.label}
                </th>
                <td className="bg-neutral-50 px-3 py-3 align-top text-neutral-800">{opinion === 3 ? "neutral" : directionLabel(issue.id, opinion - 3)}</td>
                {cells.map(({ candidate, cell }, index) => {
                  const closest = cell.kind === "compared" && cell.agreement === best;
                  const style = PARTY_CELL[candidate.party];
                  const last = index === cells.length - 1;
                  return (
                    <td
                      key={candidate.candidate_id}
                      className={`border px-3 py-3 align-top ${last ? "rounded-r-md" : ""} ${
                        cell.kind === "compared" ? (closest ? `${style.closest} font-semibold` : style.other) : "border-neutral-200 bg-white italic text-neutral-400"
                      }`}
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
      <p className="mt-2 text-xs text-neutral-500">
        Filled cells mark the candidate whose coded record is closer to your position on that issue (ties fill both; rows with only one comparable
        candidate are not filled). Positions are human-coded
        estimates; open a dossier for the underlying votes, bills, and statements.
      </p>
    </div>
  );
}
