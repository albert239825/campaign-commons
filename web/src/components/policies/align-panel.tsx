"use client";

import Link from "next/link";
import React, { useEffect, useState, type FormEvent, type SyntheticEvent } from "react";
import type { ISSUES } from "@campaign-commons/contracts";
import { AdjacencyNote, Chip, Money, SourceLink } from "@/components/ui";
import { PartyTag } from "@/components/ui/party-tag";
import { alignVerdict, USER_VIEW_LABELS } from "@/lib/align-verdict";
import type { AskAlignResponse, Statement } from "@/lib/align-llm";
import type { AlignFunder, AlignFundersResponse } from "@/lib/align-funders";
import { directionLabel } from "@/lib/alignment";
import { loadPrefs, savePrefs } from "@/lib/prefs";
import { surname } from "./funder-row";
import type { CandidateStance } from "./issue-panel";

type Issue = (typeof ISSUES)[number];

const VERDICT_TONES = {
  aligned: "green",
  opposed: "amber",
  mixed: "neutral",
  no_record: "muted",
  no_view: "muted",
} as const;

const VERDICT_LABELS = {
  aligned: "aligned",
  opposed: "opposed",
  mixed: "mixed",
  no_record: "no record",
  no_view: "pick your view",
} as const;

const TAG_LABELS = {
  machine: "model-tagged",
  position: "stated position",
  focus: "self-described focus",
} as const;

class StatusError extends Error {
  status: number;

  constructor(status: number) {
    super(`Request failed with status ${status}`);
    this.status = status;
  }
}

function dateLabel(value: string | null): string {
  return value ? value : "date unavailable";
}

function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function basisText(candidate: CandidateStance, issue: Issue, value: ReturnType<typeof alignVerdict>): string | null {
  if (value.basis === "record" && value.candidate !== null) {
    return `Compared against the coded record: ${directionLabel(issue.id, value.candidate)}. Record above ↑`;
  }
  if (value.basis === "model" && value.candidate !== null) {
    return `Compared against the model-proposed direction (unreviewed): ${directionLabel(issue.id, value.candidate)}.`;
  }
  if (candidate.stance) return "Record above ↑";
  return null;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new StatusError(response.status);
  return (await response.json()) as T;
}

