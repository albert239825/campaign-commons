import { ISSUE_AXES, ISSUES, type Dossier, type IssueId, type RaceSummary, type Stance, type Party } from "@campaign-commons/contracts";
import type { UserPrefs } from "./prefs";

export const CONFIDENCE_WEIGHT: Record<Stance["confidence"], number> = { high: 1, medium: 0.7, low: 0.4 };

export type IssueAlignment = {
  issue_id: IssueId;
  user: number;
  candidate: number;
  agreement: number;
  weight: number;
  stance: Stance;
};
export type CandidateAlignment = {
  race_id: string;
  candidate_id: string;
  name: string;
  party: Party;
  role: Dossier["role"];
  evidence_basis: Dossier["evidence_basis"];
  score: number | null;
  compared: IssueAlignment[];
  skipped: { issue_id: IssueId; reason: "no_record" | "no_coded_position" | "no_opinion" }[];
};
export type RaceAlignment = { race: RaceSummary; candidates: CandidateAlignment[] };

export function opinionToDirection(o: number): number {
  return o - 3;
}

export function directionLabel(issueId: IssueId, direction: number): string {
  if (direction === 0) return "mixed / neutral";
  const axis = ISSUE_AXES[issueId];
  return direction > 0
    ? `${Math.abs(direction) === 2 ? "strongly" : "leans"}: ${axis.plus}`
    : `${Math.abs(direction) === 2 ? "strongly" : "leans"}: ${axis.minus}`;
}

export function scoreCandidate(prefs: UserPrefs, dossier: Dossier): CandidateAlignment {
  const byIssue = new Map(dossier.stances.map((stance) => [stance.issue_id, stance]));
  const compared: IssueAlignment[] = [];
  const skipped: CandidateAlignment["skipped"] = [];
  for (const issue of ISSUES) {
    const opinion = prefs.opinions[issue.id];
    const stance = byIssue.get(issue.id);
    if (!stance) {
      skipped.push({ issue_id: issue.id, reason: "no_record" });
    } else if (stance.direction === undefined) {
      skipped.push({ issue_id: issue.id, reason: "no_coded_position" });
    } else if (opinion === undefined) {
      skipped.push({ issue_id: issue.id, reason: "no_opinion" });
    } else {
      const user = opinionToDirection(opinion);
      const agreement = 1 - Math.abs(user - stance.direction) / 4;
      const weight = (prefs.importance[issue.id] ?? 2) * CONFIDENCE_WEIGHT[stance.confidence];
      compared.push({ issue_id: issue.id, user, candidate: stance.direction, agreement, weight, stance });
    }
  }
  const totalWeight = compared.reduce((sum, item) => sum + item.weight, 0);
  const score = totalWeight === 0 ? null : compared.reduce((sum, item) => sum + item.agreement * item.weight, 0) / totalWeight;
  return {
    race_id: dossier.race_id,
    candidate_id: dossier.candidate_id,
    name: dossier.name,
    party: dossier.party,
    role: dossier.role,
    evidence_basis: dossier.evidence_basis,
    score,
    compared,
    skipped,
  };
}

export function alignRaces(prefs: UserPrefs, races: RaceSummary[], dossiers: Dossier[]): RaceAlignment[] {
  if (prefs.state === null) return [];
  const dossiersByRace = new Map<string, Dossier[]>();
  for (const dossier of dossiers) {
    const list = dossiersByRace.get(dossier.race_id) ?? [];
    list.push(dossier);
    dossiersByRace.set(dossier.race_id, list);
  }
  return races
    .filter((race) => race.state.toLowerCase() === prefs.state?.toLowerCase() && dossiersByRace.has(race.race_id))
    .map((race) => ({
      race,
      candidates: (dossiersByRace.get(race.race_id) ?? [])
        .map((dossier) => scoreCandidate(prefs, dossier))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    }));
}
