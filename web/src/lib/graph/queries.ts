/**
 * The allowlisted graph operations for Money Trails (D-79). Each operation is one fixed Cypher statement (or two) over
 * the graph ./schema.ts describes, parameterised only by race id and the node ids the server has already resolved.
 * Nothing from the question, and nothing the model writes, is ever spliced into Cypher. Every operation returns the
 * same thing: a list of edges read from the graph, each with the `source_url` it was filed under — the facts a narrative
 * may cite and the table the page renders regardless of whether a narrative is written.
 */
import { type GraphFact, type GraphNodeRef, type GraphOp, type GraphSubject, type NodeKind } from "./facts";
import type { Runner } from "./neo4j";
import { ENTITY, REL } from "./schema";

/**
 * Per operation: how many subjects it takes, what kind each may be, whether a candidate at that position stands for
 * their campaign committee (funding-side positions, where money is received), and the one-line description the
 * classifier sees.
 */
export const GRAPH_OP_SPEC: Record<GraphOp, { arity: 1 | 2; kinds: readonly NodeKind[][]; candidateAsCommittee: readonly boolean[]; describe: string }> = {
  shared_funders: {
    arity: 2,
    kinds: [
      ["committee", "candidate"],
      ["committee", "candidate"],
    ],
    candidateAsCommittee: [true, true],
    describe: "contributors that gave to BOTH of two committees (a candidate stands for their campaign committee)",
  },
  money_path: {
    arity: 2,
    kinds: [
      ["individual", "organization", "committee", "aggregate", "conduit"],
      ["committee", "candidate"],
    ],
    candidateAsCommittee: [false, false],
    describe:
      "how money moves from a contributor, organization or committee to a committee or candidate: the shortest filed paths (transfers, and outside spending for/against)",
  },
  funder_reach: {
    arity: 1,
    kinds: [["individual", "organization", "committee", "aggregate", "conduit"]],
    candidateAsCommittee: [false],
    describe: "everything a contributor or committee gave to, and which candidates those recipients then spent for or against",
  },
  upstream: {
    arity: 1,
    kinds: [["committee", "candidate"]],
    candidateAsCommittee: [true],
    describe: "who funds a committee's own funders: the money two steps upstream of a committee (a candidate stands for their campaign committee)",
  },
};

export const MAX_FACTS = 40;

const NODE = "{id: $n.id, name: $n.name, kind: $n.kind, href: $n.href}";
const node = (v: string) => NODE.replaceAll("$n", v);
export const edge = (a: string, r: string, b: string, path = "null") =>
  `{from: ${node(a)}, to: ${node(b)}, rel: type(${r}), amount: ${r}.amount, count: ${r}.count, support_oppose: ${r}.support_oppose,
    visibility: ${r}.visibility, first_date: ${r}.first_date, last_date: ${r}.last_date, source_url: ${r}.source_url, path: ${path}}`;

const E = `:${ENTITY}`;

/** Fixed graph-only completion for @graph: carry drawn committees through targeting and campaign ownership. */
export const COMPLETION = `
CALL {
  MATCH (c${E} {race_id: $race})-[t:${REL.TARGETED}]->(cand${E} {race_id: $race})
  WHERE c.id IN $ids AND t.amount > 0 AND (size($cands) = 0 OR cand.id IN $cands)
  WITH c, t, cand ORDER BY t.amount DESC LIMIT 40
  RETURN ${edge("c", "t", "cand")} AS edge
}
RETURN edge
UNION ALL
CALL {
  MATCH (c${E} {race_id: $race})-[k:${REL.CAMPAIGN_OF}]->(cand${E} {race_id: $race})
  WHERE c.id IN $ids AND (size($cands) = 0 OR cand.id IN $cands)
  RETURN ${edge("c", "k", "cand")} AS edge
}
RETURN edge
UNION ALL
CALL {
  MATCH (c${E} {race_id: $race})-[g:${REL.GAVE}]->(cc${E} {race_id: $race})-[k:${REL.CAMPAIGN_OF}]->(cand${E} {race_id: $race})
  WHERE c.id IN $ids AND g.amount > 0 AND (size($cands) = 0 OR cand.id IN $cands)
  WITH c, g, cc ORDER BY g.amount DESC LIMIT 40
  RETURN ${edge("c", "g", "cc")} AS edge
}
RETURN edge
UNION ALL
CALL {
  MATCH (c${E} {race_id: $race})-[g:${REL.GAVE}]->(cc${E} {race_id: $race})-[k:${REL.CAMPAIGN_OF}]->(cand${E} {race_id: $race})
  WHERE c.id IN $ids AND g.amount > 0 AND (size($cands) = 0 OR cand.id IN $cands)
  RETURN ${edge("cc", "k", "cand")} AS edge
}
RETURN edge`;

