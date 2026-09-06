"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { TrailSubject } from "@campaign-commons/contracts";
import { canonicalQuestion, resolveQuestion, type Resolution } from "@/lib/ask";
import { routes } from "@/lib/format";

/** Client-side budget for /api/ask-route; the server's own LLM timeout is shorter, so this only trips on a stalled network. */
const ASK_ROUTE_TIMEOUT_MS = 8000;

/**
 * Plain-English question box. A typed question is POSTed to /api/ask-route, where an LLM may pick the route
 * (intent, subject) from the closed set before the deterministic resolver (src/lib/ask.ts) has the final say; if the
 * call fails for any reason the same resolver runs here in the browser. Either way the result is a link to a statically
 * generated answer page — nothing the model writes is shown.
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
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setResult(null);
    let r: Resolution;
    try {
      r = question.trim() === "" ? resolveQuestion(question, subjects, examples) : await askRoute(raceId, question);
    } catch {
      r = resolveQuestion(question, subjects, examples);
    }
    setPending(false);
    setResult(r);
    if (r.kind === "answer") router.push(routes.answer(raceId, r.intent, r.subject.id));
  };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setResult(null);
          }}
          placeholder={examples[0] ?? "Who funds …?"}
          autoFocus={autoFocus}
          aria-label="Ask a money question about this race"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-neutral-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          Ask
        </button>
      </form>

      {pending && <p className="text-xs text-neutral-500">Looking up…</p>}

      {result?.kind === "answer" && (
        <p className="text-xs text-neutral-500">
          Opening: {canonicalQuestion(result.intent, result.subject)}
          {result.note ? ` — ${result.note}` : ""}
        </p>
      )}

      {result?.kind === "unsupported" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
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
    </div>
  );
}

/** Asks the server to route the question; throws on any transport, timeout, or shape problem so the caller can resolve locally. */
async function askRoute(raceId: string, question: string): Promise<Resolution> {
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
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || !("kind" in body)) throw new Error("ask-route: unexpected body");
    return body as Resolution;
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
      href={routes.answer(raceId, r.intent, r.subject.id)}
      className="inline-block rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:border-neutral-900 hover:text-neutral-900"
    >
      {question}
    </Link>
  );
}
