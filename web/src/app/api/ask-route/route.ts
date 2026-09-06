// OWNER: Money Trails (D-75). The site's only server function: routes a typed question to a precomputed answer page.
import { NextResponse } from "next/server";
import { askLimiter, clientKey } from "@/lib/ask-limits";
import { AskRouteRequest, routeQuestion } from "@/lib/ask-router";
import { getTrails, hasTrails } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = AskRouteRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { raceId: string, question: string (1–500 chars) }." }, { status: 400 });
  }
  const { raceId, question } = parsed.data;
  if (!hasTrails(raceId)) return NextResponse.json({ error: `No Money Trails for race ${raceId}.` }, { status: 404 });

  // 429s never reach the model; the browser answers such questions with its own matcher.
  if (!askLimiter.take(clientKey(req.headers))) return tooMany("Too many questions; try again in a minute.");
  const release = askLimiter.acquire();
  if (release === null) return tooMany("The router is busy; try again shortly.");

  try {
    const resolution = await routeQuestion(question, getTrails(raceId));
    return NextResponse.json(resolution, { headers: { "cache-control": "no-store" } });
  } finally {
    release();
  }
}

function tooMany(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
}