function OfflineStatements({ machine }: { machine: CandidateStance["machine"] }) {
  if (!machine) return null;
  return (
    <div className="policies-align-offline">
      <p className="policies-meta">
        Offline model summary (x_stances, {machine.provenance.tagged_by || machine.provenance.model})
      </p>
      <p className="policies-align-summary">{machine.summary}</p>
      <ol className="policies-align-sources">
        {machine.sources.map((source) => (
          <li key={source.url}>
            <blockquote>“{source.excerpt}”</blockquote>
            <span className="policies-meta">
              {source.publisher} · {dateLabel(source.published_on)} ·{" "}
              <SourceLink href={source.url} label={sourceLabel(source.url)} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LiveStatements({ result, issue }: { result: AskAlignResponse; issue: Issue }) {
  if (result.via === "unavailable") {
    return <p className="policies-empty">Live research is unavailable (no model key configured or the provider did not answer); offline rows only.</p>;
  }
  if (result.statements.length === 0) {
    return <p className="policies-empty">The model found no quotable statement with a source URL.</p>;
  }
  return (
    <div className="policies-align-live">
      <ol className="policies-align-sources">
        {result.statements.map((statement) => (
          <StatementRow key={statement.source_url} statement={statement} issue={issue} />
        ))}
      </ol>
      <p className="policies-meta">
        Retrieved {result.retrieved_at.slice(0, 10)} via {result.model ?? "Grok"}
        {result.cached ? ", cached" : ""}
      </p>
    </div>
  );
}

function StatementRow({ statement, issue }: { statement: Statement; issue: Issue }) {
  return (
    <li>
      <blockquote>“{statement.quote}”</blockquote>
      <span className="policies-meta">
        {statement.publisher || "Publisher unavailable"} · {dateLabel(statement.published_at)} ·{" "}
        <SourceLink href={statement.source_url} label={sourceLabel(statement.source_url)} />
        {statement.direction !== null && (
          <>
            {" "}
            <Chip tone="neutral">{directionLabel(issue.id, statement.direction)}</Chip>
          </>
        )}
      </span>
    </li>
  );
}

function ResearchBlock({ raceId, issue, candidate }: { raceId: string; issue: Issue; candidate: CandidateStance }) {
  const [result, setResult] = useState<AskAlignResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<"rate" | "network" | null>(null);
  const [question, setQuestion] = useState("");
  const [focusedQuestion, setFocusedQuestion] = useState<string | null>(null);

  async function research(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    const focused = trimmed.length >= 3 ? trimmed : "";
    setLoading(true);
    setError(null);
    setFocusedQuestion(focused || null);
    try {
      const next = await postJson<AskAlignResponse>("/api/ask-align", {
        raceId,
        issueId: issue.id,
        candidateId: candidate.candidate.candidate_id,
        ...(focused ? { question: focused } : {}),
      });
      setResult(next);
    } catch (cause) {
      if (cause instanceof StatusError && cause.status === 429) setError("rate");
      else if (cause instanceof TypeError) setError("network");
      else setError("network");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="policies-align-research">
      <h4>
        Recent statements <small>model-found, unreviewed — Grok web search; only verbatim quotes with a source URL are shown</small>
      </h4>
      <OfflineStatements machine={candidate.machine} />
      <form className="policies-align-research-form" onSubmit={research}>
        <button type="submit" className="policies-align-action" disabled={loading}>
          {loading ? "Researching…" : "Research with Grok"}
        </button>
        <input
          type="text"
          className="policies-align-question"
          maxLength={200}
          placeholder="Optional: focus the search, e.g. their vote on the 2022 bill"
          aria-label="Research question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={loading}
        />
      </form>
      {error === "rate" && <p className="policies-empty">Rate limited; try again in a minute.</p>}
      {error === "network" && <p className="policies-empty">Could not reach the server.</p>}
      {result && focusedQuestion && <p className="policies-meta">Focused on: “{focusedQuestion}”</p>}
      {result && <LiveStatements result={result} issue={issue} />}
    </div>
  );
}

function FunderRow({ funder, issue }: { funder: AlignFunder; issue: Issue }) {
  return (
    <li className="policies-align-funder">
      <div>
        {funder.href ? <Link href={funder.href}>{funder.name}</Link> : <span>{funder.name}</span>}
        <Chip tone="muted">{TAG_LABELS[funder.tag_layer]}</Chip>
      </div>
      <div className="policies-meta">
        <Money amount={funder.amount} />{" "}
        {funder.amount_basis === "listed_gifts" && <span>listed gifts only</span>} ·{" "}
        {funder.source_url ? <SourceLink href={funder.source_url} label="fec.gov" /> : <span>no source</span>}
      </div>
      {funder.position && (
        <p className="policies-meta">
          Its own stated direction: {directionLabel(issue.id, funder.position.direction)} — “{funder.position.quote}”{" "}
          <SourceLink href={funder.position.source_url} label={sourceLabel(funder.position.source_url)} />
        </p>
      )}
    </li>
  );
}

function FunderRows({ issue, candidate, response }: { issue: Issue; candidate: CandidateStance; response: AlignFundersResponse }) {
  return (
    <div className="policies-align-funders">
      <div>
        <h4>Gave to {surname(candidate.candidate)}&apos;s committee</h4>
        {response.candidate.length === 0 ? (
          <p className="policies-empty">No funder tagged on {issue.label.toLowerCase()} reached the graph for this candidate.</p>
        ) : (
          <ol className="policies-align-funder-list">{response.candidate.map((funder) => <FunderRow key={funder.entity_id} funder={funder} issue={issue} />)}</ol>
        )}
      </div>
      <div>
        <h4>Across the race</h4>
        {response.race.length === 0 ? (
          <p className="policies-empty">No funder tagged on {issue.label.toLowerCase()} reached the graph for this race.</p>
        ) : (
          <ol className="policies-align-funder-list">{response.race.map((funder) => <FunderRow key={funder.entity_id} funder={funder} issue={issue} />)}</ol>
        )}
      </div>
      <AdjacencyNote />
      <p className="policies-meta">via {response.via === "graph" ? "graph" : "published files"}</p>
    </div>
  );
}

function FundersBlock({ raceId, issue, candidate }: { raceId: string; issue: Issue; candidate: CandidateStance }) {
  const [response, setResponse] = useState<AlignFundersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [requested, setRequested] = useState(false);

  async function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || requested) return;
    setRequested(true);
    setLoading(true);
    try {
      setResponse(
        await postJson<AlignFundersResponse>("/api/ask-align-funders", {
          raceId,
          issueId: issue.id,
          candidateId: candidate.candidate.candidate_id,
        }),
      );
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className="policies-align-funders-details" onToggle={onToggle}>
      <summary>Funders tagged on this issue <small>same topic is the only link — a tag on the funder&apos;s own words, never a filed record</small></summary>
      {loading && <p className="policies-empty">Loading funders…</p>}
      {error && <p className="policies-empty">Could not load tagged funders.</p>}
      {response && <FunderRows issue={issue} candidate={candidate} response={response} />}
    </details>
  );
}

function CandidateAlignment({ raceId, issue, user, candidate }: { raceId: string; issue: Issue; user: number | null; candidate: CandidateStance }) {
  const verdict = alignVerdict(user, candidate.stance?.direction, candidate.machine?.direction_proposed);
  const basis = basisText(candidate, issue, verdict);
  return (
    <article className="policies-align-candidate">
      <header className="policies-stance-head">
        <h4>
          {candidate.candidate.name} <PartyTag party={candidate.candidate.party} />
        </h4>
      </header>
      <div className="policies-chips">
        <Chip tone={VERDICT_TONES[verdict.verdict]}>{VERDICT_LABELS[verdict.verdict]}</Chip>
      </div>
      <p className="policies-align-reason">{verdict.reason}</p>
      {basis && <p className="policies-meta">{basis}</p>}
      <ResearchBlock raceId={raceId} issue={issue} candidate={candidate} />
    </article>
  );
}

export function AlignPanel({ raceId, issue, candidates }: { raceId: string; issue: Issue; candidates: CandidateStance[] }) {
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<number | null>(null);
  const labels = USER_VIEW_LABELS(issue.id);

  useEffect(() => {
    const opinion = loadPrefs().opinions[issue.id];
    setUser(typeof opinion === "number" ? opinion - 3 : null);
    setHydrated(true);
  }, [issue.id]);

  function choose(direction: number | null) {
    const prefs = loadPrefs();
    if (direction === null) {
      const opinions = { ...prefs.opinions };
      delete opinions[issue.id];
      savePrefs({ ...prefs, opinions });
    } else {
      savePrefs({ ...prefs, opinions: { ...prefs.opinions, [issue.id]: direction + 3 } });
    }
    setUser(direction);
  }

  return (
    <div className="policies-column policies-align">
      <h3>
        How do the candidates align with my views?{" "}
        <small>your view stays in this browser; the comparison is arithmetic on the same axis the record uses (D-76)</small>
      </h3>
      <div className="policies-align-view">
        <div className="policies-align-view-head">
          <span>Your view</span>
          {hydrated ? (
            <span className="policies-meta">{user === null ? "no view" : labels[user + 2]}</span>
          ) : (
            <span className="policies-meta">no view</span>
          )}
          {hydrated && user !== null && (
            <button type="button" className="policies-align-clear" onClick={() => choose(null)}>
              clear
            </button>
          )}
        </div>
        <div className="policies-align-choices" role="radiogroup" aria-label="Your view">
          {([-2, -1, 0, 1, 2] as const).map((direction, index) => (
            <button
              key={direction}
              type="button"
              role="radio"
              className="policies-align-choice"
              aria-checked={hydrated && user === direction}
              disabled={!hydrated}
              onClick={() => choose(direction)}
            >
              {labels[index]}
            </button>
          ))}
        </div>
      </div>
      <div className="policies-stances">
        {candidates.map((candidate) => (
          <CandidateAlignment key={candidate.candidate.candidate_id} raceId={raceId} issue={issue} user={hydrated ? user : null} candidate={candidate} />
        ))}
      </div>
      {candidates.map((candidate) => (
        <FundersBlock key={`funders-${candidate.candidate.candidate_id}`} raceId={raceId} issue={issue} candidate={candidate} />
      ))}
    </div>
  );
}
