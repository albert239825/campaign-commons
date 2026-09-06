import { NextResponse } from "next/server";
import { alignFunders } from "@/lib/align-funders";
import { alignLimiter } from "@/lib/align-limits";
import { AskAlignRequest } from "@/lib/align-llm";
import { clientKey } from "@/lib/ask-limits";
import { getRace } from "@/lib/data";
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
  const parsed = AskAlignRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { raceId: string, issueId: string, candidateId: string }." }, { status: 400 });
  }
  const { raceId, issueId, candidateId } = parsed.data;
  let race;
  try {
    race = getRace(raceId);
  } catch {
    return NextResponse.json({ error: `No race ${raceId}.` }, { status: 404 });
  }
  if (!race.candidates.some((candidate) => candidate.candidate_id === candidateId)) {
    return NextResponse.json({ error: `No candidate ${candidateId} in race ${raceId}.` }, { status: 404 });
  }

  const release = alignLimiter.acquire();
  if (release === null) return tooMany("The alignment service is busy; try again shortly.");
  if (!alignLimiter.take(clientKey(req.headers))) {
    release();
    return tooMany("Too many alignment requests; try again in a minute.");
  }
  try {
    const configured = getDriver();
    const response = await alignFunders(raceId, candidateId, issueId, {
      run: configured ? runnerFor(configured.driver, configured.database) : null,
    });
    return NextResponse.json(response, { headers: { "cache-control": "no-store" } });
  } finally {
    release();
  }
}

function tooMany(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
}