/** The statements each operation runs. `$race`, `$a`, `$b` (id lists) are the only parameters. */
export const CYPHER: Record<GraphOp, readonly string[]> = {
  shared_funders: [
    `MATCH (f${E} {race_id: $race})-[g1:${REL.GAVE}]->(a${E} {race_id: $race}) WHERE a.id IN $a
     MATCH (f)-[g2:${REL.GAVE}]->(b${E} {race_id: $race}) WHERE b.id IN $b AND f.kind <> 'aggregate'
     WITH f, a, b, g1, g2 ORDER BY g1.amount + g2.amount DESC LIMIT 10
     RETURN [${edge("f", "g1", "a")}, ${edge("f", "g2", "b")}] AS edges`,
  ],
  money_path: [
    `MATCH (x${E} {race_id: $race}) WHERE x.id IN $a
     MATCH (y${E} {race_id: $race}) WHERE y.id IN $b
     MATCH p = allShortestPaths((x)-[:${REL.GAVE}|${REL.CAMPAIGN_OF}|${REL.TARGETED}*1..4]->(y))
     WITH p ORDER BY reduce(s = 0.0, r IN relationships(p) | s + r.amount) DESC LIMIT 5
     WITH collect(p) AS paths
     UNWIND range(0, size(paths) - 1) AS pi
     WITH pi, paths[pi] AS p
     UNWIND range(0, length(p) - 1) AS i
     WITH pi, nodes(p)[i] AS a, relationships(p)[i] AS r, nodes(p)[i + 1] AS b
     RETURN [${edge("a", "r", "b", "pi")}] AS edges`,
  ],
  funder_reach: [
    `MATCH (x${E} {race_id: $race})-[g:${REL.GAVE}]->(c${E} {race_id: $race}) WHERE x.id IN $a
     WITH x, g, c ORDER BY g.amount DESC LIMIT 12
     OPTIONAL MATCH (c)-[t:${REL.TARGETED}]->(cand${E} {race_id: $race, kind: 'candidate'})
     RETURN [${edge("x", "g", "c")}] + CASE WHEN t IS NULL THEN [] ELSE [${edge("c", "t", "cand")}] END AS edges`,
  ],
  upstream: [
    `MATCH (f1${E} {race_id: $race})-[g1:${REL.GAVE}]->(c${E} {race_id: $race}) WHERE c.id IN $a AND f1.kind <> 'aggregate'
     WITH f1, g1, c ORDER BY g1.amount DESC LIMIT 8
     CALL {
       WITH f1
       OPTIONAL MATCH (f2${E})-[g2:${REL.GAVE}]->(f1) WHERE f2.kind <> 'aggregate'
       RETURN f2, g2 ORDER BY g2.amount DESC LIMIT 3
     }
     RETURN [${edge("f1", "g1", "c")}] + CASE WHEN g2 IS NULL THEN [] ELSE [${edge("f2", "g2", "f1")}] END AS edges`,
  ],
};

const RESOLVE_BY_ID = `MATCH (e${E} {race_id: $race}) WHERE e.id IN $ids RETURN ${node("e")} AS node`;

const RESOLVE_BY_NAME = `MATCH (e${E} {race_id: $race})
  WHERE e.kind IN ['individual', 'organization', 'committee', 'candidate', 'conduit']
    AND all(t IN $tokens WHERE e.name_lc CONTAINS t)
  RETURN ${node("e")} AS node ORDER BY e.name_lc LIMIT 40`;

export function mentionTokens(mention: string): string[] {
  return [...new Set(mention.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2))];
}

export type ResolveResult =
  | { ok: true; subject: GraphSubject }
  | { ok: false; reason: "not_found" | "ambiguous"; matches: GraphNodeRef[] };

/**
 * Resolve a validated subject id (from trails.json's closed set) to its graph node, or a free-text mention to the
 * unique name whose tokens it contains. Distinct nodes that share a name (the same person keyed under two employers)
 * resolve to one subject with several ids; distinct names are an ambiguity the caller reports back with the names.
 */
export async function resolveSubject(run: Runner, race: string, pick: { id: string | null; mention: string | null }): Promise<ResolveResult> {
  if (pick.id !== null) {
    const rows = await run(RESOLVE_BY_ID, { race, ids: [pick.id] });
    const n = rows[0]?.node as GraphNodeRef | undefined;
    if (!n) return { ok: false, reason: "not_found", matches: [] };
    return { ok: true, subject: { name: n.name, kind: n.kind, ids: [n.id], href: n.href } };
  }
  const tokens = mentionTokens(pick.mention ?? "");
  if (tokens.length === 0) return { ok: false, reason: "not_found", matches: [] };
  const rows = await run(RESOLVE_BY_NAME, { race, tokens });
  const nodes = rows.map((r) => r.node as GraphNodeRef);
  const byName = new Map<string, GraphNodeRef[]>();
  for (const n of nodes) byName.set(n.name.toLowerCase(), [...(byName.get(n.name.toLowerCase()) ?? []), n]);
  if (byName.size === 0) return { ok: false, reason: "not_found", matches: [] };
  let group = byName.size === 1 ? [...byName.values()][0] : undefined;
  if (!group) {
    // several names contain every token ("MUSK, ELON" and "MUSK, ELON REEVE" for "Elon Musk"): take the one name made of
    // nothing but the mention's own words, if there is exactly one; otherwise report the names for the asker to choose
    const covered = [...byName.entries()].filter(([name]) => mentionTokens(name).every((t) => tokens.includes(t)));
    if (covered.length !== 1) return { ok: false, reason: "ambiguous", matches: [...byName.values()].map((g) => g[0]).slice(0, 8) };
    group = covered[0][1];
  }
  const first = group[0];
  return { ok: true, subject: { name: first.name, kind: first.kind, ids: group.map((n) => n.id), href: first.href } };
}

/** Run an operation's statements and flatten to a deduped, capped, citation-numbered fact list. */
export async function runOperation(run: Runner, race: string, op: GraphOp, subjects: readonly GraphSubject[]): Promise<GraphFact[]> {
  const params = { race, a: subjects[0]?.ids ?? [], b: subjects[1]?.ids ?? [] };
  const seen = new Set<string>();
  const facts: GraphFact[] = [];
  for (const cypher of CYPHER[op]) {
    for (const row of await run(cypher, params)) {
      for (const e of row.edges as Array<Omit<GraphFact, "n">>) {
        const key = `${e.path ?? ""}|${e.rel}|${e.from.id}|${e.to.id}|${e.support_oppose ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        facts.push({ ...e, n: facts.length + 1 });
        if (facts.length >= MAX_FACTS) return facts;
      }
    }
  }
  return facts;
}
