import { NextResponse } from "next/server";
import { alignLimiter } from "@/lib/align-limits";
import { alignCandidate, AskAlignRequest } from "@/lib/align-llm";
import { clientKey } from "@/lib/ask-limits";
import { getRace } from "@/lib/data";

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
  const candidate = race.candidates.find((item) => item.candidate_id === candidateId);
  if (!candidate) return NextResponse.json({ error: `No candidate ${candidateId} in race ${raceId}.` }, { status: 404 });

  const release = alignLimiter.acquire();
  if (release === null) return tooMany("The alignment service is busy; try again shortly.");
  if (!alignLimiter.take(clientKey(req.headers))) {
    release();
    return tooMany("Too many alignment requests; try again in a minute.");
  }
  try {
    const response = await alignCandidate(race.label, candidate.name, raceId, issueId, candidateId);
    return NextResponse.json(response, { headers: { "cache-control": "no-store" } });
  } finally {
    release();
  }
}

function tooMany(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
}
