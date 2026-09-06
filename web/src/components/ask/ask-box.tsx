"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { TrailSubject } from "@campaign-commons/contracts";
import { INTENT_LABELS, resolveQuestion, type Resolution } from "@/lib/ask";
import { routes } from "@/lib/format";
import { AskExploreResponseSchema, type AskExploreResponse } from "@/lib/graph/explore";
import { ExploreSankey } from "./explore-sankey";
import { ExploreAnswer } from "./explore-answer";

const ASK_EXPLORE_TIMEOUT_MS = 60_000;

const EXPLORE_REFUSAL_SHOWN = new Set<Extract<AskExploreResponse, { kind: "unsupported" }>["reason"]>(["no_query", "rejected_query", "query_failed", "empty"]);

/**
 * Plain-English question box. Every non-empty question first goes to exploratory graph mode (D-80), while the
 * deterministic resolver supplies a related precomputed page link. If the graph is unavailable, the browser falls
 * back to that page or its deterministic refusal.
 */
export function AskBox({
  raceId,
  subjects,
  examples,
  initial = "",
  autoFocus = false,
}: {
  raceId: string;
  subjects: TrailSubject[];
  examples: string[];
  initial?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState(initial);
  const [result, setResult] = useState<Resolution | null>(null);
  const [explore, setExplore] = useState<AskExploreResponse | null>(null);
  const [pending, setPending] = useState<null | "explore">(null);
  const [graphMode, setGraphMode] = useState(false);
  const diagram = explore?.kind === "explore" ? explore.diagram : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setResult(null);
    setExplore(null);
    const trimmed = question.trim();
    const nextGraphMode = /^@graph(?:\s|$)/i.test(trimmed);
    const graphQuestion = nextGraphMode ? trimmed.replace(/^@graph(?:\s|$)/i, "").trim() : trimmed;
    setGraphMode(nextGraphMode);
    const related = resolveQuestion(graphQuestion, subjects, examples);
    setResult(related);
    if (graphQuestion === "") {
      setPending(null);
      return;
    }
    setPending("explore");
    let x: AskExploreResponse | null = null;
    try {
      x = await askExplore(raceId, graphQuestion, nextGraphMode ? "graph" : "answer");
    } catch {
      x = { kind: "unsupported", reason: "explore_unavailable", message: "Exploratory graph mode is unavailable." };
    }
    setPending(null);
    setExplore(x);
    if (!nextGraphMode && x.kind === "unsupported" && x.reason === "explore_unavailable") {
      if (related.kind === "answer") {
        router.push(relatedPageHref(raceId, related));
      }
    }
  };

  return (
    <div className="ask-box space-y-3">
      <form onSubmit={submit} className="ask-box-form flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setResult(null);
            setExplore(null);
            setGraphMode(false);
          }}
          placeholder={examples[0] ?? "Who funds …?"}
          autoFocus={autoFocus}
          aria-label="Ask a money question about this race"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-neutral-900"
        />
        <button
          type="submit"
          disabled={pending !== null}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
      <p className="text-xs text-neutral-500">Start with @graph to draw the answer as a flow diagram.</p>

      {pending && (
        <p className="text-xs text-neutral-500" role="status">
          {graphMode
            ? "Composing a read-only query over the filings graph and drawing its flows…"
            : "Composing a read-only query over the filings graph…"}
        </p>
      )}

      {!graphMode &&
        ((result?.kind === "unsupported" && explore?.kind !== "explore") ||
          (explore?.kind === "unsupported" && EXPLORE_REFUSAL_SHOWN.has(explore.reason))) && (
        <div className="ask-box-refusal rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {result?.kind === "unsupported" && <p>{result.message}</p>}
          {explore?.kind === "unsupported" && EXPLORE_REFUSAL_SHOWN.has(explore.reason) && <p className="ask-box-graph-refusal mt-2">{explore.message}</p>}
          {result?.kind === "unsupported" && result.suggestions.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {result.suggestions.map((s) => (
                <li key={s}>
                  <SuggestionLink raceId={raceId} subjects={subjects} question={s} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {graphMode && explore?.kind === "unsupported" && (
        <div className="ask-box-refusal rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>This analysis cannot be done: {explore.message}</p>
        </div>
      )}
      {graphMode && diagram !== null && !diagram.ok && (
        <div className="ask-box-refusal rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{diagram.message}</p>
        </div>
      )}
      {explore?.kind === "explore" && (!graphMode || diagram?.ok === true) && (
        <div className="ask-box-graph rounded-md border border-neutral-200 bg-white p-4">
          {graphMode && diagram?.ok === true && <ExploreSankey data={diagram} />}
          <ExploreAnswer result={explore} />
        </div>
      )}
      {result?.kind === "unsupported" && graphMode && explore === null && pending === null && (
        <div className="ask-box-refusal rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-neutral-900">
          <p>{result.message}</p>
          {result.suggestions.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {result.suggestions.map((s) => (
                <li key={s}>
                  <SuggestionLink raceId={raceId} subjects={subjects} question={s} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result?.kind === "answer" && (!graphMode || diagram?.ok === true) && (
        <p className="text-xs text-neutral-500">
          Related precomputed page:{" "}
          <Link href={relatedPageHref(raceId, result)} className="underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            {INTENT_LABELS[result.intent]} — {result.subject.name}
          </Link>
          {result.note ? ` — ${result.note}` : ""}
        </p>
      )}
    </div>
  );
}

async function askExplore(raceId: string, question: string, mode: "answer" | "graph"): Promise<AskExploreResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASK_EXPLORE_TIMEOUT_MS);
  try {
    const res = await fetch("/api/ask-explore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raceId, question, mode }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ask-explore ${res.status}`);
    return AskExploreResponseSchema.parse(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

function relatedPageHref(raceId: string, related: Extract<Resolution, { kind: "answer" }>): string {
  return related.intent === "spender_issue" && related.issueId
    ? routes.issueAnswer(raceId, related.issueId, related.subject.id)
    : routes.answer(raceId, related.intent, related.subject.id);
}

/** A suggested question rendered as a real link to its answer page when it resolves deterministically, else as text. */
export function SuggestionLink({ raceId, subjects, question }: { raceId: string; subjects: TrailSubject[]; question: string }) {
  const r = resolveQuestion(question, subjects);
  if (r.kind !== "answer") return <span className="text-xs text-neutral-500">{question}</span>;
  return (
    <Link
      href={relatedPageHref(raceId, r)}
      className="ask-suggestion inline-block rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:border-neutral-900 hover:text-neutral-900"
    >
      {question}
    </Link>
  );
}
