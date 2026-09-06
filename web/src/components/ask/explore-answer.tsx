// OWNER: Money Trails exploratory mode (D-85).
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Card, Chip, SourceLink } from "@/components/ui";
import { factSentence } from "@/lib/graph/facts";
import { AskExploreResponseSchema, exploreCellText, formatExploreNumber, type AskExploreResponse, type ExploreCell, type ExploreResult } from "@/lib/graph/explore";
import { AskProgress } from "./ask-progress";

const WITHHELD_COPY: Record<Extract<ExploreResult["narrative"], { status: "withheld" }>["reason"], string> = {
  empty: "the model returned nothing",
  too_long: "the model's text ran past the length allowed",
  url: "the model's text contained a link",
  bad_citation: "the model cited a row that is not in the table below",
  uncited_number: "the model stated a figure without citing a row",
  unknown_number: "the model stated a figure that is not in any row below",
  paged: "this is an additional page of rows",
};

export async function fetchExplorePage(raceId: string, question: string, cypher: string, offset: number): Promise<AskExploreResponse> {
  const response = await fetch("/api/ask-explore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raceId, question, mode: "answer", page: { cypher, offset } }),
  });
  if (!response.ok) throw new Error(`ask-explore ${response.status}`);
  return AskExploreResponseSchema.parse(await response.json());
}

export function appendExplorePage(
  currentRows: ExploreResult["rows"],
  currentColumns: ExploreResult["columns"],
  next: Extract<AskExploreResponse, { kind: "explore" }>,
) {
  const fingerprints = new Set(currentRows.map((row) => JSON.stringify(row.cells)));
  const uniqueRows = next.rows.filter((row) => {
    const fingerprint = JSON.stringify(row.cells);
    if (fingerprints.has(fingerprint)) return false;
    fingerprints.add(fingerprint);
    return true;
  });
  return {
    rows: [...currentRows, ...uniqueRows],
    columns: [...new Set([...currentColumns, ...next.columns])],
    truncated: uniqueRows.length === 0 ? false : next.truncated,
    addedRange: uniqueRows.length > 0 ? { from: uniqueRows[0].n, to: uniqueRows[uniqueRows.length - 1].n } : null,
  };
}

export function canPageExploreResult(result: ExploreResult, rowCount: number): boolean {
  return result.diagram === null && result.truncated && rowCount > 0 && rowCount < 200;
}

