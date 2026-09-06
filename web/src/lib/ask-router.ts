/**
 * Server-side question routing for Money Trails (D-75): LLM classification (./ask-llm.ts) in front of the deterministic
 * resolver (./ask.ts). The LLM only ever picks `(intent, subjectId)` from the closed sets; what renders is still the
 * precomputed answer page the resolver lands on, and the resolver alone answers whenever the LLM does not.
 */
import { z } from "zod";
import type { Trails } from "@citizen-gotham/contracts";
import { resolveQuestion, resolveRoute, type Resolution } from "./ask";
import { classify, type ClassifyOptions, type Route } from "./ask-llm";

export const AskRouteRequest = z.object({
  raceId: z.string().min(1).max(64),
  question: z.string().trim().min(1).max(500),
});

export type AskRouteResponse = Resolution & { via: "llm" | "fallback" };

export type TrailsForRouting = Pick<Trails, "subjects" | "examples">;

/**
 * A valid route goes straight to the resolver's kind rules (`resolveRoute`: candidate funding → principal committee with
 * its note, committee spend/ad → refusal) with the exact validated subject; no text is re-matched, so an alias shared
 * with another subject on the ledger cannot turn a validated id into an ambiguity. Anything less than a valid route
 * resolves the raw question exactly as the browser would.
 */
export function seedResolution(question: string, route: Route | null, trails: TrailsForRouting): AskRouteResponse {
  const subject = route === null ? undefined : trails.subjects.find((s) => s.id === route.subjectId);
  if (route === null || subject === undefined) {
    return { ...resolveQuestion(question, trails.subjects, trails.examples), via: "fallback" };
  }
  return { ...resolveRoute(route.intent, subject, trails.subjects), via: "llm" };
}

export async function routeQuestion(question: string, trails: TrailsForRouting, opts: ClassifyOptions = {}): Promise<AskRouteResponse> {
  return seedResolution(question, await classify(question, trails, opts), trails);
}
