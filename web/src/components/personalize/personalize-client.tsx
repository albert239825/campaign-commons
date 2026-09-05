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
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Personalize</h1>
        <p className="mt-2 max-w-3xl text-sm text-neutral-600">
          Set your issue positions to compare them with the coded public record. Your answers stay in this browser.
        </p>
      </header>

      <Card title="Where should we look?">
        <label className="block text-sm font-medium" htmlFor="state">
          State
        </label>
        <select
          id="state"
          className="mt-2 rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
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

      <Card title="Your issue positions">
        <div className="space-y-5">
          {ISSUES.map((issue) => {
            const opinion = prefs.opinions[issue.id];
            return (
              <div key={issue.id} className="border-t border-neutral-100 pt-4 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">{issue.label}</h2>
                    <p className="text-xs text-neutral-500">{issue.description}</p>
                  </div>
                  <label className="text-xs text-neutral-600">
                    Importance{" "}
                    <select
                      className="ml-1 rounded border border-neutral-300 bg-white px-1.5 py-1"
                      value={prefs.importance[issue.id] ?? 2}
                      onChange={(event) =>
                        updatePrefs((current) => ({
                          ...current,
                          importance: { ...current.importance, [issue.id]: Number(event.target.value) as 1 | 2 | 3 },
                        }))
                      }
                    >
                      <option value={1}>low</option>
                      <option value={2}>normal</option>
                      <option value={3}>high</option>
                    </select>
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs text-neutral-600">
                  <span>{ISSUE_AXES[issue.id].minus}</span>
                  <span className="text-neutral-400">neutral</span>
                  <span className="text-right">{ISSUE_AXES[issue.id].plus}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={`${issue.label} position`}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <label key={value} className="flex cursor-pointer items-center gap-1 text-sm">
                      <input
                        type="radio"
                        name={`opinion-${issue.id}`}
                        value={value}
                        checked={opinion === value}
                        onChange={(event) => setOpinion(issue.id, event.target.value)}
                      />
                      {value}
                    </label>
                  ))}
                  <label className="ml-2 flex cursor-pointer items-center gap-1 text-sm text-neutral-500">
                    <input
                      type="radio"
                      name={`opinion-${issue.id}`}
                      value={SKIP}
                      checked={opinion === undefined}
                      onChange={(event) => setOpinion(issue.id, event.target.value)}
                    />
                    skip
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Evidence mix">
        <label className="block text-sm font-medium" htmlFor="statement-weight">
          How much should stated positions (campaign statements) count relative to votes and bills?
        </label>
        <select
          id="statement-weight"
          className="mt-2 rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          value={prefs.statement_weight}
          onChange={(event) => updatePrefs((current) => ({ ...current, statement_weight: Number(event.target.value) }))}
        >
          <option value={0.25}>0.25</option>
          <option value={0.5}>0.5</option>
          <option value={1}>1</option>
        </select>
        <p className="mt-3 text-xs text-neutral-500">Saved on this device only; nothing leaves your browser.</p>
      </Card>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Results</h2>
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
