import type {
  CandidateSpenderAnswer,
  Entity,
  IssueId,
  IssuePosition,
  TrailSubject,
} from "@campaign-commons/contracts";
import { ISSUE_AXES } from "@campaign-commons/contracts";
import { getEntity, getIssues, getTrails, listEntityIds } from "./data";

export type SpenderStance = {
  spender: CandidateSpenderAnswer["spenders"][number];
  position: IssuePosition | null;
};

export type SpenderIssueAnswer = {
  candidate: TrailSubject;
  issueId: IssueId;
  headline: string;
  caveats: string[];
  groups: { key: "plus" | "minus" | "neither" | "none"; label: string; rows: SpenderStance[] }[];
  counts: { spenders: number; with_position: number; verified: number; model: number };
};

const GROUP_ORDER = ["plus", "minus", "neither", "none"] as const;

function countWord(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildSpenderIssueAnswer(
  candidate: TrailSubject,
  issueId: IssueId,
  spenderAnswer: CandidateSpenderAnswer,
  entities: ReadonlyMap<string, Entity>,
  coverage: { spenders_with_positions: number; spenders_total: number } | null,
): SpenderIssueAnswer {
  const stances: SpenderStance[] = spenderAnswer.spenders.map((spender) => ({
    spender,
    position: entities.get(spender.spender_id)?.issue_positions?.find((position) => position.issue_id === issueId) ?? null,
  }));
  const groups = new Map<(typeof GROUP_ORDER)[number], SpenderStance[]>(GROUP_ORDER.map((key) => [key, []]));
  let verified = 0;
  let model = 0;
  for (const stance of stances) {
    const key = stance.position === null ? "none" : stance.position.direction > 0 ? "plus" : stance.position.direction < 0 ? "minus" : "neither";
    groups.get(key)?.push(stance);
    if (stance.position?.basis.basis === "verified") verified += 1;
    if (stance.position?.basis.basis === "inferred") model += 1;
  }
  for (const rows of groups.values()) rows.sort((a, b) => b.spender.amount - a.spender.amount);

  const plus = groups.get("plus")?.length ?? 0;
  const minus = groups.get("minus")?.length ?? 0;
  const neither = groups.get("neither")?.length ?? 0;
  const none = groups.get("none")?.length ?? 0;
  const axis = ISSUE_AXES[issueId];
  const withPosition = stances.length - none;
  const headline = `${countWord(stances.length, "group", "groups")} reported independent expenditures for or against ${candidate.name}. ${withPosition} of them ${withPosition === 1 ? "states" : "state"} a position on ${axis.plus.toLowerCase()} on their own sites: ${plus} ${plus === 1 ? "toward" : "toward"} "${axis.plus}", ${minus} toward "${axis.minus}"${neither ? `, ${neither} on neither side` : ""}. ${none} ${none === 1 ? "states" : "state"} none we could find.`;
  const caveats = [
    "A stated position is what the group says on its own site, read by a language model and kept only where the quote appears verbatim on the fetched page; it is marked unverified until a person checks it. It is not what the group's ads or notices said, and not a claim about which dollars went where.",
    ...(coverage === null
      ? []
      : [`Positions were looked up for ${coverage.spenders_with_positions} of ${coverage.spenders_total} outside spenders in this race; a group with none found may simply have no site text on this issue.`]),
    "Spending for or against a candidate is the filed Schedule E total; a group's position and its spending stance are shown side by side, never combined.",
  ];
  const labels: Record<(typeof GROUP_ORDER)[number], string> = {
    plus: axis.plus,
    minus: axis.minus,
    neither: "States a position on neither side",
    none: "No stated position found on its own site",
  };
  return {
    candidate,
    issueId,
    headline,
    caveats,
    groups: GROUP_ORDER.filter((key) => (groups.get(key)?.length ?? 0) > 0).map((key) => ({ key, label: labels[key], rows: groups.get(key) ?? [] })),
    counts: { spenders: stances.length, with_position: withPosition, verified, model },
  };
}

export function getSpenderIssueAnswer(raceId: string, candidateId: string, issueId: IssueId): SpenderIssueAnswer | null {
  const trails = getTrails(raceId);
  const candidate = trails.subjects.find((subject) => subject.id === candidateId && subject.kind === "candidate");
  const spenderAnswer = trails.answers.find((answer) => answer.intent === "candidate_spender" && answer.candidate_id === candidateId);
  if (!candidate || !spenderAnswer || spenderAnswer.intent !== "candidate_spender") return null;
  const entityIds = new Set(listEntityIds(raceId));
  const entities = new Map<string, Entity>();
  for (const spender of spenderAnswer.spenders) {
    if (entityIds.has(spender.spender_id)) entities.set(spender.spender_id, getEntity(raceId, spender.spender_id));
  }
  const coverage = getIssues(raceId)?.coverage;
  return buildSpenderIssueAnswer(
    candidate,
    issueId,
    spenderAnswer,
    entities,
    coverage?.spenders_with_positions === undefined ? null : { spenders_with_positions: coverage.spenders_with_positions, spenders_total: coverage.spenders_total },
  );
}
