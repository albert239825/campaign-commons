/**
 * Server-side question routing for Money Trails (D-74): LLM classification (./ask-llm.ts) in front of the deterministic
 * resolver (./ask.ts). The LLM only ever picks `(intent, subjectId)` from the closed sets; what renders is still the
 * precomputed answer page the resolver lands on, and the resolver alone answers whenever the LLM does not.
 */
import { z } from "zod";
import type { Trails } from "@campaign-commons/contracts";
import { resolveQuestion, type Resolution } from "./ask";
import { classify, type ClassifyOptions, type Route } from "./ask-llm";

export const AskRouteRequest = z.object({
  raceId: z.string().min(1).max(64),
  question: z.string().trim().min(1).max(500),
});

export type AskRouteResponse = Resolution & { via: "llm" | "fallback" };

export type TrailsForRouting = Pick<Trails, "subjects" | "examples">;

/**
 * A valid route is re-seeded through the resolver as `"<intent> <alias>"` so its existing rules (candidate funding →
 * principal committee with its note, committee spend/ad refusal) decide what renders. Anything less than a valid route
 * resolves the raw question exactly as the browser would.
 */
export function seedResolution(question: string, route: Route | null, trails: TrailsForRouting): AskRouteResponse {
  const subject = route === null ? undefined : trails.subjects.find((s) => s.id === route.subjectId);
  if (route === null || subject === undefined || subject.aliases.length === 0) {
    return { ...resolveQuestion(question, trails.subjects, trails.examples), via: "fallback" };
  }
  return { ...resolveQuestion(`${route.intent} ${subject.aliases[0]}`, trails.subjects, trails.examples), via: "llm" };
}

export async function routeQuestion(question: string, trails: TrailsForRouting, opts: ClassifyOptions = {}): Promise<AskRouteResponse> {
  return seedResolution(question, await classify(question, trails, opts), trails);
}
