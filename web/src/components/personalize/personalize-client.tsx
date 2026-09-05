"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ISSUE_AXES, ISSUES, type Dossier, type IssueId, type RaceSummary } from "@citizen-gotham/contracts";
import { alignRaces, directionLabel, type CandidateAlignment, type RaceAlignment } from "@/lib/alignment";
import { EMPTY_PREFS, loadPrefs, savePrefs, type UserPrefs } from "@/lib/prefs";
import { pct, routes } from "@/lib/format";
import { Card, Chip } from "@/components/ui";
import { PartyTag } from "@/components/ui/party-tag";
import { EvidenceList } from "@/components/dossier/evidence-list";

const SKIP = "skip";
const SKIP_REASON: Record<"no_record" | "no_coded_position" | "no_opinion", string> = {
  no_record: "no record",
  no_coded_position: "no coded position",
  no_opinion: "you skipped this",
};

const SCALE: { value: 1 | 2 | 3 | 4 | 5; label: string }[] = [
  { value: 1, label: "Strongly" },
  { value: 2, label: "Lean" },
  { value: 3, label: "Neutral" },
  { value: 4, label: "Lean" },
  { value: 5, label: "Strongly" },
];

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-neutral-300 bg-white text-sm">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`px-3 py-1.5 transition-colors ${
              selected ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"
            } border-l border-neutral-300 first:border-l-0`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function issueLabel(issueId: IssueId): string {
  return ISSUES.find((issue) => issue.id === issueId)?.label ?? issueId;
}

function userLabel(issueId: IssueId, opinion: number | undefined): string {
  if (opinion === undefined) return "neutral";
  return opinion === 3 ? "neutral" : directionLabel(issueId, opinion - 3);
}

function CandidateResult({ result, answered }: { result: CandidateAlignment; answered: number }) {
  return (
    <article className="border-t border-neutral-100 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{result.name}</h3>
            <PartyTag party={result.party} />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {result.role} · {result.evidence_basis === "record" ? "votes and bills" : "stated positions"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums">{result.score === null ? "not comparable" : pct(result.score)}</div>
          <div className="text-xs text-neutral-500">
            compared on {result.compared.length} of {answered} issues you answered
          </div>
        </div>
      </div>
      <Link href={routes.candidate(result.race_id, result.candidate_id)} className="mt-2 inline-block text-xs text-neutral-600 underline decoration-dotted underline-offset-2">
        Open dossier →
      </Link>
      <details className="mt-3 rounded border border-neutral-200">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-neutral-700">Show issue-by-issue alignment</summary>
        <div className="space-y-4 border-t border-neutral-100 px-3 py-3">
          {result.compared.map((item) => (
            <div key={item.issue_id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-medium">{issueLabel(item.issue_id)}</h4>
                <Chip tone={item.stance.confidence === "high" ? "green" : item.stance.confidence === "medium" ? "amber" : "muted"}>
                  {item.stance.confidence} confidence
                </Chip>
              </div>
              <p className="mt-1 text-xs text-neutral-600">
                you: {userLabel(item.issue_id, item.user + 3)} · record: {directionLabel(item.issue_id, item.candidate)}
              </p>
              <p className="mt-1 text-sm">{item.stance.position}</p>
              <EvidenceList evidence={item.stance.evidence} />
            </div>
          ))}
          {result.skipped.length > 0 && (
            <div className="border-t border-neutral-100 pt-3">
              <h4 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Skipped issues</h4>
              <ul className="mt-1 space-y-1 text-xs text-neutral-600">
                {result.skipped.map((item) => (
                  <li key={item.issue_id}>
                    {issueLabel(item.issue_id)} · {SKIP_REASON[item.reason]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </article>
  );
}

function RaceResults({ result, answered }: { result: RaceAlignment; answered: number }) {
  return (
    <Card title={`${result.race.label} · alignment estimate`}>
      <div className="space-y-5">
        {result.candidates.map((candidate) => (
          <CandidateResult key={candidate.candidate_id} result={candidate} answered={answered} />
        ))}
      </div>
    </Card>
  );
}

export function PersonalizeClient({ races, dossiers }: { races: RaceSummary[]; dossiers: Dossier[] }) {
  const [prefs, setPrefs] = useState<UserPrefs>(EMPTY_PREFS);
  const [loaded, setLoaded] = useState(false);
  const states = useMemo(() => [...new Set(races.map((race) => race.state))].sort(), [races]);
  const results = useMemo(() => alignRaces(prefs, races, dossiers), [prefs, races, dossiers]);
  const answered = Object.keys(prefs.opinions).length;

  useEffect(() => {
    setPrefs(loadPrefs());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) savePrefs(prefs);
  }, [loaded, prefs]);

  function updatePrefs(update: (current: UserPrefs) => UserPrefs) {
    setPrefs((current) => update(current));
  }

  function setOpinion(issueId: IssueId, value: string) {
    updatePrefs((current) => {
      const opinions = { ...current.opinions };
      if (value === SKIP) delete opinions[issueId];
      else opinions[issueId] = Number(value) as 1 | 2 | 3 | 4 | 5;
      return { ...current, opinions };
    });
  }

  return (
    <div className="space-y-8">
      <header className="py-4">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Where do you stand?</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-neutral-600">
          Set your positions on ten issues and see how closely each candidate&apos;s public record aligns with them. Your answers
          stay in this browser.
        </p>
      </header>

      <Card title="Where should we look?">
        <label className="block text-sm font-medium" htmlFor="state">
          State where you are registered
        </label>
        <select
          id="state"
          className="mt-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base"
          value={prefs.state ?? ""}
          onChange={(event) => updatePrefs((current) => ({ ...current, state: event.target.value || null }))}
        >
          <option value="">— choose —</option>
          {states.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-neutral-500">Only states with loaded race dossiers appear here.</p>
      </Card>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">Your issue positions</h2>
          <p className="text-sm text-neutral-500">
            {answered} of {ISSUES.length} answered · pick the side you lean toward, or leave an issue unanswered
          </p>
        </div>
        <div className="space-y-4">
          {ISSUES.map((issue, index) => {
            const opinion = prefs.opinions[issue.id];
            const axis = ISSUE_AXES[issue.id];
            return (
              <section key={issue.id} className="rounded-lg border border-neutral-200 bg-white p-6 sm:p-8" aria-labelledby={`issue-${issue.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-2xl">
                    <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">
                      Issue {index + 1} of {ISSUES.length}
                    </p>
                    <h3 id={`issue-${issue.id}`} className="mt-1 text-2xl font-semibold tracking-tight">
                      {issue.label}
                    </h3>
                    <p className="mt-1 text-base text-neutral-500">{issue.description}</p>
                  </div>
                  <div className="flex flex-col items-start gap-1.5 sm:items-end">
                    <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">How much this matters to you</span>
                    <Segmented
                      label={`${issue.label} importance`}
                      value={prefs.importance[issue.id] ?? 2}
                      onChange={(value) =>
                        updatePrefs((current) => ({ ...current, importance: { ...current.importance, [issue.id]: value } }))
                      }
                      options={[
                        { value: 1 as const, label: "Less" },
                        { value: 2 as const, label: "Normal" },
                        { value: 3 as const, label: "More" },
                      ]}
                    />
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start">
                  <p className={`text-lg font-medium leading-snug ${opinion !== undefined && opinion < 3 ? "text-neutral-900" : "text-neutral-600"}`}>
                    {axis.minus}
                  </p>
                  <div role="radiogroup" aria-label={`${issue.label} position`} className="flex items-start justify-center gap-2 sm:gap-3">
                    {SCALE.map((step) => {
                      const selected = opinion === step.value;
                      return (
                        <button
                          key={step.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={`${step.label} ${step.value < 3 ? axis.minus : step.value > 3 ? axis.plus : "neutral"}`}
                          onClick={() => setOpinion(issue.id, String(step.value))}
                          className={`flex w-14 flex-col items-center gap-1 text-xs sm:w-16 ${selected ? "text-neutral-900" : "text-neutral-500"}`}
                        >
                          <span
                            className={`flex h-11 w-11 items-center justify-center rounded-full border text-base font-semibold tabular-nums transition-colors sm:h-12 sm:w-12 ${
                              selected
                                ? "border-neutral-900 bg-neutral-900 text-white"
                                : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-900"
                            }`}
                          >
                            {step.value}
                          </span>
                          {step.label}
                        </button>
                      );
                    })}
                  </div>
                  <p
                    className={`text-lg font-medium leading-snug md:text-right ${opinion !== undefined && opinion > 3 ? "text-neutral-900" : "text-neutral-600"}`}
                  >
                    {axis.plus}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p className="text-neutral-500">
                    {opinion === undefined ? (
                      <>Not answered — this issue won&apos;t count.</>
                    ) : (
                      <>
                        Your position: <span className="font-medium text-neutral-900">{userLabel(issue.id, opinion)}</span>
                      </>
                    )}
                  </p>
                  {opinion !== undefined && (
                    <button
                      type="button"
                      onClick={() => setOpinion(issue.id, SKIP)}
                      className="text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
                    >
                      Clear answer
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <Card title="Evidence mix">
        <p className="text-sm font-medium">
          How much should stated positions (campaign statements) count relative to votes and bills?
        </p>
        <div className="mt-3">
          <Segmented
            label="Statement weight"
            value={prefs.statement_weight}
            onChange={(value) => updatePrefs((current) => ({ ...current, statement_weight: value }))}
            options={[
              { value: 0.25, label: "A quarter" },
              { value: 0.5, label: "Half" },
              { value: 1, label: "The same" },
            ]}
          />
        </div>
        <p className="mt-3 text-xs text-neutral-500">Saved on this device only; nothing leaves your browser.</p>
      </Card>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Alignment estimates</h2>
        {prefs.state === null ? (
          <Card>
            <p className="text-sm text-neutral-600">Choose a state above to see alignment estimates.</p>
          </Card>
        ) : answered === 0 ? (
          <Card>
            <p className="text-sm text-neutral-600">Answer at least one issue above to see alignment estimates.</p>
          </Card>
        ) : results.length === 0 ? (
          <Card>
            <p className="text-sm text-neutral-600">No races with dossiers loaded for {prefs.state.toUpperCase()} yet.</p>
          </Card>
        ) : (
          results.map((result) => <RaceResults key={result.race.race_id} result={result} answered={answered} />)
        )}
      </section>

      <Card title="How this is computed">
        <div className="space-y-2 text-sm text-neutral-600">
          <p>
            Each comparable issue gets an agreement from 0 to 1: 1 minus the distance between your direction and the record direction divided by 4.
            Importance, confidence, and the evidence mix weight each issue before a weighted mean becomes the alignment estimate.
          </p>
          <p>
            Issues are skipped when there is no record, no coded position, or you skipped the issue. Directions are human-coded against a published
            per-issue axis and marked needs review until checked by a second person.
          </p>
          <p>
            This is an alignment estimate of the public record against your stated positions, not an instruction about how to vote or a claim about
            why anyone voted. <Link href="/methodology#alignment" className="underline decoration-dotted underline-offset-2">Read the methodology.</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
