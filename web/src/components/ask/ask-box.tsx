"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ISSUE_IDS, type IssueId, type TrailSubject } from "@campaign-commons/contracts";
import { canonicalQuestion, isAskIntent, resolveQuestion, type AskIntent, type Resolution } from "@/lib/ask";
import { routes } from "@/lib/format";
import { AskGraphResponseSchema, type AskGraphResponse } from "@/lib/graph/facts";
import { GraphAnswer } from "./graph-answer";

/** Client-side budget for /api/ask-route; the server's own LLM timeout is shorter, so this only trips on a stalled network. */
const ASK_ROUTE_TIMEOUT_MS = 8000;
/** Client-side budget for /api/ask-graph: a classifier call, the graph query and a narrator call, each bounded on the server. */
const ASK_GRAPH_TIMEOUT_MS = 30_000;

/** Graph refusals worth showing under the route refusal: they carry deterministic detail (which names matched) the route could not know. */
const GRAPH_REFUSAL_SHOWN = new Set<Extract<AskGraphResponse, { kind: "unsupported" }>["reason"]>(["ambiguous_subject", "subject_not_found", "wrong_kind"]);

/** What /api/ask-route may return; the subject is only carried as an id and re-bound to this page's own subject list. */
const AskRouteBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    intent: z.string().refine(isAskIntent),
    subject: z.object({ id: z.string() }),
    matched: z.string(),
    note: z.string().nullable(),
    issueId: z.string().refine((s): s is IssueId => (ISSUE_IDS as readonly string[]).includes(s)).nullable(),
  }),
  z.object({
    kind: z.literal("unsupported"),
    reason: z.enum(["empty", "no_subject", "ambiguous_subject", "no_intent", "wrong_kind"]),
    message: z.string(),
    suggestions: z.array(z.string()),
  }),
]);

/**
 * Plain-English question box. A typed question is POSTed to /api/ask-route, where an LLM may pick the route
 * (intent, subject) from the closed set before the deterministic resolver (src/lib/ask.ts) has the final say; if the
 * call fails for any reason the same resolver runs here in the browser. When that route is an answer, the result is a
 * link to a statically generated answer page. Only when the route path cannot answer is /api/ask-graph tried (D-77):
 * its facts are read from the filings graph and rendered by GraphAnswer, with the model's summary labelled as such;
 * if the graph call fails or refuses, the route refusal stands.
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
  const [graph, setGraph] = useState<AskGraphResponse | null>(null);
  const [pending, setPending] = useState<null | "route" | "graph">(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending("route");
    setResult(null);
    setGraph(null);
    let r: Resolution;
    try {
      r = question.trim() === "" ? resolveQuestion(question, subjects, examples) : await askRoute(raceId, question, subjects);
    } catch {
      r = resolveQuestion(question, subjects, examples);
    }
    if (r.kind === "answer") {
      setPending(null);
      setResult(r);
      router.push(r.intent === "spender_issue" && r.issueId ? routes.issueAnswer(raceId, r.issueId, r.subject.id) : routes.answer(raceId, r.intent, r.subject.id));
      return;
    }
    let g: AskGraphResponse | null = null;
    if (r.reason !== "empty") {
      setPending("graph");
      try {
        g = await askGraph(raceId, question);
      } catch {
        g = null;
      }
    }
    setPending(null);
    setGraph(g);
    setResult(g?.kind === "graph" ? null : r);
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
            setGraph(null);
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

      {pending && (
        <p className="text-xs text-neutral-500" role="status">
          {pending === "route" ? "Looking up…" : "No precomputed page answers this; reading the filings graph…"}
        </p>
      )}

      {result?.kind === "answer" && (
        <p className="text-xs text-neutral-500">
          Opening: {canonicalQuestion(result.intent, result.subject, result.issueId)}
          {result.note ? ` — ${result.note}` : ""}
        </p>
      )}

      {result?.kind === "unsupported" && (
        <div className="ask-box-refusal rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{result.message}</p>
          {graph?.kind === "unsupported" && GRAPH_REFUSAL_SHOWN.has(graph.reason) && (
            <p className="ask-box-graph-refusal mt-2">
              {graph.message}
              {graph.matches.length > 0 ? ` (${graph.matches.map((m) => m.name).join("; ")})` : ""}
            </p>
          )}
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

      {graph?.kind === "graph" && (
        <div className="ask-box-graph rounded-md border border-neutral-200 bg-white p-4">
          <GraphAnswer result={graph} />
        </div>
      )}
    </div>
  );
}

/** Asks the graph endpoint; throws on any transport, timeout, or shape problem so the caller can keep the route refusal. */
async function askGraph(raceId: string, question: string): Promise<AskGraphResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASK_GRAPH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/ask-graph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raceId, question }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ask-graph ${res.status}`);
    return AskGraphResponseSchema.parse(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/** Asks the server to route the question; throws on any transport, timeout, or shape problem so the caller can resolve locally. */
async function askRoute(raceId: string, question: string, subjects: readonly TrailSubject[]): Promise<Resolution> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASK_ROUTE_TIMEOUT_MS);
  try {
    const res = await fetch("/api/ask-route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raceId, question }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ask-route ${res.status}`);
    const body = AskRouteBody.parse(await res.json());
    if (body.kind === "unsupported") return body;
    const subject = subjects.find((s) => s.id === body.subject.id);
    if (!subject) throw new Error(`ask-route: unknown subject ${body.subject.id}`);
    return { kind: "answer", intent: body.intent as AskIntent, subject, matched: body.matched, note: body.note, issueId: body.issueId };
  } finally {
    clearTimeout(timer);
  }
}

/** A suggested question rendered as a real link to its answer page when it resolves deterministically, else as text. */
export function SuggestionLink({ raceId, subjects, question }: { raceId: string; subjects: TrailSubject[]; question: string }) {
  const r = resolveQuestion(question, subjects);
  if (r.kind !== "answer") return <span className="text-xs text-neutral-500">{question}</span>;
  return (
    <Link
      href={r.intent === "spender_issue" && r.issueId ? routes.issueAnswer(raceId, r.issueId, r.subject.id) : routes.answer(raceId, r.intent, r.subject.id)}
      className="ask-suggestion inline-block rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:border-neutral-900 hover:text-neutral-900"
    >
      {question}
    </Link>
  );
}
