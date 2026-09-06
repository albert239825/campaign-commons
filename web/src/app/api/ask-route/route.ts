// OWNER: Money Trails (D-74). The site's only server function: routes a typed question to a precomputed answer page.
import { NextResponse } from "next/server";
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

  const resolution = await routeQuestion(question, getTrails(raceId));
  return NextResponse.json(resolution, { headers: { "cache-control": "no-store" } });
}
