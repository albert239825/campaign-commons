import type { IssueId, RaceSummary } from "@campaign-commons/contracts";
import { getEntity, getLedger, getRace, hasEntity } from "./data";
import { routes } from "./format";
import type { GraphFact } from "./graph/facts";
import { runOperation } from "./graph/queries";
import type { Runner } from "./graph/neo4j";

export type AlignFunder = {
  entity_id: string;
  name: string;
  href: string | null;
  amount: number;
  source_url: string | null;
  tag_layer: "machine" | "position" | "focus";
  position: { direction: number; quote: string; source_url: string } | null;
};

export type AlignFundersResponse = {
  via: "graph" | "static";
  candidate: AlignFunder[];
  race: AlignFunder[];
};

export type AlignFundersDeps = { run?: Runner | null };

type AlignPosition = { direction: number; quote: string; source_url: string };

function positionFor(raceId: string, entityId: string, issueId: IssueId): AlignPosition | null {
  if (!hasEntity(raceId, entityId)) return null;
  const position = getEntity(raceId, entityId).issue_positions?.find((row) => row.issue_id === issueId);
  return position
    ? { direction: position.direction, quote: position.quote, source_url: position.source_url }
    : null;
}

function entityTag(raceId: string, entityId: string, issueId: IssueId): "focus" | "position" | null {
  if (!hasEntity(raceId, entityId)) return null;
  const entity = getEntity(raceId, entityId);
  if (entity.issue_focus?.issue_ids.includes(issueId)) return "focus";
  if (entity.issue_positions?.some((row) => row.issue_id === issueId)) return "position";
  return null;
}

function graphFunders(raceId: string, issueId: IssueId, facts: GraphFact[]): AlignFunder[] {
  const byId = new Map<string, AlignFunder>();
  for (const fact of facts) {
    const id = fact.from.id;
    const existing = byId.get(id);
    if (existing) {
      existing.amount += fact.amount;
      if (!existing.source_url && fact.source_url) existing.source_url = fact.source_url;
      continue;
    }
    byId.set(id, {
      entity_id: id,
      name: fact.from.name,
      href: fact.from.href,
      amount: fact.amount,
      source_url: fact.source_url,
      tag_layer: fact.tag?.layer ?? "machine",
      position: positionFor(raceId, id, issueId),
    });
  }
  return [...byId.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
}

function staticFunders(raceId: string, candidateId: string, issueId: IssueId): AlignFundersResponse {
  const ledger = getLedger(raceId);
  const race: AlignFunder[] = [];
  for (const spender of ledger.top_outside_spenders) {
    const tag = entityTag(raceId, spender.entity_id, issueId);
    if (!tag) continue;
    race.push({
      entity_id: spender.entity_id,
      name: spender.name,
      href: routes.entity(raceId, spender.entity_id),
      amount: spender.total,
      source_url: spender.source_url,
      tag_layer: tag,
      position: positionFor(raceId, spender.entity_id, issueId),
    });
  }
  race.sort((a, b) => b.amount - a.amount);

  const candidate = ledger.candidates.find((row) => row.candidate_id === candidateId);
  if (!candidate) return { via: "static", candidate: [], race: race.slice(0, 5) };
  const candidateFunders: AlignFunder[] = [];
  if (hasEntity(raceId, candidate.principal_committee_id)) {
    const committee = getEntity(raceId, candidate.principal_committee_id);
    for (const transfer of committee.inflows) {
      const tag = entityTag(raceId, transfer.from_entity_id, issueId);
      if (!tag) continue;
      candidateFunders.push({
        entity_id: transfer.from_entity_id,
        name: transfer.from_name,
        href: routes.entity(raceId, transfer.from_entity_id),
        amount: transfer.amount,
        source_url: transfer.source_url,
        tag_layer: tag,
        position: positionFor(raceId, transfer.from_entity_id, issueId),
      });
    }
  }
  candidateFunders.sort((a, b) => b.amount - a.amount);
  return { via: "static", candidate: candidateFunders.slice(0, 5), race: race.slice(0, 5) };
}

export async function alignFunders(
  raceId: string,
  candidateId: string,
  issueId: IssueId,
  deps: AlignFundersDeps = {},
): Promise<AlignFundersResponse> {
  const race: RaceSummary = getRace(raceId);
  const candidate = race.candidates.find((row) => row.candidate_id === candidateId);
  if (!candidate) return { via: "static", candidate: [], race: [] };
  if (deps.run) {
    try {
      const subject = {
        name: candidate.name,
        kind: "candidate" as const,
        ids: [candidate.principal_committee_id],
        href: null,
      };
      const [candidateFacts, raceFacts] = await Promise.all([
        runOperation(deps.run, raceId, "funders_by_issue", [subject], issueId),
        runOperation(deps.run, raceId, "issue_funders", [], issueId),
      ]);
      return { via: "graph", candidate: graphFunders(raceId, issueId, candidateFacts), race: graphFunders(raceId, issueId, raceFacts) };
    } catch {
      // The published artifacts remain available when Neo4j is down.
    }
  }
  return staticFunders(raceId, candidateId, issueId);
}
