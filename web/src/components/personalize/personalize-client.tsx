"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ISSUE_AXES, ISSUES, type Dossier, type IssueId, type RaceSummary } from "@campaign-commons/contracts";
import { alignRaces, directionLabel, type CandidateAlignment, type RaceAlignment } from "@/lib/alignment";
import { EMPTY_PREFS, loadPrefs, savePrefs, type UserPrefs } from "@/lib/prefs";
import { pct, routes } from "@/lib/format";
import { US_STATES } from "@/lib/states";
import { Breadcrumbs, Card, Chip } from "@/components/ui";
import { DetailHeader, SectionNav } from "@/components/ui/detail-layout";
import { PartyTag } from "@/components/ui/party-tag";
import { EvidenceList } from "@/components/dossier/evidence-list";
import { AlignmentMatrix } from "@/components/personalize/alignment-matrix";

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
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button key={String(option.value)} type="button" role="radio" aria-checked={selected} onClick={() => onChange(option.value)}>
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
    <article className="alignment-candidate">
      <div className="alignment-candidate-heading">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h3>{result.name}</h3>
            <PartyTag party={result.party} />
          </div>
          <p className="alignment-candidate-basis">
            {result.role} · {result.evidence_basis === "record" ? "votes and bills" : "stated positions"} ·{" "}
            <Link href={routes.candidate(result.race_id, result.candidate_id)} className="underline decoration-dotted underline-offset-4 hover:text-neutral-900">
              Open dossier →
            </Link>
          </p>
        </div>
        <div className="alignment-score">
          <span className="tabular-nums">{result.score === null ? "not comparable" : pct(result.score)}</span>
          <span>
            compared on {result.compared.length} of {answered} issues you answered
          </span>
        </div>
      </div>
      <details className="alignment-breakdown">
        <summary>Show issue-by-issue alignment</summary>
        <div className="alignment-breakdown-body">
          {result.compared.map((item) => (
            <div key={item.issue_id} className="alignment-issue">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4>{issueLabel(item.issue_id)}</h4>
                <Chip tone={item.stance.confidence === "high" ? "green" : item.stance.confidence === "medium" ? "amber" : "muted"}>
                  {item.stance.confidence} confidence
                </Chip>
              </div>
              <p className="alignment-issue-compare">
                you: {userLabel(item.issue_id, item.user + 3)} · record: {directionLabel(item.issue_id, item.candidate)}
              </p>
              <p className="alignment-issue-position">{item.stance.position}</p>
              <EvidenceList evidence={item.stance.evidence} />
            </div>
          ))}
          {result.skipped.length > 0 && (
            <div className="alignment-skipped">
              <h4>Skipped issues</h4>
              <ul>
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

function RaceResults({ result, answered, opinions }: { result: RaceAlignment; answered: number; opinions: UserPrefs["opinions"] }) {
  return (
    <Card
      title={result.race.label}
      action={
        <Link href={routes.race(result.race.race_id)} className="text-sm underline decoration-dotted underline-offset-4 hover:text-neutral-900">
          Race ledger →
        </Link>
      }
    >
      <div className="alignment-matrix-block">
        <h3>Issue by issue</h3>
        <AlignmentMatrix result={result} opinions={opinions} />
      </div>
      <div className="alignment-candidates">
        <h3>Ranked by alignment estimate</h3>
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
  const coveredStates = useMemo(() => new Set(races.map((race) => race.state)), [races]);
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
    <div className="detail-page personalize-page">
      <Breadcrumbs items={[{ href: routes.home(), label: "Races" }, { label: "Personalize" }]} />

      <DetailHeader
        label="Your positions · the public record"
        title="Where do you stand?"
        actions={
          <div>
            <a href="#alignment" className="detail-primary-action">
              Jump to your estimate →
            </a>
            <Link href={`${routes.methodology()}#alignment`} className="underline decoration-dotted underline-offset-4 hover:text-neutral-900">
              How alignment is computed →
            </Link>
          </div>
        }
      >
        <p>
          Set your positions on ten issues and see how closely each candidate&apos;s public record aligns with them. This is an alignment estimate,
          not a recommendation; every issue links back to the votes, bills, and statements it was built from.
        </p>
        <p className="text-sm">Your answers are saved on this device only. Nothing leaves your browser.</p>
      </DetailHeader>

      <div className="detail-sections">
        <aside className="detail-sidebar">
          <SectionNav
            items={[
              { id: "state", label: "Your state", note: prefs.state ?? "not chosen" },
              { id: "positions", label: "Your positions", note: `${answered} of ${ISSUES.length} answered` },
              { id: "alignment", label: "Alignment estimate" },
              { id: "method", label: "How it's computed" },
            ]}
          />
        </aside>

        <div className="detail-content">
          <div id="state" className="detail-section">
            <Card title="Where should we look?">
              <p>
                Alignment is only shown for races on your ballot. Dossiers are currently loaded for{" "}
                {[...coveredStates].sort().join(", ")}; other states will show no races yet.
              </p>
              <div className="personalize-state">
                <label htmlFor="state-select">State where you are registered</label>
                <select
                  id="state-select"
                  value={prefs.state ?? ""}
                  onChange={(event) => updatePrefs((current) => ({ ...current, state: event.target.value || null }))}
                >
                  <option value="">— choose —</option>
                  {US_STATES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name} ({state.code})
                    </option>
                  ))}
                </select>
              </div>
            </Card>
          </div>

          <div id="positions" className="detail-section">
            <Card
              title="Your positions"
              action={
                <span className="text-sm text-neutral-500">
                  {answered} of {ISSUES.length} answered
                </span>
              }
            >
              <p>Pick the side you lean toward on each issue, or leave it unanswered and it won&apos;t count. Mark the issues that matter most to you.</p>
              <ol className="issue-list">
                {ISSUES.map((issue, index) => {
                  const opinion = prefs.opinions[issue.id];
                  const axis = ISSUE_AXES[issue.id];
                  return (
                    <li key={issue.id} className="issue-card" aria-labelledby={`issue-${issue.id}`}>
                      <div className="issue-card-heading">
                        <div>
                          <p className="detail-eyebrow">
                            Issue {index + 1} of {ISSUES.length}
                          </p>
                          <h3 id={`issue-${issue.id}`}>{issue.label}</h3>
                          <p className="issue-card-description">{issue.description}</p>
                        </div>
                        <div className="issue-importance">
                          <span>How much this matters to you</span>
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

                      <div className="issue-scale">
                        <p className="issue-pole" data-active={opinion !== undefined && opinion < 3}>
                          {axis.minus}
                        </p>
                        <div role="radiogroup" aria-label={`${issue.label} position`} className="issue-steps">
                          {SCALE.map((step) => (
                            <button
                              key={step.value}
                              type="button"
                              role="radio"
                              aria-checked={opinion === step.value}
                              aria-label={`${step.label} ${step.value < 3 ? axis.minus : step.value > 3 ? axis.plus : "neutral"}`}
                              onClick={() => setOpinion(issue.id, String(step.value))}
                            >
                              <span className="tabular-nums">{step.value}</span>
                              {step.label}
                            </button>
                          ))}
                        </div>
                        <p className="issue-pole issue-pole--plus" data-active={opinion !== undefined && opinion > 3}>
                          {axis.plus}
                        </p>
                      </div>

                      <div className="issue-card-footer">
                        <p>
                          {opinion === undefined ? (
                            <>Not answered — this issue won&apos;t count.</>
                          ) : (
                            <>
                              Your position: <strong>{userLabel(issue.id, opinion)}</strong>
                            </>
                          )}
                        </p>
                        {opinion !== undefined && (
                          <button type="button" onClick={() => setOpinion(issue.id, SKIP)}>
                            Clear answer
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Card>
          </div>

          <div id="alignment" className="detail-section">
            {prefs.state === null ? (
              <Card title="Alignment estimate">
                <div className="detail-empty">Choose a state above to see alignment estimates.</div>
              </Card>
            ) : !coveredStates.has(prefs.state) ? (
              <Card title="Alignment estimate">
                <div className="detail-empty">No races with dossiers loaded for {prefs.state.toUpperCase()} yet.</div>
              </Card>
            ) : answered === 0 ? (
              <Card title="Alignment estimate">
                <div className="detail-empty">Answer at least one issue above to see alignment estimates.</div>
              </Card>
            ) : (
              <div className="alignment-races">
                {results.map((result) => (
                  <RaceResults key={result.race.race_id} result={result} answered={answered} opinions={prefs.opinions} />
                ))}
              </div>
            )}
          </div>

          <div id="method" className="detail-section">
            <Card title="How this is computed">
              <p>
                Each comparable issue gets an agreement from 0 to 1: 1 minus the distance between your direction and the record direction divided by 4.
                Your importance rating and the record&apos;s confidence weight each issue before a weighted mean becomes the alignment estimate.
              </p>
              <p>
                Issues are skipped when there is no record, no coded position, or you skipped the issue. Directions are human-coded against a published
                per-issue axis and marked needs review until checked by a second person.
              </p>
              <p>
                This is an alignment estimate of the public record against your stated positions, not an instruction about how to vote or a claim about
                why anyone voted.{" "}
                <Link href={`${routes.methodology()}#alignment`} className="underline decoration-dotted underline-offset-4 hover:text-neutral-900">
                  Read the methodology.
                </Link>
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
