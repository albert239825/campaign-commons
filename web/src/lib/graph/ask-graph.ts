/**
 * Graph mode for Money Trails (D-77): the server-side sequence behind /api/ask-graph. In order, and stopping at the
 * first step that fails:
 *
 *   race validated by the caller (trails.json exists) → Grok picks an allowlisted operation and its subjects →
 *   each subject is resolved to graph nodes (closed-list id, or a name looked up in the graph) → the subjects' kinds are
 *   checked against what the operation accepts → the operation's fixed Cypher runs → the facts come back with their
 *   source URLs → only then may Grok write a narrative over those facts, which is kept only if ./llm.ts's guard passes.
 *
 * Every response is either a fact list the page can render on its own, or a typed refusal with a deterministic message.
 * This module never touches the route endpoint; /api/ask-route and its resolver are unchanged.
 */
import { z } from "zod";
import type { TrailSubject } from "@campaign-commons/contracts";
import { type AskGraphResponse, type GraphFact, type GraphNodeRef, type GraphOp, type GraphSubject } from "./facts";
import { classifyGraph, hasApiKey, narrate, type LlmOptions } from "./llm";
import type { Runner } from "./neo4j";
import { GRAPH_OP_SPEC, resolveSubject, runOperation } from "./queries";

export const AskGraphRequest = z.object({
  raceId: z.string().min(1).max(64),
  question: z.string().trim().min(1).max(500),
});

export type GraphDeps = {
  /** null when NEO4J_URI is not configured */
  run: Runner | null;
  llm?: LlmOptions;
};

const refuse = (reason: Extract<AskGraphResponse, { kind: "unsupported" }>["reason"], message: string, matches: GraphNodeRef[] = []): AskGraphResponse => ({ kind: "unsupported", reason, message, matches });

const OP_LABEL: Record<GraphOp, string> = {
  shared_funders: "shared funders",
  money_path: "money path",
  funder_reach: "where a funder's money went",
  upstream: "upstream funders",
};

export async function answerGraphQuestion(raceId: string, question: string, trailsSubjects: readonly TrailSubject[], deps: GraphDeps): Promise<AskGraphResponse> {
  if (deps.run === null) {
    return refuse("graph_unavailable", "The graph behind cross-entity questions is not connected on this deployment; the supported questions are listed above.");
  }
  if (!hasApiKey(deps.llm ?? {})) {
    return refuse("graph_unavailable", "Cross-entity questions need the language model to read them, and it is not configured here; the supported questions are listed above.");
  }

  const pick = await classifyGraph(question, trailsSubjects, deps.llm);
  if (pick === null) {
    return refuse(
      "no_operation",
      "That does not match a graph question this site can run. It can find funders two committees share, trace the shortest filed path from a funder to a committee or candidate, list where a funder's money went, or show who funds a committee's funders.",
    );
  }
  const spec = GRAPH_OP_SPEC[pick.op];

  const subjects: GraphSubject[] = [];
  const notes: string[] = [];
  for (const [i, p] of pick.subjects.entries()) {
    // funding-side operations are about the committee that receives money; a candidate stands for their campaign committee
    let resolvedPick = p;
    if (p.id !== null && spec.candidateAsCommittee[i]) {
      const s = trailsSubjects.find((t) => t.id === p.id);
      if (s?.kind === "candidate") {
        if (s.principal_committee_id === null) {
          return refuse("wrong_kind", `${s.name} has no principal committee on file for this race, so the funding side of this question cannot be answered.`);
        }
        resolvedPick = { id: s.principal_committee_id, mention: null };
        notes.push(`${s.name} is read as their campaign committee.`);
      }
    }
    let r;
    try {
      r = await resolveSubject(deps.run, raceId, resolvedPick);
    } catch {
      return refuse("query_failed", "The graph could not be reached; try again shortly.");
    }
    if (!r.ok) {
      return r.reason === "ambiguous"
        ? refuse("ambiguous_subject", "More than one name in this race's records matches; the question needs one of them by full name.", r.matches)
        : refuse("subject_not_found", "One of the names in the question is not in this race's filed records, so nothing can be traced for it.");
    }
    if (!spec.kinds[i].includes(r.subject.kind)) {
      return refuse("wrong_kind", `${r.subject.name} is a ${r.subject.kind}, and the "${OP_LABEL[pick.op]}" question needs a ${spec.kinds[i].join(" or ")} there.`);
    }
    subjects.push(r.subject);
  }
  if (subjects.length === 2 && subjects[0].ids.some((id) => subjects[1].ids.includes(id))) {
    return refuse("wrong_kind", `The "${OP_LABEL[pick.op]}" question needs two different subjects.`);
  }

  let facts: GraphFact[];
  try {
    facts = await runOperation(deps.run, raceId, pick.op, subjects);
  } catch {
    return refuse("query_failed", "The graph could not be reached; try again shortly.");
  }

  const narrative = await narrate(question, facts, deps.llm);
  return { kind: "graph", op: pick.op, subjects, note: notes.length > 0 ? notes.join(" ") : null, facts, narrative };
}
