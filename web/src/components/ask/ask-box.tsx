"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { TrailSubject } from "@campaign-commons/contracts";
import { canonicalQuestion, resolveQuestion, type Resolution } from "@/lib/ask";
import { routes } from "@/lib/format";

/**
 * Plain-English question box. Resolution happens in the browser by whole-word alias + keyword matching
 * (src/lib/ask.ts) and lands on a statically generated answer page; there is nothing to call.
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = resolveQuestion(question, subjects, examples);
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
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          Ask
        </button>
      </form>

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

/** A suggested question rendered as a real link to its answer page when it resolves, else as text. */
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