export function ExploreAnswer({ result, raceId, question }: { result: ExploreResult; raceId: string; question: string }) {
  const [rows, setRows] = useState(result.rows);
  const [columns, setColumns] = useState(result.columns);
  const [truncated, setTruncated] = useState(result.truncated);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedRange, setAddedRange] = useState<{ from: number; to: number } | null>(null);
  const [firstPageRowCount, setFirstPageRowCount] = useState(result.rows.length);

  useEffect(() => {
    setRows(result.rows);
    setColumns(result.columns);
    setTruncated(result.truncated);
    setLoading(false);
    setError(null);
    setAddedRange(null);
    setFirstPageRowCount(result.rows.length);
  }, [result]);

  const offset = rows.length;
  const canShowMore = canPageExploreResult({ ...result, truncated }, offset);
  const showMore = async () => {
    if (loading || !canShowMore) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchExplorePage(raceId, question, result.cypher, offset);
      if (next.kind !== "explore") throw new Error(next.message);
      const appended = appendExplorePage(rows, columns, next);
      setRows(appended.rows);
      setColumns(appended.columns);
      setTruncated(appended.truncated);
      setAddedRange(appended.addedRange);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load more rows.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="explore-answer space-y-4" aria-label="Exploratory graph answer">
      <header className="space-y-2">
        <Chip tone="amber">Exploratory — model-composed query</Chip>
        <p className="text-sm text-neutral-700">
          A language model wrote this query from the question; the site ran it read-only against the filings graph and shows every returned row with its source.
          Unlike the fixed question pages, the query itself was not reviewed by a person — treat the framing as a hypothesis and the rows as the evidence.
        </p>
        <p className="text-sm italic text-neutral-700">{result.description}</p>
        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-600 hover:text-neutral-900">Show the query</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-neutral-50 p-3 text-xs text-neutral-700">{result.cypher}</pre>
        </details>
      </header>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                <th className="w-8 px-2 py-2 font-medium">#</th>
                {columns.map((column) => (
                  <th key={column} className="px-2 py-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((row) => (
                <tr key={row.n} id={`explore-row-${row.n}`}>
                  <td className="px-2 py-2 align-top tabular-nums text-xs text-neutral-500">{row.n}</td>
                  {columns.map((column) => (
                    <td key={column} className="px-2 py-2 align-top text-neutral-900">
                      <ExploreCellView column={column} cell={row.cells[column] ?? { t: "null" }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Showing {rows.length} rows{truncated ? " — more available" : ""}
          {addedRange ? ` (rows ${addedRange.from}–${addedRange.to} added${result.narrative.status === "ok" ? `; the summary below covers the first ${firstPageRowCount} only` : ""})` : ""}.
        </p>
        {canShowMore && (
          <div className="mt-3 space-y-1">
            <button
              type="button"
              onClick={showMore}
              disabled={loading}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-50"
            >
              Show more
            </button>
            {loading && <AskProgress graphMode={false} label="Loading more rows…" />}
            {error && <p className="text-xs text-neutral-500">{error}</p>}
          </div>
        )}
      </Card>

      {result.context.length > 0 && (
        <Card>
          <p className="text-xs font-medium text-neutral-700">
            Added by the site, not the model&apos;s query: filed spending for/against candidates and campaign ownership for the committees above
          </p>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm">
            {result.context.map((fact) => (
              <li key={`${fact.n}-${fact.from.id}-${fact.to.id}-${fact.rel}`} className="flex flex-wrap items-baseline gap-2 py-2 text-neutral-900">
                <span className="text-xs tabular-nums text-neutral-500">[{fact.n}]</span>
                <span>{factSentence(fact)}</span>
                {fact.source_url && <SourceLink href={fact.source_url} />}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {result.narrative.status === "ok" ? (
        <div className="graph-narrative border-l-2 border-neutral-300 pl-4">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Model-written summary — Grok, from the records below only</p>
          <p className="mt-1 text-sm leading-relaxed text-neutral-900">
            <Cited text={result.narrative.text} rows={rows} />
          </p>
        </div>
      ) : (
        <p className="graph-narrative-withheld text-xs text-neutral-500">
          {result.narrative.status === "withheld"
            ? `No summary is shown: ${WITHHELD_COPY[result.narrative.reason]}. The rows themselves are above.`
            : "No summary is shown: the model was unavailable. The rows themselves are above."}
        </p>
      )}
    </section>
  );
}

function ExploreCellView({ column, cell }: { column: string; cell: ExploreCell }) {
  switch (cell.t) {
    case "node":
      return cell.node.href ? (
        <Link href={cell.node.href} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
          {cell.node.name}
        </Link>
      ) : (
        cell.node.name
      );
    case "edge":
      return (
        <span className="inline-flex flex-wrap items-baseline gap-2">
          {factSentence(cell.fact)}
          {cell.fact.source_url && <SourceLink href={cell.fact.source_url} />}
        </span>
      );
    case "number":
      return formatExploreNumber(cell.value, /amount|total|sum|dollars|spent|gave|raised/i.test(column));
    default:
      return exploreCellText(column, cell);
  }
}

function Cited({ text, rows }: { text: string; rows: readonly { n: number }[] }) {
  const out: ReactNode[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const n = Number(match[1]);
    out.push(text.slice(last, match.index));
    out.push(
      rows.some((row) => row.n === n) ? (
        <a key={`${match.index}-${n}`} href={`#explore-row-${n}`} className="text-xs text-neutral-500 hover:text-neutral-900">
          [{n}]
        </a>
      ) : (
        match[0]
      ),
    );
    last = match.index + match[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
