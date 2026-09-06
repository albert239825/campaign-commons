// OWNER: Money Trails (D-81). Graph mode: allowlisted Neo4j queries with a guarded model narrative; separate from /api/ask-route.
import { NextResponse } from "next/server";
import { clientKey } from "@/lib/ask-limits";
import { getTrails, hasTrails } from "@/lib/data";
import { AskGraphRequest, answerGraphQuestion } from "@/lib/graph/ask-graph";
import { graphLimiter } from "@/lib/graph/limits";
import { getDriver, runnerFor } from "@/lib/graph/neo4j";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = AskGraphRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { raceId: string, question: string (1–500 chars) }." }, { status: 400 });
  }
  const { raceId, question } = parsed.data;
  if (!hasTrails(raceId)) return NextResponse.json({ error: `No Money Trails for race ${raceId}.` }, { status: 404 });

  const release = graphLimiter.acquire();
  if (release === null) return tooMany("The graph is busy; try again shortly.");
  if (!graphLimiter.take(clientKey(req.headers))) {
    release();
    return tooMany("Too many graph questions; try again in a minute.");
  }

  try {
    const graph = getDriver();
    const run = graph ? runnerFor(graph.driver, graph.database) : null;
    const response = await answerGraphQuestion(raceId, question, getTrails(raceId).subjects, { run });
    return NextResponse.json(response, { headers: { "cache-control": "no-store" } });
  } finally {
    release();
  }
}

function tooMany(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
}
