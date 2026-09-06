"use client";

// OWNER: Frontend A (landing page).
import { useRouter } from "next/navigation";
import React, { useState, type FormEvent } from "react";
import { routes } from "@/lib/format";

export function LandingAsk({
  races,
  examples,
}: {
  races: { race_id: string; label: string }[];
  examples: string[];
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [raceId, setRaceId] = useState(races[0]?.race_id);

  if (races.length === 0) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (trimmed === "" || !raceId) return;
    router.push(`${routes.ask(raceId)}?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <section className="landing-ask" aria-labelledby="ask-title">
      <div className="landing-ask-heading">
        <h2 id="ask-title">Ask a question about the money.</h2>
        <p>
          Plain English in, a sourced answer out — who funded whom, who paid for an ad, what a spender says it stands for. Nothing is written by a
          model; every figure links to its filing.
        </p>
      </div>
      <form className="landing-ask-form" onSubmit={submit}>
        {races.length > 1 && (
          <select className="landing-ask-select" aria-label="Race" value={raceId ?? ""} onChange={(e) => setRaceId(e.target.value)}>
            {races.map((race) => (
              <option key={race.race_id} value={race.race_id}>
                {race.label}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          className="landing-ask-input"
          aria-label="Ask a money question"
          placeholder={examples[0] ?? "Which outside groups ran ads attacking McCormick?"}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="landing-ask-button" disabled={question.trim() === "" || !raceId}>
          Ask
        </button>
      </form>
      {races.length === 1 && <p className="landing-ask-scope">Asking about {races[0].label}</p>}
      {examples.length > 0 && (
        <ul className="landing-ask-examples">
          {examples.slice(0, 4).map((q) => (
            <li key={q}>
              <button type="button" className="landing-secondary landing-ask-chip" onClick={() => setQuestion(q)}>
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
